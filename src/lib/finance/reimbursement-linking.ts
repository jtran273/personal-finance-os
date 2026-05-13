import type { ReimbursementRecord, TransactionRecord } from "@/lib/db";

export type ReimbursementLinkStatus = "requested" | "received";

export interface ReimbursementLinkDecision {
  appliedAmount: number;
  outstandingAmount: number;
  receivedAmount: number;
  receivedAt: string;
  status: ReimbursementLinkStatus;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildReimbursementLinkDecision(
  reimbursement: Pick<ReimbursementRecord, "expectedAmount" | "receivedAmount">,
  receivedTransaction: Pick<TransactionRecord, "amount" | "date">,
  options: { appliedAmount?: number } = {}
): ReimbursementLinkDecision {
  if (receivedTransaction.amount <= 0) {
    throw new Error("Reimbursement links require a positive inflow transaction.");
  }

  const previouslyReceivedAmount = roundMoney(reimbursement.receivedAmount);
  const remainingExpectedAmount = roundMoney(Math.max(0, reimbursement.expectedAmount - previouslyReceivedAmount));
  if (remainingExpectedAmount <= 0) {
    throw new Error("This reimbursement is already fully received.");
  }

  const requestedAmount = options.appliedAmount === undefined
    ? Math.min(receivedTransaction.amount, remainingExpectedAmount)
    : options.appliedAmount;
  const appliedAmount = roundMoney(requestedAmount);

  if (appliedAmount <= 0) {
    throw new Error("Applied reimbursement amount must be greater than zero.");
  }
  if (appliedAmount > roundMoney(receivedTransaction.amount)) {
    throw new Error("Applied reimbursement amount cannot exceed the received inflow.");
  }
  if (appliedAmount > remainingExpectedAmount) {
    throw new Error("Applied reimbursement amount cannot exceed the outstanding reimbursement amount.");
  }

  const receivedAmount = roundMoney(previouslyReceivedAmount + appliedAmount);
  const outstandingAmount = roundMoney(Math.max(0, reimbursement.expectedAmount - receivedAmount));

  return {
    appliedAmount,
    outstandingAmount,
    receivedAmount,
    receivedAt: receivedTransaction.date,
    status: outstandingAmount === 0 ? "received" : "requested"
  };
}

export function isReportableIncomeIntent(intent: TransactionRecord["intent"]) {
  return intent !== "transfer" && intent !== "reimbursable";
}
