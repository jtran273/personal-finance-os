import type {
  CategoryRecord,
  CategoryRow,
  EnrichedTransactionRow,
  MerchantRuleRow,
  RawTransactionRow,
  TransactionIntent
} from "./db";
import type { NormalizedReviewSuggestion } from "./review/suggestions";

export interface MerchantRuleCandidate {
  categoryId: string;
  intent: TransactionIntent;
  isRecurring: boolean | null;
  merchantPattern: string;
  normalizedMerchantName: string;
  notes: string;
  priority: number;
}

export interface RuleAppliedEnrichment {
  categoryId?: string | null;
  categoryName?: string;
  confidence: number;
  intent?: TransactionIntent;
  isRecurring?: boolean;
  merchantName?: string;
  note: string;
  source: "rule";
}

const DEFAULT_ACCEPTED_AI_RULE_PRIORITY = 80;
const RULE_CONFIDENCE = 0.96;
const PEER_TO_PEER_MERCHANT_PATTERN = /\b(apple cash|cash app|cashapp|venmo|zelle)\b/i;
const WILDCARD_PATTERN = /[%_]/g;

function cleanText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, " ") || null;
}

function normalizeMerchantKey(value: string) {
  return value
    .toUpperCase()
    .replace(/['".,;:()[\]{}#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeLikePattern(value: string) {
  return value.replace(WILDCARD_PATTERN, (match) => `\\${match}`);
}

function merchantEvidence(raw: RawTransactionRow | null, fallback: string | null) {
  const direct = cleanText(raw?.merchant_name) ?? cleanText(fallback);
  if (direct) return direct;

  const name = cleanText(raw?.name);
  if (!name) return null;

  return name
    .replace(/\b(pos|debit|credit|card|purchase|sq)\b/gi, " ")
    .replace(/[*#]\S*/g, " ")
    .replace(/\s+/g, " ")
    .trim() || name;
}

function findCategoryId(categories: readonly CategoryRecord[], suggestion: NormalizedReviewSuggestion) {
  if (suggestion.categoryId && categories.some((category) => category.id === suggestion.categoryId)) {
    return suggestion.categoryId;
  }

  const categoryName = cleanText(suggestion.categoryName);
  if (!categoryName) return null;

  return categories.find((category) => category.name.toLowerCase() === categoryName.toLowerCase())?.id ?? null;
}

function ruleCategoryName(rule: MerchantRuleRow, categoryById: Map<string, CategoryRow>) {
  return rule.category_id ? categoryById.get(rule.category_id)?.name ?? null : null;
}

function amountMatchesRule(rule: MerchantRuleRow, amount: number) {
  const absoluteAmount = Math.abs(amount);
  if (rule.min_amount !== null && absoluteAmount < Math.abs(rule.min_amount)) return false;
  if (rule.max_amount !== null && absoluteAmount > Math.abs(rule.max_amount)) return false;
  return true;
}

function patternMatchesText(pattern: string, value: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
  return regex.test(value);
}

export function buildAcceptedAiMerchantRuleCandidate({
  categories,
  rawTransaction,
  suggestion,
  transaction
}: {
  categories: readonly CategoryRecord[];
  rawTransaction: RawTransactionRow | null;
  suggestion: NormalizedReviewSuggestion;
  transaction: Pick<EnrichedTransactionRow, "amount" | "merchant_name">;
}): MerchantRuleCandidate | null {
  const normalizedMerchantName = cleanText(suggestion.merchantName);
  const categoryId = findCategoryId(categories, suggestion);
  const merchant = merchantEvidence(rawTransaction, normalizedMerchantName ?? transaction.merchant_name);
  const merchantKey = merchant ? normalizeMerchantKey(merchant) : null;

  if (!normalizedMerchantName || !categoryId || !suggestion.intent || !merchantKey) return null;
  if (suggestion.intent === "transfer") return null;
  if (PEER_TO_PEER_MERCHANT_PATTERN.test(`${merchantKey} ${normalizedMerchantName}`)) return null;
  if (merchantKey.length < 4 || merchantKey.split(" ").every((part) => part.length <= 2)) return null;

  return {
    categoryId,
    intent: suggestion.intent,
    isRecurring: suggestion.recurring ?? null,
    merchantPattern: `${escapeLikePattern(merchantKey)}%`,
    normalizedMerchantName,
    notes: `Accepted AI cleanup for ${normalizedMerchantName} on ${new Date().toISOString().slice(0, 10)}.`,
    priority: DEFAULT_ACCEPTED_AI_RULE_PRIORITY
  };
}

export function findMatchingMerchantRule(
  rules: readonly MerchantRuleRow[],
  raw: Pick<RawTransactionRow, "amount" | "merchant_name" | "name">
) {
  const merchantTexts = [
    cleanText(raw.merchant_name),
    cleanText(raw.name)
  ].filter((value): value is string => Boolean(value));
  const normalizedTexts = merchantTexts.map(normalizeMerchantKey);

  return [...rules]
    .filter((rule) => rule.enabled)
    .sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at))
    .find((rule) =>
      amountMatchesRule(rule, raw.amount) &&
      normalizedTexts.some((text) => patternMatchesText(rule.merchant_pattern, text))
    ) ?? null;
}

export function buildRuleAppliedEnrichment(
  rule: MerchantRuleRow,
  raw: Pick<RawTransactionRow, "amount" | "merchant_name" | "name">,
  categoryById: Map<string, CategoryRow>
): RuleAppliedEnrichment | null {
  const categoryName = ruleCategoryName(rule, categoryById);
  const merchantName = cleanText(rule.normalized_merchant_name) ?? cleanText(raw.merchant_name) ?? cleanText(raw.name);
  const hasRuleValue = Boolean(rule.normalized_merchant_name || rule.category_id || rule.intent || rule.is_recurring !== null);

  if (!hasRuleValue || !merchantName) return null;

  return {
    categoryId: rule.category_id,
    categoryName: categoryName ?? undefined,
    confidence: RULE_CONFIDENCE,
    intent: rule.intent ?? undefined,
    isRecurring: rule.is_recurring ?? undefined,
    merchantName,
    note: `Applied merchant rule ${rule.merchant_pattern}.`,
    source: "rule"
  };
}
