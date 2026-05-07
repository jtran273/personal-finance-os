import { AccountType as PlaidAccountType, type AccountBase } from "plaid";
import assert from "node:assert/strict";
import test from "node:test";
import { mergePlaidAccountSourcesForSync, shouldRefreshImportedEnrichment } from "./service";

function account(accountId: string, name: string, current: number): AccountBase {
  return {
    account_id: accountId,
    balances: {
      available: current,
      current,
      iso_currency_code: "USD",
      limit: null,
      unofficial_currency_code: null
    },
    mask: "1234",
    name,
    official_name: null,
    subtype: null,
    type: PlaidAccountType.Depository
  } as AccountBase;
}

const syncAccount = account("acct-sync", "Transactions sync account", 100);
const accountsGetAccount = account("acct-get", "Accounts get account", 250);
const balanceAccount = account("acct-get", "Accounts balance account", 275);

export const plaidAccountsGetFallbackFixture = mergePlaidAccountSourcesForSync({
  accountsGetAccounts: [accountsGetAccount],
  balanceAccounts: [],
  transactionSyncAccounts: []
});

export const plaidAccountSourceMergeFixture = mergePlaidAccountSourcesForSync({
  accountsGetAccounts: [accountsGetAccount],
  balanceAccounts: [balanceAccount],
  transactionSyncAccounts: [syncAccount]
});

export const plaidAccountSourceMergeStaticAssertions = assertPlaidAccountSourceMergeFixtures();

test("Plaid enrichment refresh preserves manual and reviewed overrides", () => {
  assert.equal(shouldRefreshImportedEnrichment({ reviewed_at: null, source: "plaid" }), true);
  assert.equal(shouldRefreshImportedEnrichment({ reviewed_at: null, source: "rule" }), true);
  assert.equal(shouldRefreshImportedEnrichment({ reviewed_at: "2026-05-06T12:00:00.000Z", source: "plaid" }), false);
  assert.equal(shouldRefreshImportedEnrichment({ reviewed_at: "2026-05-06T12:00:00.000Z", source: "rule" }), false);
  assert.equal(shouldRefreshImportedEnrichment({ reviewed_at: null, source: "manual" }), false);
});

function assertPlaidAccountSourceMergeFixtures(): true {
  if (!plaidAccountsGetFallbackFixture.some((item) => item.account_id === "acct-get")) {
    throw new Error("Expected accounts/get accounts to sync when transactions/sync returns no account rows.");
  }

  if (plaidAccountSourceMergeFixture.length !== 2) {
    throw new Error("Expected duplicate Plaid account ids to be collapsed across account sources.");
  }

  const dedupedAccount = plaidAccountSourceMergeFixture.find((item) => item.account_id === "acct-get");
  if (dedupedAccount?.name !== "Accounts balance account") {
    throw new Error("Expected accounts/balance rows to win when they refresh an accounts/get account.");
  }

  return true;
}
