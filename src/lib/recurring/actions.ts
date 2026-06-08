import {
  listRecurringExpenses,
  recordAuditEvent,
  resolveReviewItem,
  updateRecurringExpense,
  updateTransactionEnrichment,
  upsertRecurringExpense,
  type EnrichedTransactionRow,
  type FinanceSupabaseClient,
  type Json,
  type RecurringExpenseRecord
} from "../db";
import { calculateNextDueDate, normalizeRecurringMerchant } from "./detector";
import type {
  BuildConfirmRecurringActionOptions,
  BuildDismissRecurringActionOptions,
  DetectedRecurringCadence,
  ConfirmRecurringCandidatePayload,
  DismissRecurringCandidatePayload,
  RecurringCandidate,
  RecurringExpenseUpsertPayload,
  RecurringReviewResolutionPayload,
  RecurringTransactionPatchPayload
} from "./types";

const RECURRING_REVIEW_REASONS = new Set(["new-recurring", "recurring-candidate"]);
const RECURRING_EXPENSE_CONFLICT_COLUMNS = ["user_id", "merchant_name", "cadence"] as const;
const DEFAULT_TRANSACTION_RECURRING_CADENCE: DetectedRecurringCadence = "monthly";
const DEFAULT_TRANSACTION_RECURRING_CONFIDENCE = 0.55;

type RecurringExpenseSeedTransaction = Pick<
  EnrichedTransactionRow,
  "account_id" | "amount" | "category_id" | "date" | "id" | "merchant_name" | "user_id"
>;

interface BuildPendingRecurringFromTransactionOptions {
  asOfDate?: string;
  cadence?: DetectedRecurringCadence;
  confidence?: number;
}

interface ApplyPendingRecurringFromTransactionOptions extends BuildPendingRecurringFromTransactionOptions {
  actorId?: string | null;
}

function roundRecurringAmount(amount: number) {
  return Math.round(Math.abs(amount) * 100) / 100;
}

export function findExistingRecurringExpenseForMerchant(
  merchant: string,
  existingRecurring: readonly RecurringExpenseRecord[]
) {
  const normalizedMerchant = normalizeRecurringMerchant(merchant);
  if (!normalizedMerchant) return null;

  return existingRecurring.find((expense) =>
    expense.status !== "dismissed" &&
    normalizeRecurringMerchant(expense.merchant) === normalizedMerchant
  ) ?? null;
}

export function buildPendingRecurringExpenseFromTransactionPayload(
  transaction: RecurringExpenseSeedTransaction,
  options: BuildPendingRecurringFromTransactionOptions = {}
): RecurringExpenseUpsertPayload | null {
  const merchant = transaction.merchant_name.trim();
  const amount = roundRecurringAmount(transaction.amount);
  if (!merchant || transaction.amount >= 0 || amount <= 0) return null;

  const cadence = options.cadence ?? DEFAULT_TRANSACTION_RECURRING_CADENCE;
  const nextDueDate = calculateNextDueDate(
    transaction.date,
    cadence,
    options.asOfDate ?? new Date().toISOString().slice(0, 10)
  );

  return {
    table: "recurring_expenses",
    conflictColumns: RECURRING_EXPENSE_CONFLICT_COLUMNS,
    values: {
      user_id: transaction.user_id,
      merchant_rule_id: null,
      category_id: transaction.category_id,
      account_id: transaction.account_id,
      last_transaction_id: transaction.id,
      merchant_name: merchant,
      amount,
      cadence,
      next_due_date: nextDueDate,
      last_charge_date: transaction.date,
      last_amount: amount,
      status: "pending",
      is_new: true,
      confidence: options.confidence ?? DEFAULT_TRANSACTION_RECURRING_CONFIDENCE
    }
  };
}

export async function addPendingRecurringExpenseFromTransaction(
  client: FinanceSupabaseClient,
  userId: string,
  transaction: RecurringExpenseSeedTransaction,
  options: ApplyPendingRecurringFromTransactionOptions = {}
) {
  const payload = buildPendingRecurringExpenseFromTransactionPayload(transaction, options);
  if (!payload) return null;

  const merchantName = String(payload.values.merchant_name ?? "").trim();
  if (!merchantName) return null;

  const existingRecurring = await listRecurringExpenses(client, userId, ["active", "pending", "paused"]);
  const existingMerchant = findExistingRecurringExpenseForMerchant(
    merchantName,
    existingRecurring
  );
  if (existingMerchant) return null;

  const recurringExpense = await upsertRecurringExpense(
    client,
    userId,
    payload.values,
    payload.conflictColumns.join(",")
  );

  await recordAuditEvent(client, userId, {
    action: "recurring.transaction_flag_added",
    actorId: options.actorId ?? userId,
    afterData: {
      amount: payload.values.amount,
      cadence: payload.values.cadence,
      isNew: payload.values.is_new,
      merchant: merchantName,
      nextDueDate: payload.values.next_due_date,
      status: payload.values.status
    },
    beforeData: null,
    entityId: recurringExpense.id,
    entityTable: payload.table,
    metadata: {
      source: "transaction_edit_form",
      transactionId: transaction.id
    }
  });

  return recurringExpense;
}

function recurringExpensePayload(
  candidate: RecurringCandidate,
  status: RecurringExpenseUpsertPayload["values"]["status"],
  isNew: boolean
): RecurringExpenseUpsertPayload {
  return {
    table: "recurring_expenses",
    conflictColumns: RECURRING_EXPENSE_CONFLICT_COLUMNS,
    values: {
      user_id: candidate.userId,
      merchant_rule_id: null,
      category_id: candidate.categoryId,
      account_id: candidate.accountId,
      last_transaction_id: candidate.lastTransactionId,
      merchant_name: candidate.merchant,
      amount: candidate.amount,
      cadence: candidate.cadence,
      next_due_date: candidate.nextDueDate,
      last_charge_date: candidate.lastChargeDate,
      last_amount: candidate.lastAmount,
      status,
      is_new: isNew,
      confidence: candidate.confidence
    }
  };
}

export function buildConfirmRecurringPayload(
  candidate: RecurringCandidate,
  options: BuildConfirmRecurringActionOptions = {}
): ConfirmRecurringCandidatePayload {
  return {
    action: "confirm-recurring",
    candidateId: candidate.id,
    recurringExpense: recurringExpensePayload(candidate, options.status ?? "active", false),
    transactionUpdates: candidate.transactions.map((transaction) =>
      transactionPatch(transaction.id, true, options.reviewedAt)
    ),
    reviewResolutions: reviewResolutions(
      candidate,
      "resolved",
      options.resolutionNote ?? "Confirmed recurring expense candidate."
    )
  };
}

export function buildDismissRecurringPayload(
  candidate: RecurringCandidate,
  options: BuildDismissRecurringActionOptions = {}
): DismissRecurringCandidatePayload {
  const markTransactionsNonRecurring = options.markTransactionsNonRecurring ?? candidate.isNew;
  const payload: DismissRecurringCandidatePayload = {
    action: "dismiss-recurring",
    candidateId: candidate.id,
    transactionUpdates: markTransactionsNonRecurring
      ? candidate.transactions.map((transaction) => transactionPatch(transaction.id, false, options.reviewedAt))
      : [],
    reviewResolutions: reviewResolutions(
      candidate,
      "dismissed",
      options.resolutionNote ?? "Dismissed recurring expense candidate."
    )
  };

  if (!candidate.existingRecurringId) {
    payload.recurringExpense = recurringExpensePayload(candidate, "dismissed", false);
  } else if (candidate.isNew) {
    payload.recurringExpenseUpdate = {
      table: "recurring_expenses",
      id: candidate.existingRecurringId,
      values: {
        status: "dismissed",
        is_new: false
      }
    };
  }

  return payload;
}

export async function applyConfirmRecurringPayload(
  client: FinanceSupabaseClient,
  userId: string,
  payload: ConfirmRecurringCandidatePayload,
  options: { actorId?: string | null } = {}
) {
  const recurringExpense = await upsertRecurringExpense(
    client,
    userId,
    payload.recurringExpense.values,
    payload.recurringExpense.conflictColumns.join(",")
  );

  await applyTransactionUpdates(client, userId, payload.transactionUpdates);
  await applyReviewResolutions(client, userId, payload.reviewResolutions);

  await recordAuditEvent(client, userId, {
    action: "recurring.candidate_confirmed",
    actorId: options.actorId ?? userId,
    afterData: recurringAuditData(payload),
    beforeData: null,
    entityId: recurringExpense.id,
    entityTable: payload.recurringExpense.table,
    metadata: recurringAuditMetadata(payload)
  });

  return recurringExpense;
}

export async function applyDismissRecurringPayload(
  client: FinanceSupabaseClient,
  userId: string,
  payload: DismissRecurringCandidatePayload,
  options: { actorId?: string | null } = {}
) {
  const recurringExpense = payload.recurringExpenseUpdate
    ? await updateRecurringExpense(client, userId, payload.recurringExpenseUpdate.id, payload.recurringExpenseUpdate.values)
    : payload.recurringExpense
      ? await upsertRecurringExpense(
        client,
        userId,
        payload.recurringExpense.values,
        payload.recurringExpense.conflictColumns.join(",")
      )
      : null;

  await applyTransactionUpdates(client, userId, payload.transactionUpdates);
  await applyReviewResolutions(client, userId, payload.reviewResolutions);

  await recordAuditEvent(client, userId, {
    action: "recurring.candidate_dismissed",
    actorId: options.actorId ?? userId,
    afterData: recurringAuditData(payload),
    beforeData: null,
    entityId: recurringExpense?.id ?? null,
    entityTable: payload.recurringExpenseUpdate?.table ?? payload.recurringExpense?.table ?? "recurring_expenses",
    metadata: recurringAuditMetadata(payload)
  });

  return recurringExpense;
}

function transactionPatch(
  transactionId: string,
  isRecurring: boolean,
  reviewedAt: string | null | undefined
): RecurringTransactionPatchPayload {
  const patch: RecurringTransactionPatchPayload["patch"] = { isRecurring };
  if (reviewedAt !== undefined) patch.reviewedAt = reviewedAt;

  return {
    transactionId,
    patch
  };
}

function reviewResolutions(
  candidate: RecurringCandidate,
  status: RecurringReviewResolutionPayload["status"],
  resolutionNote: string
): RecurringReviewResolutionPayload[] {
  const resolutionKind: RecurringReviewResolutionPayload["resolutionKind"] =
    status === "dismissed" ? "dismissed" : "accepted_manual";

  return candidate.transactions.flatMap((transaction) =>
    transaction.reviewItems
      .filter((review) => review.status === "open" && RECURRING_REVIEW_REASONS.has(review.reason))
      .map((review) => ({
        reviewItemId: review.id,
        resolutionKind,
        status,
        resolutionNote
      }))
  );
}

async function applyTransactionUpdates(
  client: FinanceSupabaseClient,
  userId: string,
  updates: RecurringTransactionPatchPayload[]
) {
  await Promise.all(
    updates.map((update) =>
      updateTransactionEnrichment(client, userId, update.transactionId, update.patch)
    )
  );
}

async function applyReviewResolutions(
  client: FinanceSupabaseClient,
  userId: string,
  resolutions: RecurringReviewResolutionPayload[]
) {
  await Promise.all(
    resolutions.map((resolution) =>
      resolveReviewItem(
        client,
        userId,
        resolution.reviewItemId,
        resolution.status,
        resolution.resolutionKind,
        resolution.resolutionNote
      )
    )
  );
}

function recurringAuditData(payload: ConfirmRecurringCandidatePayload | DismissRecurringCandidatePayload): Json {
  const recurringStatus = payload.action === "confirm-recurring"
    ? payload.recurringExpense.values.status
    : payload.recurringExpense?.values.status ?? payload.recurringExpenseUpdate?.values.status ?? null;

  return {
    action: payload.action,
    candidateId: payload.candidateId,
    recurringStatus,
    reviewResolutionCount: payload.reviewResolutions.length,
    transactionUpdateCount: payload.transactionUpdates.length
  };
}

function recurringAuditMetadata(payload: ConfirmRecurringCandidatePayload | DismissRecurringCandidatePayload) {
  return {
    candidateId: payload.candidateId,
    reviewItemIds: payload.reviewResolutions.map((resolution) => resolution.reviewItemId),
    transactionIds: payload.transactionUpdates.map((update) => update.transactionId)
  };
}
