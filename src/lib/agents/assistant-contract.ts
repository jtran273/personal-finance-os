import type {
  ReimbursementStatus,
  ReviewReason,
  TransactionIntent,
  TransactionStatus
} from "@/lib/db";
import {
  assertFinanceManifestSafe,
  findForbiddenFinanceManifestFields,
  forbiddenFinanceManifestFields,
  type ForbiddenFieldViolation
} from "./finance-action-manifest";

export const ASSISTANT_CONTRACT_VERSION = "2026-05-12" as const;

export const assistantSuggestionTypes = [
  "possible_reimbursable_expense",
  "reimbursement_match",
  "safe_to_spend_warning",
  "clarification_request"
] as const;

export type AssistantSuggestionType = typeof assistantSuggestionTypes[number];

export const forbiddenAssistantContextFields = [
  ...forbiddenFinanceManifestFields,
  "account_number",
  "database_url",
  "email",
  "phone",
  "raw_transaction_id",
  "routing_number",
  "ssn",
  "user_id"
] as const;

export interface AssistantContextPacket {
  contractVersion: typeof ASSISTANT_CONTRACT_VERSION;
  contextId: string;
  contextKind: "reimbursement_review";
  generatedAt: string;
  ledgerRole: "system_of_record";
  openClawRole: "reasoning_layer";
  records: AssistantContextRecord[];
  safety: AssistantContextSafety;
  source: "ledger";
  userScoped: true;
}

export interface AssistantContextSafety {
  excludedFields: ReadonlyArray<(typeof forbiddenAssistantContextFields)[number]>;
  rawProviderPayloadIncluded: false;
  secretsIncluded: false;
  writesAllowed: false;
}

export interface AssistantContextRecord {
  account: AssistantAccountContext;
  amount: number;
  category: string;
  categoryId: string | null;
  confidence: number | null;
  date: string;
  id: string;
  intent: TransactionIntent;
  merchant: string;
  reimbursements: AssistantReimbursementContext[];
  review: AssistantReviewContext;
  splits: AssistantSplitContext[];
  status: TransactionStatus;
}

export interface AssistantAccountContext {
  displayName: string;
  institutionName: string;
  mask: string | null;
}

export interface AssistantReviewContext {
  explanation: string;
  id: string;
  reason: ReviewReason;
  status: "open";
}

export interface AssistantSplitContext {
  amount: number;
  category: string | null;
  id: string;
  intent: TransactionIntent;
  label: string;
}

export interface AssistantReimbursementContext {
  counterparty: string | null;
  dueDate: string | null;
  expectedAmount: number;
  id: string;
  receivedAmount: number;
  status: ReimbursementStatus;
}

export interface AssistantSuggestionResponse {
  contractVersion: typeof ASSISTANT_CONTRACT_VERSION;
  contextId: string;
  generatedAt: string;
  model: string;
  suggestions: AssistantSuggestion[];
  summary: string;
}

export type AssistantSuggestion =
  | PossibleReimbursableExpenseSuggestion
  | ReimbursementMatchSuggestion
  | SafeToSpendWarningSuggestion
  | ClarificationRequestSuggestion;

interface BaseAssistantSuggestion {
  approvalRequired: true;
  confidence: number;
  id: string;
  rationale: string;
  relatedTransactionIds: string[];
  type: AssistantSuggestionType;
}

export interface PossibleReimbursableExpenseSuggestion extends BaseAssistantSuggestion {
  suggestedAction: {
    counterparty: string | null;
    expectedAmount: number;
    markIntentAs: "reimbursable" | "shared";
  };
  type: "possible_reimbursable_expense";
}

export interface ReimbursementMatchSuggestion extends BaseAssistantSuggestion {
  suggestedAction: {
    matchAmount: number;
    reimbursementRecordId: string;
    receivedTransactionId: string;
  };
  type: "reimbursement_match";
}

export interface SafeToSpendWarningSuggestion extends BaseAssistantSuggestion {
  suggestedAction: {
    message: string;
    severity: "info" | "warning";
  };
  type: "safe_to_spend_warning";
}

export interface ClarificationRequestSuggestion extends BaseAssistantSuggestion {
  question: string;
  type: "clarification_request";
}

export interface ForbiddenAssistantValueViolation {
  path: string;
  reason: "bearer_token" | "database_url" | "openai_key" | "plaid_token" | "service_role_key";
}

const forbiddenAssistantFieldSet = new Set<string>(forbiddenAssistantContextFields);

function normalizeFieldName(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function visitObjectValues(value: unknown, visit: (value: unknown, path: string) => void) {
  const seen = new WeakSet<object>();

  function walk(current: unknown, path: string) {
    visit(current, path);

    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    Object.entries(current as Record<string, unknown>).forEach(([key, nested]) => {
      walk(nested, path ? `${path}.${key}` : key);
    });
  }

  walk(value, "");
}

export function findForbiddenAssistantContextFields(value: unknown): ForbiddenFieldViolation[] {
  const manifestViolations = findForbiddenFinanceManifestFields(value);
  const violations = [...manifestViolations];
  const seenPaths = new Set(violations.map((violation) => violation.path));

  visitObjectValues(value, (current, path) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return;

    Object.keys(current as Record<string, unknown>).forEach((key) => {
      const nextPath = path ? `${path}.${key}` : key;
      if (seenPaths.has(nextPath)) return;
      if (!forbiddenAssistantFieldSet.has(normalizeFieldName(key))) return;

      seenPaths.add(nextPath);
      violations.push({ field: key, path: nextPath });
    });
  });

  return violations;
}

export function findForbiddenAssistantSecretValues(value: unknown): ForbiddenAssistantValueViolation[] {
  const violations: ForbiddenAssistantValueViolation[] = [];

  visitObjectValues(value, (current, path) => {
    if (typeof current !== "string") return;
    const candidate = current.trim();

    if (/^Bearer\s+\S{12,}$/i.test(candidate)) {
      violations.push({ path, reason: "bearer_token" });
    }
    if (/\b(?:postgres|postgresql|mysql):\/\/[^ \n]+/i.test(candidate)) {
      violations.push({ path, reason: "database_url" });
    }
    if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/.test(candidate)) {
      violations.push({ path, reason: "openai_key" });
    }
    if (/\b(?:access|public)-(?:sandbox|development|production)-[A-Za-z0-9_-]{12,}\b/.test(candidate)) {
      violations.push({ path, reason: "plaid_token" });
    }
    if (/\bservice[_-]?role[_-]?key\s*[:=]\s*\S{12,}/i.test(candidate)) {
      violations.push({ path, reason: "service_role_key" });
    }
  });

  return violations;
}

export function assertAssistantContextSafe(value: unknown): void {
  assertFinanceManifestSafe(value);

  const fieldViolations = findForbiddenAssistantContextFields(value);
  const valueViolations = findForbiddenAssistantSecretValues(value);

  if (fieldViolations.length > 0 || valueViolations.length > 0) {
    const fields = fieldViolations.map((violation) => violation.path);
    const values = valueViolations.map((violation) => `${violation.path} (${violation.reason})`);
    throw new Error(`Assistant contract contains forbidden data: ${[...fields, ...values].join(", ")}`);
  }
}
