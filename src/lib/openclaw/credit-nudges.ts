import { createHash } from "node:crypto";
import type { LiabilityAccountSummary, LiabilitiesDueSummary } from "@/lib/finance/liabilities";
import { buildPayoffPlan, type PayoffCardPlan, type PayoffPlan } from "@/lib/finance/payoff-plan";

export type OpenClawCreditNudgeReason =
  | "cash_safe_under_30"
  | "due_date_risk"
  | "high_utilization_near_close";

export interface OpenClawCreditNudgePacket {
  id: string;
  amount: number;
  body: string;
  cardLabel: string;
  createdAt: string;
  deadline: string;
  reason: OpenClawCreditNudgeReason;
  sourceConfidence: "actual_due_date" | "estimated_cycle" | "statement_cycle";
  targetUtilizationPercent: number | null;
  utilizationPercent: number | null;
}

export interface OpenClawCreditNudgeBuildInput {
  generatedAt: string;
  liabilities: LiabilitiesDueSummary;
  packetLimit?: number;
  payoffPlan?: PayoffPlan;
}

const CLOSE_WINDOW_DAYS = 5;
const CASH_SAFE_WINDOW_DAYS = 10;
const DUE_RISK_DAYS = 3;
const MIN_ACTION_AMOUNT = 25;

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function money(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function formatShortDate(value: string) {
  return parseIsoDate(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
}

function packetId(parts: readonly string[]) {
  const digest = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
  return `openclaw-credit-nudge:v1:${digest}`;
}

function safeCardLabel(row: LiabilityAccountSummary) {
  const institution = row.institutionName
    .replace(/\s*\(manual\)\s*$/i, "")
    .replace(/\b\d{4,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (institution) return `${institution} card`;

  const name = row.name
    .replace(/\b\d{4,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return name ? `${name} card` : "credit card";
}

function cardForRow(plan: PayoffPlan, row: LiabilityAccountSummary) {
  return plan.cards.find((card) => card.accountId === row.accountId) ?? null;
}

function sourceConfidence(row: LiabilityAccountSummary, reason: OpenClawCreditNudgeReason) {
  if (reason === "high_utilization_near_close" || reason === "cash_safe_under_30") {
    if (row.reportingDateConfidence === "high") return "statement_cycle";
    if (row.reportingDateConfidence === "medium") return "statement_cycle";
    return "estimated_cycle";
  }
  return row.dueDateIsActual ? "actual_due_date" : "estimated_cycle";
}

function buildPacket({
  amount,
  body,
  deadline,
  generatedAt,
  reason,
  row,
  targetUtilizationPercent
}: {
  amount: number;
  body: string;
  deadline: string;
  generatedAt: string;
  reason: OpenClawCreditNudgeReason;
  row: LiabilityAccountSummary;
  targetUtilizationPercent: number | null;
}): OpenClawCreditNudgePacket {
  const cardLabel = safeCardLabel(row);
  return {
    id: packetId([
      reason,
      slug(cardLabel),
      deadline,
      String(Math.round(amount)),
      targetUtilizationPercent === null ? "none" : String(targetUtilizationPercent)
    ]),
    amount: roundMoney(amount),
    body,
    cardLabel,
    createdAt: generatedAt,
    deadline,
    reason,
    sourceConfidence: sourceConfidence(row, reason),
    targetUtilizationPercent,
    utilizationPercent: row.utilizationPercent
  };
}

function hasLikelyPaymentAfterStatement(row: LiabilityAccountSummary) {
  if (!row.lastStatementIssueDate || !row.lastPaymentDate) return false;
  return row.lastPaymentDate >= row.lastStatementIssueDate;
}

function dueDateRiskPacket(
  row: LiabilityAccountSummary,
  generatedAt: string
): OpenClawCreditNudgePacket | null {
  if (!row.estimatedDueDate || row.amountOwed <= 0) return null;
  if (row.status !== "overdue" && row.status !== "due-soon") return null;
  if (row.daysUntilDue !== null && row.daysUntilDue > DUE_RISK_DAYS) return null;
  if (!row.dueDateIsActual) return null;
  if (hasLikelyPaymentAfterStatement(row)) return null;

  const amount = Math.min(
    row.amountOwed,
    Math.max(row.minimumPaymentAmount ?? 0, MIN_ACTION_AMOUNT)
  );
  if (amount <= 0) return null;

  const label = safeCardLabel(row);
  const dueText = row.daysUntilDue !== null && row.daysUntilDue < 0
    ? "is overdue"
    : `is due ${formatShortDate(row.estimatedDueDate)}`;
  return buildPacket({
    amount,
    body: `Tally credit: pay at least ${money(amount)} on ${label}; the payment ${dueText} and no likely payment is visible. This protects payment history; Tally will not initiate it.`,
    deadline: row.estimatedDueDate,
    generatedAt,
    reason: "due_date_risk",
    row,
    targetUtilizationPercent: null
  });
}

function highUtilizationNearClosePacket(
  row: LiabilityAccountSummary,
  card: PayoffCardPlan,
  generatedAt: string
): OpenClawCreditNudgePacket | null {
  const optimization = card.reportedBalanceOptimization;
  if (optimization.confidence === "low" || optimization.confidence === "unknown") return null;
  if (!optimization.reportingDate || optimization.daysUntilReporting === null) return null;
  if (optimization.daysUntilReporting < 0 || optimization.daysUntilReporting > CLOSE_WINDOW_DAYS) return null;
  if ((card.utilizationPercent ?? 0) < 50) return null;

  const underThirty = optimization.actions.find((action) => action.target === "under_30");
  const amount = Math.max(underThirty?.paymentNeeded ?? card.payToReachThirty, card.suggestedPayment, MIN_ACTION_AMOUNT);
  const deadline = optimization.payByDate ?? optimization.reportingDate;
  const label = safeCardLabel(row);
  return buildPacket({
    amount,
    body: `Tally credit: ${label} is around ${Math.round(card.utilizationPercent ?? 0)}% utilization and may report ${formatShortDate(optimization.reportingDate)}. Paying ${money(amount)} by ${formatShortDate(deadline)} may lower reported utilization; this is not a score prediction.`,
    deadline,
    generatedAt,
    reason: "high_utilization_near_close",
    row,
    targetUtilizationPercent: 30
  });
}

function cashSafeUnderThirtyPacket(
  row: LiabilityAccountSummary,
  card: PayoffCardPlan,
  generatedAt: string
): OpenClawCreditNudgePacket | null {
  const optimization = card.reportedBalanceOptimization;
  if (optimization.confidence === "low" || optimization.confidence === "unknown") return null;
  if (!optimization.reportingDate || optimization.daysUntilReporting === null || !optimization.payByDate) return null;
  if (optimization.daysUntilReporting < 0 || optimization.daysUntilReporting > CASH_SAFE_WINDOW_DAYS) return null;
  if ((card.utilizationPercent ?? 0) <= 30) return null;
  const underThirty = optimization.actions.find((action) => action.target === "under_30");
  if (!underThirty || underThirty.paymentNeeded < MIN_ACTION_AMOUNT) return null;
  if (!underThirty.isFullyFunded) return null;
  if ((underThirty.projectedUtilizationPercent ?? 100) >= 30) return null;

  const amount = underThirty.paymentNeeded;
  const label = safeCardLabel(row);
  return buildPacket({
    amount,
    body: `Tally credit: pay ${money(amount)} by ${formatShortDate(optimization.payByDate)} to keep ${label} under 30% utilization before it may report. This uses a cash-safe estimate and Tally will not initiate payment.`,
    deadline: optimization.payByDate,
    generatedAt,
    reason: "cash_safe_under_30",
    row,
    targetUtilizationPercent: 30
  });
}

export function buildOpenClawCreditNudgePackets({
  generatedAt,
  liabilities,
  packetLimit = 1,
  payoffPlan
}: OpenClawCreditNudgeBuildInput): OpenClawCreditNudgePacket[] {
  const limit = Math.max(0, Math.min(packetLimit, 3));
  if (limit === 0 || liabilities.rows.length === 0) return [];

  const plan = payoffPlan ?? buildPayoffPlan({
    asOfDate: liabilities.asOfDate,
    cashAvailable: Math.max(0, liabilities.cashAvailable),
    rows: liabilities.rows
  });

  const rowsByUrgency = [...liabilities.rows];
  const dueRisk = rowsByUrgency
    .map((row) => dueDateRiskPacket(row, generatedAt))
    .filter((packet): packet is OpenClawCreditNudgePacket => packet !== null);
  if (dueRisk.length > 0) return dueRisk.slice(0, limit);

  const closeRisk = rowsByUrgency
    .map((row) => {
      const card = cardForRow(plan, row);
      return card ? highUtilizationNearClosePacket(row, card, generatedAt) : null;
    })
    .filter((packet): packet is OpenClawCreditNudgePacket => packet !== null)
    .sort((left, right) => (right.utilizationPercent ?? 0) - (left.utilizationPercent ?? 0));
  if (closeRisk.length > 0) return closeRisk.slice(0, limit);

  return rowsByUrgency
    .map((row) => {
      const card = cardForRow(plan, row);
      return card ? cashSafeUnderThirtyPacket(row, card, generatedAt) : null;
    })
    .filter((packet): packet is OpenClawCreditNudgePacket => packet !== null)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, limit);
}
