import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AssistantContextPacket,
  AssistantSuggestionResponse
} from "./assistant-contract";
import {
  assertAssistantContextSafe,
  assistantSuggestionTypes,
  findForbiddenAssistantContextFields,
  findForbiddenAssistantSecretValues
} from "./assistant-contract";

function fixture<T>(name: string): T {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T;
}

function stringify(value: unknown) {
  return JSON.stringify(value);
}

test("reimbursement review fixture serializes without forbidden assistant context fields", () => {
  const context = fixture<AssistantContextPacket>("reimbursement-review-context.json");

  assert.equal(context.contractVersion, "2026-05-12");
  assert.equal(context.ledgerRole, "system_of_record");
  assert.equal(context.openClawRole, "reasoning_layer");
  assert.equal(context.safety.rawProviderPayloadIncluded, false);
  assert.equal(context.safety.secretsIncluded, false);
  assert.equal(context.safety.writesAllowed, false);
  assert.equal(context.records.length, 2);
  assert.deepEqual(findForbiddenAssistantContextFields(context), []);
  assert.deepEqual(findForbiddenAssistantSecretValues(context), []);
  assert.doesNotThrow(() => assertAssistantContextSafe(context));
});

test("assistant response fixture uses proposal-only suggestion types", () => {
  const response = fixture<AssistantSuggestionResponse>("reimbursement-review-response.json");

  assert.equal(response.contractVersion, "2026-05-12");
  assert.equal(response.suggestions.every((suggestion) => suggestion.approvalRequired), true);
  assert.equal(
    response.suggestions.every((suggestion) => assistantSuggestionTypes.includes(suggestion.type)),
    true
  );
  assert.deepEqual(
    response.suggestions.map((suggestion) => suggestion.type),
    ["reimbursement_match", "clarification_request"]
  );
  assert.doesNotThrow(() => assertAssistantContextSafe(response));
});

test("assistant fixtures do not contain forbidden keys or secret-shaped values when serialized", () => {
  const contextText = stringify(fixture<AssistantContextPacket>("reimbursement-review-context.json"));
  const responseText = stringify(fixture<AssistantSuggestionResponse>("reimbursement-review-response.json"));
  const combinedText = `${contextText}\n${responseText}`;

  [
    "access_token_ciphertext",
    "authorization",
    "database_url",
    "payment_meta",
    "plaid_account_id",
    "plaid_item_id",
    "plaid_transaction_id",
    "raw_payload",
    "raw_transaction_id",
    "service_role_key",
    "transaction_cursor",
    "user_id"
  ].forEach((forbiddenKey) => {
    assert.equal(combinedText.includes(`"${forbiddenKey}":`), false, `${forbiddenKey} should not serialize as a key`);
  });
  assert.equal(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/.test(combinedText), false);
  assert.equal(/\b(?:access|public)-(?:sandbox|development|production)-[A-Za-z0-9_-]{12,}\b/.test(combinedText), false);
  assert.equal(/\b(?:postgres|postgresql):\/\/[^ \n]+/i.test(combinedText), false);
});

test("assistant safety guard rejects forbidden fields and secret-shaped values", () => {
  assert.deepEqual(findForbiddenAssistantContextFields({ rawTransactionId: "raw-test" }), [
    { field: "rawTransactionId", path: "rawTransactionId" }
  ]);
  assert.deepEqual(findForbiddenAssistantSecretValues({ token: "Bearer secret-token-value" }), [
    { path: "token", reason: "bearer_token" }
  ]);
  assert.throws(
    () => assertAssistantContextSafe({ nested: { databaseUrl: "postgres://user:pass@example.test/db" } }),
    /forbidden data/i
  );
});
