import type { AccountRecord, CreditAprRecord, TransactionRecord } from "@/lib/db";

const PAYMENT_MERCHANT_HINTS = /\b(payment|pmt|autopay|thank you|epay|online pay)\b/i;
// A standard credit-card billing cycle is ~30 days, and the issuer "grace
// period" between the statement close and the payment due date is typically
// ~21-25 days. We use these only as a last-resort estimate when no statement
// issue date and no observed payment cadence are available.
const DEFAULT_BILLING_CYCLE_DAYS = 30;
const DEFAULT_PAYMENT_GRACE_DAYS = 25;
const DUE_SOON_DAYS = 7;
const DEFAULT_PROCESSING_BUFFER_DAYS = 3;
const UTILIZATION_TARGETS = [30, 10] as const;

// Inference of the statement cycle from observed payment history.
// Autopay (and most manual payers) pay on/near the due date each month, so the
// recurring day-of-month of card payments approximates the due day. The
// statement closes ~grace days earlier. We require at least this many distinct
// monthly payments clustered on the same day-of-month before trusting the
// signal, so a one-off transfer can't masquerade as a billing cadence.
const MIN_OBSERVED_PAYMENTS_FOR_CYCLE = 2;
// How far the observed payment days may spread (in days-of-month) and still be
// treated as the same recurring autopay anchor. Issuers post a day early/late
// around weekends/holidays, so a small spread is expected.
const MAX_PAYMENT_DAY_SPREAD = 3;
// Only consider payments from roughly the last few cycles; older cards can
// change due dates and we don't want stale cadence to anchor the estimate.
const PAYMENT_CADENCE_LOOKBACK_DAYS = 120;

export type LiabilityTransactionInput = Pick<TransactionRecord, "accountId" | "amount" | "date" | "intent" | "merchant" | "plaidName">;

export type LiabilityStatus = "current" | "due-soon" | "overdue" | "no-balance";
export type LiabilityReportingDateSource =
  | "actual_plaid_liability"
  | "inferred_from_statement_cycle"
  | "estimated_from_due_date"
  | "unknown";
export type LiabilityReportingDateConfidence = "high" | "medium" | "low" | "unknown";
export type LiabilityUtilizationTarget = typeof UTILIZATION_TARGETS[number];

export interface LiabilityTargetPaymentAction {
  accountId: string;
  amountOwed: number;
  amountToTarget: number;
  cashShortfall: number;
  creditLimit: number;
  currentUtilizationPercent: number;
  dateConfidence: LiabilityReportingDateConfidence;
  dateSource: LiabilityReportingDateSource;
  highestAprPercentage?: number | null;
  payByDate: string;
  projectedUtilizationPercent: number;
  reason: "reported_balance_optimization";
  recommendedPayment: number;
  reportingDate: string;
  targetUtilizationPercent: LiabilityUtilizationTarget;
}

export interface LiabilityTargetPaymentPlan {
  actions: LiabilityTargetPaymentAction[];
  aggregateUtilizationPercent: number | null;
  allocatableCash: number;
  cashAvailable: number;
  cashBuffer: number;
  highestIndividualUtilizationPercent: number | null;
  remainingAllocatableCash: number;
  targetUtilizationPercent: LiabilityUtilizationTarget;
}

export interface LiabilityAccountSummary {
  accountId: string;
  name: string;
  mask: string | null;
  institutionName: string;
  amountOwed: number;
  creditLimit: number | null;
  utilizationPercent: number | null;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  estimatedDueDate: string | null;
  daysUntilDue: number | null;
  status: LiabilityStatus;
  // From Plaid liabilities product when available; falls back to null.
  lastStatementIssueDate: string | null;
  lastStatementBalance: number | null;
  minimumPaymentAmount: number | null;
  lastPaymentSource?: "plaid_liability" | "transaction_inference" | "unknown";
  isOverdue?: boolean | null;
  creditAprs?: CreditAprRecord[];
  purchaseAprPercentage?: number | null;
  highestAprPercentage?: number | null;
  // True when the due date came from Plaid liabilities, not an estimate.
  dueDateIsActual: boolean;
  // True when this card carries a balance but has no connected liability
  // fields (due date, statement, or minimum payment). Such cards were almost
  // always linked Transactions-only and need a reconnect to gain due-date and
  // minimum-payment data once the Liabilities product is enabled.
  needsReconnectForDueDates: boolean;
  reportingDate: string | null;
  reportingDateSource: LiabilityReportingDateSource;
  reportingDateConfidence: LiabilityReportingDateConfidence;
  actionRank: number;
}

export interface LiabilitiesDueSummary {
  asOfDate: string;
  rows: LiabilityAccountSummary[];
  totalOwed: number;
  cashAvailable: number;
  aggregateUtilizationPercent: number | null;
  coverageDelta: number;
  hasOverdue: boolean;
  hasDueSoon: boolean;
  highestIndividualUtilizationPercent: number | null;
  targetPaymentPlans: LiabilityTargetPaymentPlan[];
}

function isCreditAccount(account: AccountRecord) {
  return account.type === "credit" && account.isActive;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function addDays(value: string, days: number) {
  const date = parseIsoDate(value);
  return isoDate(new Date(date.getTime() + days * 86_400_000));
}

// Advance by whole calendar months while preserving the day-of-month, clamping
// to the target month's last day (e.g. Jan 31 -> Feb 28). Statement closing dates
// are anchored to a fixed day of the month, so this is more accurate than adding a
// flat 30 days when projecting the next cycle.
function addMonths(value: string, months: number) {
  const date = parseIsoDate(value);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12));
  const lastDayOfTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDayOfTargetMonth));
  return isoDate(target);
}

function dayDifference(fromIso: string, toIso: string) {
  const from = parseIsoDate(fromIso).getTime();
  const to = parseIsoDate(toIso).getTime();
  return Math.round((to - from) / 86_400_000);
}

function nextCycleDate(anchorIso: string, asOfIso: string) {
  let date = anchorIso;
  while (dayDifference(asOfIso, date) < 0) {
    date = addMonths(date, 1);
  }
  return date;
}

function statusForDays(days: number | null, owed: number): LiabilityStatus {
  if (owed <= 0) return "no-balance";
  if (days === null) return "current";
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due-soon";
  return "current";
}

function utilizationRank(utilizationPercent: number | null) {
  if (utilizationPercent === null) return 0;
  if (utilizationPercent >= 50) return 3;
  if (utilizationPercent >= 30) return 2;
  if (utilizationPercent >= 10) return 1;
  return 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function utilizationStats(rows: readonly LiabilityAccountSummary[]) {
  const rowsWithLimits = rows.filter((row) => row.creditLimit !== null && row.creditLimit > 0);
  if (rowsWithLimits.length === 0) {
    return {
      aggregateUtilizationPercent: null,
      highestIndividualUtilizationPercent: null
    };
  }

  const totalOwed = rowsWithLimits.reduce((sum, row) => sum + row.amountOwed, 0);
  const totalLimit = rowsWithLimits.reduce((sum, row) => sum + (row.creditLimit ?? 0), 0);

  return {
    aggregateUtilizationPercent: totalLimit > 0 ? roundPercent((totalOwed / totalLimit) * 100) : null,
    highestIndividualUtilizationPercent: Math.max(
      ...rowsWithLimits.map((row) => row.utilizationPercent ?? 0)
    )
  };
}

function utilizationTargetBalance(creditLimit: number, utilizationTarget: LiabilityUtilizationTarget) {
  return Math.max(0, roundMoney((creditLimit * utilizationTarget) / 100 - 0.01));
}

function projectedUtilizationPercent(amountOwed: number, payment: number, creditLimit: number) {
  if (creditLimit <= 0) return 0;
  return roundPercent((Math.max(0, amountOwed - payment) / creditLimit) * 100);
}

function paymentTargetSort(
  a: Pick<LiabilityTargetPaymentAction, "amountToTarget" | "currentUtilizationPercent" | "highestAprPercentage" | "reportingDate">,
  b: Pick<LiabilityTargetPaymentAction, "amountToTarget" | "currentUtilizationPercent" | "highestAprPercentage" | "reportingDate">
) {
  const utilizationDiff = b.currentUtilizationPercent - a.currentUtilizationPercent;
  if (utilizationDiff !== 0) return utilizationDiff;
  const aprDiff = (b.highestAprPercentage ?? -1) - (a.highestAprPercentage ?? -1);
  if (aprDiff !== 0) return aprDiff;
  const dateDiff = a.reportingDate.localeCompare(b.reportingDate);
  if (dateDiff !== 0) return dateDiff;
  return b.amountToTarget - a.amountToTarget;
}

export function computeTargetPayments({
  asOfDate,
  cashAvailable,
  cashBuffer = 0,
  processingBufferDays = DEFAULT_PROCESSING_BUFFER_DAYS,
  rows,
  utilizationTarget
}: {
  asOfDate: string;
  cashAvailable: number;
  cashBuffer?: number;
  processingBufferDays?: number;
  rows: readonly LiabilityAccountSummary[];
  utilizationTarget: LiabilityUtilizationTarget;
}): LiabilityTargetPaymentPlan {
  const stats = utilizationStats(rows);
  const allocatableCash = roundMoney(Math.max(0, cashAvailable - Math.max(0, cashBuffer)));
  let remainingAllocatableCash = allocatableCash;

  const candidates = rows.flatMap((row): LiabilityTargetPaymentAction[] => {
    if (row.amountOwed <= 0) return [];
    if (!row.creditLimit || row.creditLimit <= 0 || row.utilizationPercent === null) return [];
    if (!row.reportingDate || row.reportingDateConfidence === "unknown") return [];

    const targetBalance = utilizationTargetBalance(row.creditLimit, utilizationTarget);
    const amountToTarget = roundMoney(Math.max(0, row.amountOwed - targetBalance));
    if (amountToTarget <= 0) return [];

    const rawPayByDate = addDays(row.reportingDate, -Math.max(0, processingBufferDays));
    const payByDate = dayDifference(asOfDate, rawPayByDate) < 0 ? asOfDate : rawPayByDate;

    return [{
      accountId: row.accountId,
      amountOwed: row.amountOwed,
      amountToTarget,
      cashShortfall: amountToTarget,
      creditLimit: row.creditLimit,
      currentUtilizationPercent: row.utilizationPercent,
      dateConfidence: row.reportingDateConfidence,
      dateSource: row.reportingDateSource,
      highestAprPercentage: row.highestAprPercentage ?? null,
      payByDate,
      projectedUtilizationPercent: projectedUtilizationPercent(row.amountOwed, amountToTarget, row.creditLimit),
      reason: "reported_balance_optimization",
      recommendedPayment: 0,
      reportingDate: row.reportingDate,
      targetUtilizationPercent: utilizationTarget
    }];
  }).sort(paymentTargetSort);

  const actions = candidates.map((candidate) => {
    const recommendedPayment = roundMoney(Math.min(candidate.amountToTarget, remainingAllocatableCash));
    remainingAllocatableCash = roundMoney(Math.max(0, remainingAllocatableCash - recommendedPayment));
    return {
      ...candidate,
      cashShortfall: roundMoney(Math.max(0, candidate.amountToTarget - recommendedPayment)),
      recommendedPayment
    };
  });

  return {
    actions,
    aggregateUtilizationPercent: stats.aggregateUtilizationPercent,
    allocatableCash,
    cashAvailable,
    cashBuffer: Math.max(0, cashBuffer),
    highestIndividualUtilizationPercent: stats.highestIndividualUtilizationPercent,
    remainingAllocatableCash,
    targetUtilizationPercent: utilizationTarget
  };
}

export function reportedBalanceActionReason(action: Pick<LiabilityTargetPaymentAction, "dateConfidence" | "targetUtilizationPercent">) {
  const timing = action.dateConfidence === "high"
    ? "current Plaid statement timing"
    : action.dateConfidence === "medium"
      ? "estimated statement timing"
      : "lower-confidence estimated timing";
  return `May help lower the likely reported balance below ${action.targetUtilizationPercent}% using ${timing}; no score outcome is promised.`;
}

/**
 * A card "needs reconnect" for due dates when it carries a balance yet exposes
 * no connected liability fields at all (actual due date, statement issue date,
 * or minimum payment). These cards were linked Transactions-only and a reconnect
 * is required to gain Liabilities consent. Cards with a $0 balance, or cards that
 * already surface any liability field, do not get the prompt.
 */
export function cardNeedsReconnectForDueDates(
  row: Pick<
    LiabilityAccountSummary,
    "amountOwed" | "dueDateIsActual" | "lastStatementIssueDate" | "minimumPaymentAmount"
  >
): boolean {
  if (row.amountOwed <= 0) return false;
  if (row.dueDateIsActual) return false;
  if (row.lastStatementIssueDate) return false;
  if (row.minimumPaymentAmount && row.minimumPaymentAmount > 0) return false;
  return true;
}

function minimumPaymentDue(row: Pick<LiabilityAccountSummary, "amountOwed" | "minimumPaymentAmount">) {
  if (row.amountOwed <= 0) return 0;
  if (row.minimumPaymentAmount && row.minimumPaymentAmount > 0) {
    return Math.min(row.amountOwed, row.minimumPaymentAmount);
  }
  return row.amountOwed;
}

function actionRank(row: Omit<LiabilityAccountSummary, "actionRank">, cashAvailable: number) {
  if (row.amountOwed <= 0) return 0;

  const statusWeight: Record<LiabilityStatus, number> = {
    overdue: 1_000_000,
    "due-soon": 800_000,
    current: 400_000,
    "no-balance": 0
  };
  const dueUrgency = row.daysUntilDue === null
    ? 0
    : Math.max(0, 60 - Math.max(0, row.daysUntilDue)) * 1_000;
  const coveredMinimum = minimumPaymentDue(row) <= Math.max(0, cashAvailable) ? 20_000 : 0;
  const utilization = utilizationRank(row.utilizationPercent) * 10_000 + (row.utilizationPercent ?? 0) * 100;
  const balanceWeight = Math.min(row.amountOwed, 10_000);

  return Math.round(statusWeight[row.status] + dueUrgency + coveredMinimum + utilization + balanceWeight);
}

function findLastPayment(
  accountId: string,
  transactions: readonly LiabilityTransactionInput[]
): { date: string; amount: number } | null {
  for (const transaction of transactions) {
    if (transaction.accountId !== accountId) continue;
    if (transaction.amount <= 0) continue;
    const looksLikePayment =
      transaction.intent === "transfer" ||
      PAYMENT_MERCHANT_HINTS.test(`${transaction.merchant} ${transaction.plaidName ?? ""}`);
    if (!looksLikePayment) continue;
    return { date: transaction.date, amount: transaction.amount };
  }
  return null;
}

function highestAprPercentage(aprs: readonly CreditAprRecord[]) {
  const percentages = aprs
    .map((apr) => apr.aprPercentage)
    .filter((value): value is number => typeof value === "number");
  if (percentages.length === 0) return null;
  return Math.max(...percentages);
}

function purchaseAprPercentage(aprs: readonly CreditAprRecord[]) {
  return aprs.find((apr) => apr.aprType.toLowerCase().includes("purchase"))?.aprPercentage ?? null;
}

function dayOfMonth(iso: string) {
  return parseIsoDate(iso).getUTCDate();
}

/**
 * Infer a recurring autopay/payment anchor from observed card payments.
 *
 * Most cardholders (and all autopay users) pay on or right around the due date
 * each month, so a cluster of monthly payments landing on roughly the same
 * day-of-month is a reliable proxy for the issuer due day. The statement closes
 * ~grace days before that. This lets us derive a statement-cycle estimate that
 * is grounded in the user's actual data instead of the generic due-date+5 guess,
 * and it works even when Plaid never returned a `nextPaymentDueDate`.
 *
 * Returns the inferred most-recent payment anchor date (ISO) when a consistent
 * monthly cadence is detected, else null.
 */
function inferPaymentAnchorFromHistory(
  accountId: string,
  transactions: readonly LiabilityTransactionInput[],
  asOfDate: string
): string | null {
  const payments = transactions
    .filter((transaction) => {
      if (transaction.accountId !== accountId) return false;
      if (transaction.amount <= 0) return false;
      const days = dayDifference(transaction.date, asOfDate);
      if (days === null || days < 0 || days > PAYMENT_CADENCE_LOOKBACK_DAYS) return false;
      return (
        transaction.intent === "transfer" ||
        PAYMENT_MERCHANT_HINTS.test(`${transaction.merchant} ${transaction.plaidName ?? ""}`)
      );
    })
    // De-duplicate to one payment per calendar month so a card paid twice in one
    // month (e.g. a correction) doesn't double-count toward the cadence.
    .reduce<Map<string, string>>((byMonth, transaction) => {
      const monthKey = transaction.date.slice(0, 7);
      const existing = byMonth.get(monthKey);
      if (!existing || transaction.date.localeCompare(existing) > 0) {
        byMonth.set(monthKey, transaction.date);
      }
      return byMonth;
    }, new Map());

  const monthlyPayments = [...payments.values()].sort((a, b) => b.localeCompare(a));
  if (monthlyPayments.length < MIN_OBSERVED_PAYMENTS_FOR_CYCLE) return null;

  const days = monthlyPayments.map(dayOfMonth);
  const spread = Math.max(...days) - Math.min(...days);
  if (spread > MAX_PAYMENT_DAY_SPREAD) return null;

  // Most recent observed payment is the freshest anchor for the cadence.
  return monthlyPayments[0] ?? null;
}

function reportingDateMetadata({
  asOfDate,
  lastStatementIssueDate,
  nextPaymentDueDate,
  paymentAnchorDate
}: {
  asOfDate: string;
  lastStatementIssueDate: string | null | undefined;
  nextPaymentDueDate: string | null;
  // Most-recent observed recurring payment date for this card, when a monthly
  // payment cadence could be inferred from transaction history.
  paymentAnchorDate?: string | null;
}): {
  reportingDate: string | null;
  reportingDateSource: LiabilityReportingDateSource;
  reportingDateConfidence: LiabilityReportingDateConfidence;
} {
  if (lastStatementIssueDate) {
    if (dayDifference(asOfDate, lastStatementIssueDate) >= 0) {
      return {
        reportingDate: lastStatementIssueDate,
        reportingDateConfidence: "high",
        reportingDateSource: "actual_plaid_liability"
      };
    }

    return {
      reportingDate: nextCycleDate(lastStatementIssueDate, asOfDate),
      reportingDateConfidence: "medium",
      reportingDateSource: "inferred_from_statement_cycle"
    };
  }

  // No Plaid statement issue date. Before falling back to the weak due-date+5
  // estimate, try to ground the cycle in the card's observed payment cadence:
  // payments land ~on the due date, and the statement closed ~grace days before
  // that. This is materially better than a generic guess, so we promote it to
  // the same "inferred_from_statement_cycle" / medium tier.
  if (paymentAnchorDate) {
    const estimatedClose = addDays(paymentAnchorDate, -DEFAULT_PAYMENT_GRACE_DAYS);
    return {
      reportingDate: nextCycleDate(estimatedClose, asOfDate),
      reportingDateConfidence: "medium",
      reportingDateSource: "inferred_from_statement_cycle"
    };
  }

  if (nextPaymentDueDate) {
    // Project the NEXT statement close: the due date for a statement lands
    // ~grace days after that statement closed, so close ≈ dueDate − grace, then
    // roll forward by whole months until it's on/after asOfDate.
    const estimatedReportingDate = addDays(nextPaymentDueDate, DEFAULT_BILLING_CYCLE_DAYS - DEFAULT_PAYMENT_GRACE_DAYS);
    return {
      reportingDate: nextCycleDate(estimatedReportingDate, asOfDate),
      reportingDateConfidence: "low",
      reportingDateSource: "estimated_from_due_date"
    };
  }

  return {
    reportingDate: null,
    reportingDateConfidence: "unknown",
    reportingDateSource: "unknown"
  };
}

export function buildLiabilitiesDueSummary({
  accounts,
  asOfDate,
  cashBuffer,
  cashAvailable,
  transactions
}: {
  accounts: readonly AccountRecord[];
  asOfDate?: string;
  cashBuffer?: number;
  cashAvailable: number;
  transactions: readonly LiabilityTransactionInput[];
}): LiabilitiesDueSummary {
  const today = asOfDate ?? isoDate(new Date());
  const sortedTransactions = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  const creditAccounts = accounts.filter(isCreditAccount);

  const rows: LiabilityAccountSummary[] = creditAccounts
    .map((account) => {
      const amountOwed = Math.max(0, Math.abs(account.balance));
      const inferredLastPayment = findLastPayment(account.id, sortedTransactions);
      const plaidLastPayment =
        account.liabilityLastPaymentDate || account.liabilityLastPaymentAmount != null
          ? {
              amount: account.liabilityLastPaymentAmount ?? 0,
              date: account.liabilityLastPaymentDate ?? ""
            }
          : null;
      const lastPayment = plaidLastPayment ?? inferredLastPayment;
      const actualDueDate = account.nextPaymentDueDate ?? null;
      const estimatedDueDate = actualDueDate;
      const daysUntilDue = estimatedDueDate ? dayDifference(today, estimatedDueDate) : null;
      const utilizationPercent = account.creditLimit && account.creditLimit > 0
        ? roundPercent((amountOwed / account.creditLimit) * 100)
        : null;
      const paymentAnchorDate = account.lastStatementIssueDate
        ? null
        : inferPaymentAnchorFromHistory(account.id, sortedTransactions, today);
      const reportingDate = reportingDateMetadata({
        asOfDate: today,
        lastStatementIssueDate: account.lastStatementIssueDate,
        nextPaymentDueDate: actualDueDate,
        paymentAnchorDate
      });
      const isOverdue = account.liabilityIsOverdue ?? null;
      const status = isOverdue && amountOwed > 0 ? "overdue" : statusForDays(daysUntilDue, amountOwed);
      const creditAprs = account.liabilityAprs ?? [];
      const lastPaymentSource: LiabilityAccountSummary["lastPaymentSource"] = plaidLastPayment
        ? "plaid_liability"
        : inferredLastPayment
          ? "transaction_inference"
          : "unknown";

      const row = {
        accountId: account.id,
        amountOwed,
        creditLimit: account.creditLimit,
        daysUntilDue,
        estimatedDueDate,
        institutionName: account.institutionName,
        lastPaymentAmount: lastPayment?.amount ?? null,
        lastPaymentDate: lastPayment?.date || null,
        lastPaymentSource,
        lastStatementIssueDate: account.lastStatementIssueDate ?? null,
        lastStatementBalance: account.lastStatementBalance ?? null,
        minimumPaymentAmount: account.minimumPaymentAmount ?? null,
        isOverdue,
        creditAprs,
        purchaseAprPercentage: purchaseAprPercentage(creditAprs),
        highestAprPercentage: highestAprPercentage(creditAprs),
        dueDateIsActual: Boolean(actualDueDate),
        needsReconnectForDueDates: cardNeedsReconnectForDueDates({
          amountOwed,
          dueDateIsActual: Boolean(actualDueDate),
          lastStatementIssueDate: account.lastStatementIssueDate ?? null,
          minimumPaymentAmount: account.minimumPaymentAmount ?? null
        }),
        mask: account.mask,
        name: account.name,
        reportingDate: reportingDate.reportingDate,
        reportingDateConfidence: reportingDate.reportingDateConfidence,
        reportingDateSource: reportingDate.reportingDateSource,
        status,
        utilizationPercent
      };

      return {
        ...row,
        actionRank: actionRank(row, cashAvailable)
      };
    })
    .sort((a, b) => {
      const rankDiff = b.actionRank - a.actionRank;
      if (rankDiff !== 0) return rankDiff;
      const aDays = a.daysUntilDue ?? Number.POSITIVE_INFINITY;
      const bDays = b.daysUntilDue ?? Number.POSITIVE_INFINITY;
      if (aDays !== bDays) return aDays - bDays;
      return b.amountOwed - a.amountOwed;
    });

  const totalOwed = roundMoney(rows.reduce((sum, row) => sum + row.amountOwed, 0));
  const coverageDelta = roundMoney(cashAvailable - totalOwed);
  const stats = utilizationStats(rows);
  const targetPaymentPlans = UTILIZATION_TARGETS.map((target) =>
    computeTargetPayments({
      asOfDate: today,
      cashAvailable,
      cashBuffer,
      rows,
      utilizationTarget: target
    })
  );

  return {
    aggregateUtilizationPercent: stats.aggregateUtilizationPercent,
    asOfDate: today,
    cashAvailable,
    coverageDelta,
    hasDueSoon: rows.some((row) => row.status === "due-soon"),
    hasOverdue: rows.some((row) => row.status === "overdue"),
    highestIndividualUtilizationPercent: stats.highestIndividualUtilizationPercent,
    rows,
    targetPaymentPlans,
    totalOwed
  };
}
