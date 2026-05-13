import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord } from "@/lib/db";
import { applyManualInvestmentValuations, parseManualInvestmentHoldings } from "./manual-valuations";

const fidelityAccount: AccountRecord = {
  availableBalance: 42_890.55,
  balance: 42_890.55,
  color: "#3a7a3a",
  creditLimit: null,
  currency: "USD",
  id: "account-fidelity",
  institutionId: "institution-fidelity",
  institutionName: "Fidelity",
  isActive: true,
  lastSyncedAt: "2026-05-12T12:00:00.000Z",
  mask: "7711",
  name: "Fidelity Brokerage",
  officialName: "Fidelity Brokerage",
  plaidAccountId: "manual-fidelity",
  subtype: "brokerage",
  type: "investment",
  userId: "user-1"
};

test("parseManualInvestmentHoldings accepts the simple Fidelity shorthand", () => {
  const configs = parseManualInvestmentHoldings({
    FIDELITY_HOLDINGS: "AAPL:10, NVDA=2.5, cash:125.75"
  });

  assert.equal(configs.length, 1);
  assert.equal(configs[0]?.institutionName, "Fidelity");
  assert.equal(configs[0]?.cash, 125.75);
  assert.deepEqual(configs[0]?.holdings, [
    { shares: 10, symbol: "AAPL" },
    { shares: 2.5, symbol: "NVDA" }
  ]);
});

test("applyManualInvestmentValuations prices configured holdings without changing Plaid accounts", async () => {
  const checkingAccount: AccountRecord = {
    ...fidelityAccount,
    availableBalance: 100,
    balance: 100,
    id: "account-checking",
    institutionName: "Schools First",
    name: "Schools First Checking",
    plaidAccountId: "checking",
    type: "depository"
  };
  const accounts = await applyManualInvestmentValuations([checkingAccount, fidelityAccount], {
    env: {
      FIDELITY_HOLDINGS: "AAPL:10,NVDA:2,cash:50"
    },
    quoteProvider: async (symbol) => ({
      asOf: "2026-05-13T20:00:00.000Z",
      price: symbol === "AAPL" ? 200 : 1000,
      symbol
    })
  });

  const checking = accounts.find((account) => account.id === "account-checking");
  const fidelity = accounts.find((account) => account.id === "account-fidelity");

  assert.equal(checking?.balance, 100);
  assert.equal(checking?.manualValuation, undefined);
  assert.equal(fidelity?.balance, 4050);
  assert.equal(fidelity?.availableBalance, 50);
  assert.equal(fidelity?.manualValuation?.totalValue, 4050);
  assert.deepEqual(fidelity?.manualValuation?.holdings.map((holding) => holding.symbol), ["AAPL", "NVDA"]);
});

test("applyManualInvestmentValuations falls back to saved balance when quotes fail", async () => {
  const accounts = await applyManualInvestmentValuations([fidelityAccount], {
    env: {
      FIDELITY_HOLDINGS: "AAPL:10"
    },
    quoteProvider: async () => null
  });

  assert.equal(accounts[0]?.balance, 42_890.55);
  assert.equal(accounts[0]?.manualValuation, undefined);
});
