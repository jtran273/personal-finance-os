import type {
  ReviewQueueItem,
  ReviewReason,
  TransactionIntent
} from "@/lib/db";
import { hasReviewSuggestionValue, normalizeReviewSuggestion } from "@/lib/review/suggestions";
import { isPeerToPeerReview } from "@/lib/review/reasons";
import { assertFinanceManifestSafe } from "./finance-action-manifest";

export type AgentInboxProposalStatus = "accept-ready" | "needs-review";
export type AgentInboxProposalAction = "review-suggestion" | "manual-review";

export interface AgentInboxProposal {
  action: AgentInboxProposalAction;
  amount: number;
  category: string;
  confidence: number | null;
  context: AgentInboxProposalContext;
  createdAt: string;
  date: string;
  id: string;
  intent: TransactionIntent;
  merchant: string;
  reason: ReviewReason;
  recommendation: AgentInboxRecommendation;
  reviewItemId: string;
  status: AgentInboxProposalStatus;
  transactionId: string;
}

export interface AgentInboxProposalContext {
  accountLabel: string;
  date: string;
  institutionName: string;
  plaidCategory: string | null;
  plaidMerchant: string | null;
  plaidName: string | null;
  reviewExplanation: string;
}

export interface AgentInboxRecommendation {
  categoryName?: string;
  confidence?: number;
  intent?: TransactionIntent;
  merchantName?: string;
  rationale: string;
  recurring?: boolean;
  signals: string[];
}

export interface AgentInboxSummary {
  acceptReadyCount: number;
  manualReviewCount: number;
  proposedFieldCount: number;
  totalCount: number;
}

function accountLabel(item: ReviewQueueItem) {
  return [
    item.transaction.accountName,
    item.transaction.accountMask ? `ending ${item.transaction.accountMask}` : null
  ].filter(Boolean).join(" ");
}

function proposedFieldCount(proposal: AgentInboxProposal) {
  return [
    proposal.recommendation.merchantName,
    proposal.recommendation.categoryName,
    proposal.recommendation.intent,
    proposal.recommendation.recurring,
    proposal.recommendation.confidence
  ].filter((value) => value !== undefined && value !== null && value !== "").length;
}

function buildProposal(item: ReviewQueueItem): AgentInboxProposal {
  const suggestion = normalizeReviewSuggestion(item.aiSuggestion);
  const acceptReady = !isPeerToPeerReview(item.reason) && hasReviewSuggestionValue(suggestion);
  const proposal: AgentInboxProposal = {
    action: acceptReady ? "review-suggestion" : "manual-review",
    amount: item.transaction.amount,
    category: item.transaction.category,
    confidence: item.confidence,
    context: {
      accountLabel: accountLabel(item),
      date: item.transaction.date,
      institutionName: item.transaction.institutionName,
      plaidCategory: item.transaction.plaidCategory,
      plaidMerchant: item.transaction.plaidMerchant,
      plaidName: item.transaction.plaidName,
      reviewExplanation: item.explanation
    },
    createdAt: item.createdAt,
    date: item.transaction.date,
    id: `proposal-${item.id}`,
    intent: item.transaction.intent,
    merchant: item.transaction.merchant,
    reason: item.reason,
    recommendation: {
      categoryName: suggestion.categoryName,
      confidence: suggestion.confidence,
      intent: suggestion.intent,
      merchantName: suggestion.merchantName,
      rationale: suggestion.reason ?? item.explanation,
      recurring: suggestion.recurring,
      signals: suggestion.signals.slice(0, 6)
    },
    reviewItemId: item.id,
    status: acceptReady ? "accept-ready" : "needs-review",
    transactionId: item.transaction.id
  };

  assertFinanceManifestSafe(proposal);
  return proposal;
}

export function buildAgentInboxProposals(reviewItems: readonly ReviewQueueItem[]) {
  return reviewItems
    .map(buildProposal)
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "accept-ready" ? -1 : 1;
      return Math.abs(right.amount) - Math.abs(left.amount);
    });
}

export function summarizeAgentInbox(proposals: readonly AgentInboxProposal[]): AgentInboxSummary {
  return proposals.reduce<AgentInboxSummary>(
    (summary, proposal) => ({
      acceptReadyCount: summary.acceptReadyCount + (proposal.status === "accept-ready" ? 1 : 0),
      manualReviewCount: summary.manualReviewCount + (proposal.status === "needs-review" ? 1 : 0),
      proposedFieldCount: summary.proposedFieldCount + proposedFieldCount(proposal),
      totalCount: summary.totalCount + 1
    }),
    { acceptReadyCount: 0, manualReviewCount: 0, proposedFieldCount: 0, totalCount: 0 }
  );
}
