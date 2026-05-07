import assert from "node:assert/strict";
import test from "node:test";
import type {
  CategoryRecord,
  CategoryRow,
  MerchantRuleRow,
  RawTransactionRow
} from "./db";
import {
  buildAcceptedAiMerchantRuleCandidate,
  buildRuleAppliedEnrichment,
  findMatchingMerchantRule
} from "./merchant-rules";
import type { NormalizedReviewSuggestion } from "./review/suggestions";

const userId = "11111111-1111-1111-1111-111111111111";
const now = "2026-05-06T12:00:00.000Z";

const category: CategoryRecord = {
  color: null,
  icon: null,
  id: "category-software",
  isSystem: true,
  name: "Software / AI Tools",
  parentId: null,
  userId
};

function categoryRow(input: Partial<CategoryRow> = {}): CategoryRow {
  return {
    color: category.color,
    created_at: now,
    icon: category.icon,
    id: category.id,
    is_system: category.isSystem,
    name: category.name,
    parent_id: category.parentId,
    updated_at: now,
    user_id: userId,
    ...input
  };
}

function raw(input: Partial<RawTransactionRow> = {}): RawTransactionRow {
  return {
    account_id: "account-checking",
    amount: -20,
    authorized_date: null,
    authorized_datetime: null,
    date: "2026-05-06",
    datetime: null,
    first_seen_at: now,
    id: "raw-openai",
    iso_currency_code: "USD",
    location: {},
    merchant_name: "OPENAI",
    name: "OPENAI *CHATGPT SUBSCRIPTION",
    payment_channel: "online",
    payment_meta: {},
    pending_transaction_id: null,
    plaid_category: "Service",
    plaid_category_id: null,
    plaid_item_id: "item-1",
    plaid_transaction_id: "plaid-tx-1",
    raw_payload: {},
    status: "posted",
    transaction_type: "place",
    updated_at: now,
    user_id: userId,
    ...input
  };
}

function rule(input: Partial<MerchantRuleRow>): MerchantRuleRow {
  return {
    category_id: null,
    created_at: now,
    enabled: true,
    id: input.id ?? "rule-default",
    intent: null,
    is_recurring: null,
    max_amount: null,
    merchant_pattern: "OPENAI%",
    min_amount: null,
    normalized_merchant_name: null,
    notes: null,
    priority: 100,
    updated_at: now,
    user_id: userId,
    ...input
  };
}

function suggestion(input: Partial<NormalizedReviewSuggestion> = {}): NormalizedReviewSuggestion {
  return {
    categoryId: category.id,
    categoryName: category.name,
    confidence: 0.94,
    intent: "business",
    merchantName: "OpenAI",
    recurring: true,
    signals: ["merchant:openai"],
    ...input
  };
}

test("merchant rules honor disabled rules, amount bounds, and priority", () => {
  const rules = [
    rule({
      enabled: false,
      id: "disabled-high-priority",
      merchant_pattern: "OPENAI%",
      priority: 1
    }),
    rule({
      id: "outside-amount-bounds",
      max_amount: 10,
      merchant_pattern: "OPENAI%",
      priority: 2
    }),
    rule({
      category_id: category.id,
      id: "matching-priority",
      intent: "business",
      merchant_pattern: "OPENAI%",
      min_amount: 10,
      priority: 20
    }),
    rule({
      id: "lower-priority",
      merchant_pattern: "OPENAI%",
      priority: 50
    })
  ];

  const matched = findMatchingMerchantRule(rules, raw({ amount: -20 }));
  assert.equal(matched?.id, "matching-priority");

  const applied = matched
    ? buildRuleAppliedEnrichment(matched, raw(), new Map([[category.id, categoryRow()]]))
    : null;
  assert.equal(applied?.source, "rule");
  assert.equal(applied?.categoryName, category.name);
  assert.equal(applied?.intent, "business");
});

test("accepted AI suggestions produce merchant rule candidates only with concrete non-P2P evidence", () => {
  const candidate = buildAcceptedAiMerchantRuleCandidate({
    categories: [category],
    rawTransaction: raw(),
    suggestion: suggestion(),
    transaction: {
      amount: -20,
      merchant_name: "OpenAI"
    }
  });

  assert.equal(candidate?.merchantPattern, "OPENAI%");
  assert.equal(candidate?.categoryId, category.id);
  assert.equal(candidate?.intent, "business");
  assert.equal(candidate?.isRecurring, true);

  assert.equal(
    buildAcceptedAiMerchantRuleCandidate({
      categories: [category],
      rawTransaction: raw({ merchant_name: "Venmo" }),
      suggestion: suggestion({ merchantName: "Venmo" }),
      transaction: {
        amount: -38,
        merchant_name: "Venmo"
      }
    }),
    null
  );
  assert.equal(
    buildAcceptedAiMerchantRuleCandidate({
      categories: [category],
      rawTransaction: raw(),
      suggestion: suggestion({ categoryId: null, categoryName: undefined }),
      transaction: {
        amount: -20,
        merchant_name: "OpenAI"
      }
    }),
    null
  );
});
