"use client";

import { Check, X } from "lucide-react";
import { useActionState } from "react";
import {
  confirmRecurringCandidateAction,
  dismissRecurringCandidateAction,
  type RecurringActionState
} from "./actions";
import styles from "./recurring.module.css";

interface RecurringCandidateActionsProps {
  candidateId?: string;
  merchant: string;
  recurringExpenseId?: string;
}

const initialState: RecurringActionState = {};

export function RecurringCandidateActions({
  candidateId,
  merchant,
  recurringExpenseId
}: RecurringCandidateActionsProps) {
  const [confirmState, confirmAction, confirming] = useActionState(confirmRecurringCandidateAction, initialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissRecurringCandidateAction, initialState);
  const disabled = confirming || dismissing;
  // Prefer the most recent action's outcome; suppress messages while pending to avoid stale toasts.
  const message = disabled ? undefined : (dismissState.message ?? confirmState.message);
  const error = disabled ? undefined : (dismissState.error ?? confirmState.error);

  return (
    <div className={styles.actionForms} data-recurring-resolving={disabled ? "true" : undefined}>
      <form action={confirmAction}>
        {candidateId ? <input name="candidateId" type="hidden" value={candidateId} /> : null}
        {recurringExpenseId ? <input name="recurringExpenseId" type="hidden" value={recurringExpenseId} /> : null}
        <button
          aria-label={`Confirm ${merchant} as recurring`}
          className={styles.primaryButton}
          disabled={disabled}
          type="submit"
        >
          <Check size={14} aria-hidden />
          {confirming ? "Confirming..." : "Confirm"}
        </button>
      </form>

      <form action={dismissAction}>
        {candidateId ? <input name="candidateId" type="hidden" value={candidateId} /> : null}
        {recurringExpenseId ? <input name="recurringExpenseId" type="hidden" value={recurringExpenseId} /> : null}
        <button
          aria-label={`Dismiss ${merchant} recurring candidate`}
          className={styles.secondaryButton}
          disabled={disabled}
          type="submit"
        >
          <X size={14} aria-hidden />
          {dismissing ? "Dismissing..." : "Dismiss"}
        </button>
      </form>

      {error ? (
        <div className={styles.inlineError} role="alert" aria-live="assertive">
          {error}
        </div>
      ) : null}
      {message && !error ? (
        <div className={styles.inlineMessage} role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
    </div>
  );
}
