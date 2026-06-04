import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantContextSafe } from "@/lib/agents";
import type { LiabilityAccountSummary, LiabilitiesDueSummary } from "@/lib/finance/liabilities";
import { buildOpenClawCreditNudgePackets } from "./credit-nudges";

function row(input: Partial<LiabilityAccountSummary> = {}): LiabilityAccountSummary {
  return {
    accountId: "internal-account-1",
    amountOwed: 900,
    creditLimit: 2000,
    daysUntilDue: 12,
    dueDateIsActual: true,
    estimatedDueDate: "2026-06-16",
    institutionName: "Chase 123456789",
    lastPaymentAmount: null,
    lastPaymentDate: null,
    lastStatementBalance: 900,
    lastStatementIssueDate: "2026-05-23",
    mask: "6789",
    minimumPaymentAmount: 35,
    name: "Freedom 6789",
    reportingDate: "2026-06-22",
    reportingDateAnchorDate: "2026-05-23",
    reportingDateConfidence: "medium",
    reportingDateSource: "inferred_from_statement_cycle",
    status: "current",
    utilizationPercent: 45,
    ...input
  };
}

function summary(input: {
  asOfDate?: string;
  cashAvailable?: number;
  rows?: LiabilityAccountSummary[];
} = {}): LiabilitiesDueSummary {
  const rows = input.rows ?? [row()];
  const totalOwed = rows.reduce((sum, item) => sum + item.amountOwed, 0);
  const cashAvailable = input.cashAvailable ?? 700;
  return {
    asOfDate: input.asOfDate ?? "2026-06-01",
    cashAvailable,
    coverageDelta: cashAvailable - totalOwed,
    hasDueSoon: rows.some((item) => item.status === "due-soon"),
    hasOverdue: rows.some((item) => item.status === "overdue"),
    rows,
    totalOwed
  };
}

test("credit nudge packets sanitize display labels and avoid provider-shaped data", () => {
  const [packet] = buildOpenClawCreditNudgePackets({
    generatedAt: "2026-06-01T12:00:00.000Z",
    liabilities: summary({
      rows: [row({
        amountOwed: 1200,
        creditLimit: 2000,
        daysUntilDue: 12,
        estimatedDueDate: "2026-06-16",
        lastStatementIssueDate: "2026-05-07",
        reportingDate: "2026-06-06",
        reportingDateAnchorDate: "2026-05-07",
        utilizationPercent: 60
      })]
    })
  });

  assert.equal(packet.reason, "high_utilization_near_close");
  assert.equal(packet.cardLabel, "Chase card");
  assert.doesNotMatch(JSON.stringify(packet), /123456789|6789|plaid|provider|access_token/i);
  assertAssistantContextSafe(packet);
});

test("credit nudge packet ids are stable across poll timestamps", () => {
  const liabilities = summary({
    asOfDate: "2026-06-12",
    rows: [row({
      amountOwed: 700,
      creditLimit: 2000,
      estimatedDueDate: "2026-06-16",
      lastStatementIssueDate: "2026-05-23",
      utilizationPercent: 35
    })]
  });

  const first = buildOpenClawCreditNudgePackets({
    generatedAt: "2026-06-01T12:00:00.000Z",
    liabilities
  });
  const second = buildOpenClawCreditNudgePackets({
    generatedAt: "2026-06-01T12:30:00.000Z",
    liabilities
  });

  assert.equal(first.length, 1);
  assert.equal(first[0].id, second[0].id);
});

test("credit nudges skip low-confidence or low-value cards", () => {
  const packets = buildOpenClawCreditNudgePackets({
    generatedAt: "2026-06-01T12:00:00.000Z",
    liabilities: summary({
      cashAvailable: 500,
      rows: [row({
        amountOwed: 200,
        creditLimit: 2000,
        daysUntilDue: 20,
        estimatedDueDate: "2026-06-21",
        lastStatementIssueDate: null,
        utilizationPercent: 10
      })]
    })
  });

  assert.deepEqual(packets, []);
});

test("credit nudges pick one cash-safe payment to get under 30 percent", () => {
  const [packet] = buildOpenClawCreditNudgePackets({
    generatedAt: "2026-06-01T12:00:00.000Z",
    liabilities: summary({
      asOfDate: "2026-06-12",
      cashAvailable: 1000,
      rows: [row({
        amountOwed: 700,
        creditLimit: 2000,
        daysUntilDue: 12,
        estimatedDueDate: "2026-06-16",
        lastStatementIssueDate: "2026-05-23",
        utilizationPercent: 35
      })]
    })
  });

  assert.equal(packet.reason, "cash_safe_under_30");
  assert.equal(packet.amount, 102);
  assert.equal(packet.deadline, "2026-06-19");
  assert.match(packet.body, /under 30% utilization/);
  assert.match(packet.body, /will not initiate payment/);
  assertAssistantContextSafe(packet);
});

test("credit nudges prefer due-date risk over utilization optimization", () => {
  const [packet] = buildOpenClawCreditNudgePackets({
    generatedAt: "2026-06-01T12:00:00.000Z",
    liabilities: summary({
      cashAvailable: 1000,
      rows: [row({
        amountOwed: 1200,
        creditLimit: 2000,
        daysUntilDue: 1,
        estimatedDueDate: "2026-06-02",
        lastStatementIssueDate: "2026-05-15",
        minimumPaymentAmount: 40,
        status: "due-soon",
        utilizationPercent: 60
      })]
    })
  });

  assert.equal(packet.reason, "due_date_risk");
  assert.equal(packet.amount, 40);
  assert.match(packet.body, /protects payment history/);
});
