import assert from "node:assert/strict";
import test from "node:test";
import type { RecurringExpenseRecord } from "../db";
import {
  buildPendingRecurringExpenseFromTransactionPayload,
  findExistingRecurringExpenseForMerchant
} from "./actions";

const expenseTransaction = {
  account_id: "account-card",
  amount: -95,
  category_id: "category-fees",
  date: "2026-05-01",
  id: "transaction-annual-fee",
  merchant_name: "Chase Sapphire",
  user_id: "user-1"
};

function recurringExpense(input: Partial<RecurringExpenseRecord> = {}): RecurringExpenseRecord {
  return {
    accountId: "account-card",
    accountName: "Chase",
    amount: 95,
    cadence: "annual",
    category: "Fees",
    categoryId: "category-fees",
    confidence: 0.9,
    id: "recurring-chase",
    isNew: false,
    lastAmount: 95,
    lastChargeDate: "2026-05-01",
    merchant: "CHASE SAPPHIRE CARD",
    nextDueDate: "2027-05-01",
    status: "active",
    ...input
  };
}

test("builds a pending monthly recurring expense from a checked expense transaction", () => {
  const payload = buildPendingRecurringExpenseFromTransactionPayload(expenseTransaction, {
    asOfDate: "2026-05-02"
  });

  assert.ok(payload);
  assert.equal(payload.conflictColumns.join(","), "user_id,merchant_name,cadence");
  assert.deepEqual(payload.values, {
    account_id: "account-card",
    amount: 95,
    cadence: "monthly",
    category_id: "category-fees",
    confidence: 0.55,
    is_new: true,
    last_amount: 95,
    last_charge_date: "2026-05-01",
    last_transaction_id: "transaction-annual-fee",
    merchant_name: "Chase Sapphire",
    merchant_rule_id: null,
    next_due_date: "2026-06-01",
    status: "pending",
    user_id: "user-1"
  });
});

test("does not create recurring expense rows for recurring income", () => {
  const payload = buildPendingRecurringExpenseFromTransactionPayload({
    ...expenseTransaction,
    amount: 2500,
    merchant_name: "Payroll"
  });

  assert.equal(payload, null);
});

test("matches existing recurring merchants across cadence defaults", () => {
  const activeAnnual = recurringExpense();
  assert.equal(
    findExistingRecurringExpenseForMerchant("Chase Sapphire", [activeAnnual]),
    activeAnnual
  );

  assert.equal(
    findExistingRecurringExpenseForMerchant("Chase Sapphire", [
      recurringExpense({ status: "dismissed" })
    ]),
    null
  );
});
