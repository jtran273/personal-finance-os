import type { AiSuggestionProviderKind } from "@/lib/ai/types";
import type { CategoryRecord, ReviewQueueItem, TransactionIntent } from "@/lib/db";
import {
  displayCategoryName,
  displayTransactionIntent,
  transactionTagFromIntent,
  transactionTagLabel
} from "@/lib/finance/classification";
import { transactionSpendingAmount } from "@/lib/finance/spending";
import { isPeerToPeerReview } from "@/lib/review/reasons";
import { hasReviewSuggestionValue, normalizeReviewSuggestion } from "@/lib/review/suggestions";
import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  ShieldCheck,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import Link from "next/link";
import { PeerToPeerSplitForm } from "./peer-to-peer-split-form";
import { ReviewItemActions } from "./review-item-actions";
import { ReviewTransactionEditForm } from "./review-transaction-edit-form";
import styles from "./review.module.css";

interface ReviewQueueViewProps {
  aiAutoReviewEnabled: boolean;
  aiProviderKind: AiSuggestionProviderKind;
  categories: CategoryRecord[];
  dataError?: string;
  isConfigured: boolean;
  isSignedIn: boolean;
  reviewItems: ReviewQueueItem[];
  trustedSpending: number;
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric"
});

const intentLabels: Record<TransactionIntent, string> = {
  business: "Business",
  personal: "Personal",
  reimbursable: "Reimbursable",
  shared: "Shared",
  transfer: "Transfer"
};

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatSignedMoney(value: number) {
  const formatted = moneyFormatter.format(Math.abs(value));
  if (value < 0) return `-${formatted}`;
  if (value > 0) return `+${formatted}`;
  return formatted;
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatConfidence(value: number | null | undefined) {
  return value === null || value === undefined ? "Unknown" : `${Math.round(value * 100)}%`;
}

function intentDisplay(intent: TransactionIntent) {
  return intentLabels[displayTransactionIntent(intent)];
}

function tagDisplay(intent: TransactionIntent | undefined) {
  if (!intent) return null;
  const tag = transactionTagFromIntent(intent);
  return tag === "none" ? null : transactionTagLabel(tag);
}

function confidenceTone(value: number | null | undefined): "high" | "mid" | "low" | "unknown" {
  if (value === null || value === undefined) return "unknown";
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "mid";
  return "low";
}

function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  const tone = confidenceTone(value);
  const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, Math.round(value * 100)));
  const label = formatConfidence(value);
  return (
    <span
      className={`${styles.confidenceBadge} ${styles[`confidence-${tone}`]}`}
      aria-label={`Confidence ${label}`}
      title={`Confidence ${label}`}
    >
      <span className={styles.confidenceTrack} aria-hidden>
        <span className={styles.confidenceFill} style={{ width: `${pct}%` }} />
      </span>
      <span className={styles.confidenceValue}>{label}</span>
    </span>
  );
}

function ReviewCard({
  aiProviderKind,
  categories,
  item
}: {
  aiProviderKind: AiSuggestionProviderKind;
  categories: CategoryRecord[];
  item: ReviewQueueItem;
}) {
  const suggestion = normalizeReviewSuggestion(item.aiSuggestion);
  const peerToPeer = isPeerToPeerReview(item.reason);
  const hasSuggestion = hasReviewSuggestionValue(suggestion);
  const canAccept = !peerToPeer && hasSuggestion;
  const canDismiss = !peerToPeer;
  const canSuggest = !peerToPeer;

  return (
    <article className={styles.reviewCard} id={`review-${item.id}`}>
      <div className={styles.reviewCardHead}>
        <div>
          <h2>{item.transaction.merchant}</h2>
          <div className={styles.metaLine}>
            <span>{formatDate(item.transaction.date)}</span>
            <span>{item.transaction.accountName}</span>
            <span>{peerToPeer ? "Peer-to-peer" : "Needs review"}</span>
          </div>
        </div>
        <div className={styles.amountBlock}>
          <strong className={item.transaction.amount >= 0 ? styles.positiveAmount : styles.negativeAmount}>
            {formatSignedMoney(item.transaction.amount)}
          </strong>
          <ConfidenceBadge value={item.confidence} />
        </div>
      </div>

      {peerToPeer ? (
        <div className={styles.reasonCallout}>
          <TriangleAlert size={14} aria-hidden />
          <div>
            <strong>Explain this peer-to-peer payment.</strong>
            <span>Venmo, Zelle, Cash App, and PayPal hide the real merchant. Split it into real categories below.</span>
          </div>
        </div>
      ) : hasSuggestion ? (
        <div className={styles.suggestionGrid}>
          <div className={styles.suggestionColumn}>
            <span className={styles.columnLabel}>
              {aiProviderKind === "openai" ? "Suggestion" : "Rules suggest"}
            </span>
            <dl className={styles.detailList}>
              <div>
                <dt>Category</dt>
                <dd>{displayCategoryName(suggestion.categoryName ?? item.transaction.category)}</dd>
              </div>
              <div>
                <dt>Intent</dt>
                <dd>{intentDisplay(suggestion.intent ?? item.transaction.intent)}</dd>
              </div>
              {tagDisplay(suggestion.intent ?? item.transaction.intent) ? (
                <div>
                  <dt>Tag</dt>
                  <dd>{tagDisplay(suggestion.intent ?? item.transaction.intent)}</dd>
                </div>
              ) : null}
              {suggestion.reason ? (
                <div>
                  <dt>Why</dt>
                  <dd>{suggestion.reason}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      ) : (
        <div className={styles.reasonCallout}>
          <TriangleAlert size={14} aria-hidden />
          <div>
            <strong>No AI suggestion yet.</strong>
            <span>Pick a category below to finalize this transaction.</span>
          </div>
        </div>
      )}

      <div className={styles.cardActions}>
        {peerToPeer ? (
          <PeerToPeerSplitForm
            categories={categories}
            defaultExplanation={item.transaction.note}
            reviewItemId={item.id}
            suggestion={suggestion}
            transaction={item.transaction}
          />
        ) : (
          <>
            <ReviewItemActions
              aiProviderKind={aiProviderKind}
              canAccept={canAccept}
              canDismiss={canDismiss}
              canSuggest={canSuggest}
              hasSuggestion={hasSuggestion}
              reviewItemId={item.id}
            />
            <ReviewTransactionEditForm
              categories={categories}
              reviewItemId={item.id}
              transaction={item.transaction}
            />
          </>
        )}
      </div>
    </article>
  );
}

function EmptyQueue() {
  return (
    <div className={styles.emptyState}>
      <CheckCircle2 size={28} aria-hidden />
      <h2>Queue clear — nice.</h2>
      <p>Every transaction is categorized. New imports only land here when AI is uncertain or a peer-to-peer charge needs explaining.</p>
      <Link className={styles.secondaryButton} href="/transactions">
        Open transactions
        <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

export function ReviewQueueView({
  aiAutoReviewEnabled,
  aiProviderKind,
  categories,
  dataError,
  isConfigured,
  isSignedIn,
  reviewItems,
  trustedSpending
}: ReviewQueueViewProps) {
  const canShowQueue = isConfigured && isSignedIn && !dataError;
  const unresolvedSpending = reviewItems.reduce(
    (sum, item) => sum + transactionSpendingAmount(item.transaction),
    0
  );

  const peerToPeerItems = reviewItems.filter((item) => isPeerToPeerReview(item.reason));
  const aiItems = reviewItems.filter((item) => !isPeerToPeerReview(item.reason));

  return (
    <div className={styles.shell}>
      <section className={styles.summaryGrid} aria-label="Review queue summary">
        <div className={`${styles.summaryCard} ${reviewItems.length > 0 ? styles.warn : ""}`}>
          <span className={styles.summaryLabel}>
            <TriangleAlert size={13} aria-hidden />
            Needs your input
          </span>
          <strong>{reviewItems.length.toLocaleString("en-US")}</strong>
        </div>
        <div className={`${styles.summaryCard} ${styles.trusted}`}>
          <span className={styles.summaryLabel}>
            <ShieldCheck size={13} aria-hidden />
            Trusted spending
          </span>
          <strong>{formatMoney(trustedSpending)}</strong>
        </div>
        <div className={`${styles.summaryCard} ${unresolvedSpending > 0 ? styles.warn : ""}`}>
          <span className={styles.summaryLabel}>
            <CircleDollarSign size={13} aria-hidden />
            Unresolved spending
          </span>
          <strong>{formatMoney(unresolvedSpending)}</strong>
        </div>
      </section>

      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so persisted review items cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in with Supabase Auth to load your persisted review queue.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      {canShowQueue ? (
        <div className={styles.notice} role="status">
          <Sparkles size={13} aria-hidden />
          {aiProviderKind === "openai"
            ? aiAutoReviewEnabled
              ? "OpenAI is configured. Automatic cleanup can run on eligible imports, and suggestions still need review unless high-confidence cleanup is audit-backed."
              : "OpenAI is configured for manual clicks. Automatic cleanup is off, so this page does not call OpenAI until you ask for a suggestion."
            : "OpenAI is not configured. Suggestions come from deterministic merchant and Plaid rules only."}
        </div>
      ) : null}

      {!canShowQueue ? null : reviewItems.length === 0 ? (
        <EmptyQueue />
      ) : (
        <div className={styles.reviewGroups}>
          {peerToPeerItems.length > 0 ? (
            <section className={styles.reviewGroup} aria-labelledby="review-group-p2p">
              <div className={styles.reviewGroupHead}>
                <h2 id="review-group-p2p">
                  <TriangleAlert size={16} aria-hidden /> Peer-to-peer ({peerToPeerItems.length})
                </h2>
                <span>Venmo, Zelle, Cash App and PayPal hide the real merchant — explain each one.</span>
              </div>
              <div className={styles.cardStack}>
                {peerToPeerItems.map((item) => (
                  <ReviewCard aiProviderKind={aiProviderKind} categories={categories} item={item} key={item.id} />
                ))}
              </div>
            </section>
          ) : null}

          {aiItems.length > 0 ? (
            <section className={styles.reviewGroup} aria-labelledby="review-group-ai">
              <div className={styles.reviewGroupHead}>
                <h2 id="review-group-ai">
                  <Sparkles size={16} aria-hidden /> Needs categorization ({aiItems.length})
                </h2>
                <span>These rows were flagged by Plaid/app rules. Ask for a suggestion, accept a ready one, or relabel manually.</span>
              </div>
              <div className={styles.cardStack}>
                {aiItems.map((item) => (
                  <ReviewCard aiProviderKind={aiProviderKind} categories={categories} item={item} key={item.id} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
