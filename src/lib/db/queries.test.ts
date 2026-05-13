import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentProposal,
  dismissAgentProposal,
  filterTransactionRecordsForList,
  type FinanceSupabaseClient,
  listAgentProposals,
  recordClarificationAnswer,
  transactionMatchesSearch
} from "./queries";
import type {
  AgentProposalRow,
  AuditEventRow,
  ReviewItemRecord,
  ReviewReason,
  ReviewStatus,
  TransactionIntent,
  TransactionRecord
} from "./types";

const userId = "11111111-1111-1111-1111-111111111111";

function review(
  id: string,
  transactionId: string,
  status: ReviewStatus,
  reason: ReviewReason = "low-confidence"
): ReviewItemRecord {
  return {
    aiSuggestion: {},
    confidence: 0.71,
    createdAt: "2026-05-06T12:00:00.000Z",
    explanation: "Fixture review item",
    id,
    reason,
    resolutionNote: null,
    resolvedAt: null,
    status,
    transactionId
  };
}

function transaction(
  input: Pick<TransactionRecord, "id" | "merchant"> & Partial<TransactionRecord>
): TransactionRecord {
  const { id, merchant, ...overrides } = input;
  const reviewItems = input.reviewItems ?? [];

  return {
    accountId: "account-checking",
    accountMask: "1111",
    accountName: "Everyday Checking",
    amount: -25,
    category: "Food / Restaurants",
    categoryId: "category-food",
    confidence: 0.91,
    date: "2026-05-06",
    institutionName: "Seed Bank",
    intent: "personal" as TransactionIntent,
    note: "",
    plaidCategory: null,
    plaidMerchant: null,
    plaidTransactionId: `plaid-${input.id}`,
    rawTransactionId: `raw-${input.id}`,
    recurring: false,
    reimbursements: [],
    reviewedAt: null,
    reviewItems,
    reviewReason: reviewItems.find((item) => item.status === "open")?.reason ?? null,
    reviewStatus: reviewItems.find((item) => item.status === "open")?.status ?? null,
    splits: [],
    status: "posted",
    userId,
    ...overrides,
    id,
    merchant,
    plaidName: overrides.plaidName ?? null
  };
}

export const transactionFilterFixture = [
  transaction({ id: "tx-coffee", merchant: "Blue Bottle" }),
  transaction({
    category: "Transfer",
    categoryId: "category-transfer",
    id: "tx-transfer",
    intent: "transfer",
    merchant: "Online Transfer"
  }),
  transaction({
    id: "tx-rideshare",
    merchant: "Lyft",
    note: "Airport ride",
    plaidCategory: "TRANSPORTATION / TAXIS_AND_RIDE_SHARES",
    plaidMerchant: "LYFT TRIP",
    reviewItems: [review("review-rideshare", "tx-rideshare", "open")]
  }),
  transaction({
    id: "tx-grocery",
    merchant: "Grocery Mart",
    reviewItems: [review("review-grocery", "tx-grocery", "resolved", "large")]
  }),
  transaction({
    category: "Uncategorized",
    categoryId: null,
    confidence: 0.43,
    id: "tx-uncategorized",
    merchant: "Unknown POS"
  })
] satisfies readonly TransactionRecord[];

export const transactionSearchFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  search: "ride shares"
});

export const transactionExcludeTransferFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  excludeTransfers: true
});

export const transactionOpenReviewFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  reviewStatus: "open"
});

export const transactionPagedFixture = filterTransactionRecordsForList(transactionFilterFixture, {
  excludeTransfers: true,
  limit: 1,
  offset: 1
});

export const transactionFilterStaticAssertions = assertTransactionFilterFixtures();

test("transaction search matches normalized Plaid category text", () => {
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { search: "ride shares" }).map((item) => item.id),
    ["tx-rideshare"]
  );
});

test("transaction search covers merchant, raw Plaid merchant/name, category, account, mask, institution, and note", () => {
  const transactionUnderTest = transaction({
    accountMask: "9876",
    accountName: "Schools First Checking",
    category: "Food / Restaurants",
    id: "tx-search-surface",
    institutionName: "Schools First FCU",
    merchant: "Lyft",
    note: "Airport ride",
    plaidCategory: "TRANSPORTATION / TAXIS_AND_RIDE_SHARES",
    plaidMerchant: "LYFT TRIP",
    plaidName: "SQ *LYFT ORIGINAL DESCRIPTION"
  });

  [
    "Lyft",
    "LYFT TRIP",
    "original description",
    "restaurants",
    "schools first checking",
    "9876",
    "Schools First FCU",
    "airport ride",
    "taxis and ride shares"
  ].forEach((query) => {
    assert.equal(transactionMatchesSearch(transactionUnderTest, query), true, `Expected search to match ${query}`);
  });
});

test("transaction list filters compose review, transfer exclusion, limit, and offset after search", () => {
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { excludeTransfers: true }).map((item) => item.id),
    ["tx-coffee", "tx-rideshare", "tx-grocery", "tx-uncategorized"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { reviewStatus: "open" }).map((item) => item.id),
    ["tx-rideshare"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { reviewReason: "large" }).map((item) => item.id),
    ["tx-grocery"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { reviewReason: "low-confidence", reviewStatus: "open" }).map((item) => item.id),
    ["tx-rideshare"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, {
      excludeTransfers: true,
      limit: 1,
      offset: 1
    }).map((item) => item.id),
    ["tx-rideshare"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { quality: "needs-cleanup" }).map((item) => item.id),
    ["tx-rideshare", "tx-uncategorized"]
  );
  assert.deepEqual(
    filterTransactionRecordsForList(transactionFilterFixture, { quality: "uncategorized" }).map((item) => item.id),
    ["tx-uncategorized"]
  );
});

type FakeTableName = "agent_proposals" | "audit_events";

class FakeQueryBuilder<Row extends Record<string, unknown>> {
  private filters: Array<(row: Row) => boolean> = [];
  private gteFilters: Array<(row: Row) => boolean> = [];
  private orderBy: { column: keyof Row; ascending: boolean } | null = null;
  private singleResult = false;

  constructor(
    private rows: Row[],
    private operation: "select" | "insert" | "update" | "delete",
    private values?: Partial<Row> | Partial<Row>[]
  ) {}

  select() {
    return this;
  }

  eq(column: keyof Row & string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: keyof Row & string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  gte(column: keyof Row & string, value: string | number) {
    this.gteFilters.push((row) => String(row[column]) >= String(value));
    return this;
  }

  lte() {
    return this;
  }

  order(column: keyof Row & string, options: { ascending?: boolean } = {}) {
    this.orderBy = { column, ascending: options.ascending ?? true };
    return this;
  }

  limit() {
    return this;
  }

  single() {
    this.singleResult = true;
    return this;
  }

  then<TResult1 = { data: Row[] | Row | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | Row | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    if (this.operation === "insert") {
      const inserted = (Array.isArray(this.values) ? this.values : [this.values ?? {}]).map((value) => {
        const now = "2026-05-13T08:00:00.000Z";
        const rawValue = value as Record<string, unknown>;
        const id = typeof rawValue.id === "string" ? rawValue.id : `row-${this.rows.length + 1}`;
        const row = {
          id,
          created_at: now,
          updated_at: now,
          status: "pending",
          ...value
        } as unknown as Row;
        this.rows.push(row);
        return row;
      });
      return { data: this.singleResult ? inserted[0] ?? null : inserted, error: null };
    }

    let matches = this.rows.filter((row) =>
      this.filters.every((filter) => filter(row)) &&
      this.gteFilters.every((filter) => filter(row))
    );

    if (this.operation === "update") {
      matches.forEach((row) => Object.assign(row, this.values));
    }

    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      matches = [...matches].sort((left, right) => {
        const comparison = String(left[column]).localeCompare(String(right[column]));
        return ascending ? comparison : -comparison;
      });
    }

    return { data: this.singleResult ? matches[0] ?? null : matches, error: null };
  }
}

class FakeFinanceClient {
  agentProposals: AgentProposalRow[] = [];
  auditEvents: AuditEventRow[] = [];

  asClient(): FinanceSupabaseClient {
    return this as unknown as FinanceSupabaseClient;
  }

  from(table: FakeTableName) {
    const rows = (table === "agent_proposals" ? this.agentProposals : this.auditEvents) as unknown as Array<Record<string, unknown>>;
    return {
      delete: () => new FakeQueryBuilder(rows, "delete"),
      insert: (values: Partial<AgentProposalRow> | Partial<AuditEventRow> | Array<Partial<AgentProposalRow> | Partial<AuditEventRow>>) =>
        new FakeQueryBuilder(rows, "insert", values as Array<Partial<Record<string, unknown>>>),
      select: () => new FakeQueryBuilder(rows, "select"),
      update: (values: Partial<AgentProposalRow> | Partial<AuditEventRow>) =>
        new FakeQueryBuilder(rows, "update", values as Partial<Record<string, unknown>>),
      upsert: (values: Partial<AgentProposalRow> | Partial<AgentProposalRow>[]) =>
        new FakeQueryBuilder(rows, "insert", values)
    };
  }
}

function agentProposalRow(input: Partial<AgentProposalRow> = {}): AgentProposalRow {
  return {
    accepted_at: null,
    answered_at: null,
    clarification_answer: null,
    clarification_answer_kind: null,
    clarification_question: null,
    confidence: 0.74,
    created_at: "2026-05-13T08:00:00.000Z",
    dismissed_at: null,
    evidence: {},
    expires_at: null,
    id: "proposal-1",
    proposal_type: "clarification_request",
    proposed_patch: {},
    question_fingerprint: "fingerprint",
    source_agent: "test-agent",
    source_candidate_id: null,
    source_context_id: null,
    status: "pending",
    target_id: "11111111-1111-1111-1111-111111111111",
    target_kind: "enriched_transaction",
    updated_at: "2026-05-13T08:00:00.000Z",
    user_id: userId,
    ...input
  };
}

test("agent proposals insert, list pending, and filter expired rows", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposalRow({
    expires_at: "2026-05-12T08:00:00.000Z",
    id: "expired"
  }));

  const created = await createAgentProposal(client.asClient(), userId, {
    clarificationQuestion: "Was this reimbursable?",
    evidence: { merchant: "Dinner" },
    proposedPatch: { suggestedIntent: "reimbursable" },
    proposalType: "clarification_request",
    sourceAgent: "test-agent",
    targetId: "22222222-2222-2222-2222-222222222222",
    targetKind: "enriched_transaction"
  });

  assert.equal(created.status, "pending");
  const pending = await listAgentProposals(client.asClient(), userId, { status: "pending" });
  assert.deepEqual(pending.map((proposal) => proposal.id), [created.id]);
});

test("agent proposal safety rejects forbidden evidence before insert", async () => {
  const client = new FakeFinanceClient();

  await assert.rejects(
    () => createAgentProposal(client.asClient(), userId, {
      evidence: { raw_payload: { provider: "secret" } },
      proposalType: "safe_to_spend_warning",
      sourceAgent: "test-agent",
      targetId: "22222222-2222-2222-2222-222222222222",
      targetKind: "enriched_transaction"
    }),
    /forbidden data|forbidden fields/i
  );
  assert.equal(client.agentProposals.length, 0);
});

test("dismissAgentProposal is idempotent and records audit once", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposalRow());

  const dismissed = await dismissAgentProposal(client.asClient(), userId, "proposal-1");
  const dismissedAgain = await dismissAgentProposal(client.asClient(), userId, "proposal-1");

  assert.equal(dismissed.status, "dismissed");
  assert.equal(dismissedAgain.status, "dismissed");
  assert.equal(client.auditEvents.length, 1);
});

test("recordClarificationAnswer normalizes terse replies and stores answered status", async () => {
  const client = new FakeFinanceClient();
  client.agentProposals.push(agentProposalRow());

  const answered = await recordClarificationAnswer(client.asClient(), userId, "proposal-1", "Ryan dinner");

  assert.equal(answered.status, "answered");
  assert.equal(answered.clarificationAnswer, "Ryan dinner");
  assert.equal(answered.clarificationAnswerKind, "counterparty");
  assert.deepEqual(answered.proposedPatch, { counterparties: ["Ryan"] });
});

function assertTransactionFilterFixtures(): true {
  if (transactionSearchFixture.length !== 1 || transactionSearchFixture[0]?.id !== "tx-rideshare") {
    throw new Error("Expected transaction search to include raw Plaid category and merchant text.");
  }

  if (transactionExcludeTransferFixture.some((item) => item.intent === "transfer")) {
    throw new Error("Expected excludeTransfers to remove transfer-intent transactions.");
  }

  if (transactionOpenReviewFixture.length !== 1 || transactionOpenReviewFixture[0]?.id !== "tx-rideshare") {
    throw new Error("Expected reviewStatus=open to include only transactions with open review items.");
  }

  if (transactionPagedFixture.length !== 1 || transactionPagedFixture[0]?.id !== "tx-rideshare") {
    throw new Error("Expected limit and offset to apply after search/review/transfer filters.");
  }

  return true;
}
