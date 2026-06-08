"use client";

import type { RecurringExpenseRecord } from "@/lib/db";
import { Check, Pencil, Save, X } from "lucide-react";
import { useActionState, useState } from "react";
import {
  confirmRecurringCandidateAction,
  dismissRecurringCandidateAction,
  updateRecurringExpenseDetailsAction,
  type RecurringActionState
} from "./actions";
import styles from "./recurring.module.css";

interface RecurringCandidateActionsProps {
  candidateId?: string;
  expense?: Pick<RecurringExpenseRecord, "amount" | "cadence" | "isNew" | "lastChargeDate" | "nextDueDate" | "status">;
  isDemo: boolean;
  merchant: string;
  recurringExpenseId?: string;
}

const initialState: RecurringActionState = {};
const CADENCE_OPTIONS: { label: string; value: RecurringExpenseRecord["cadence"] }[] = [
  { label: "Monthly", value: "monthly" },
  { label: "Weekly", value: "weekly" },
  { label: "Biweekly", value: "biweekly" },
  { label: "Quarterly", value: "quarterly" },
  { label: "Annual", value: "annual" }
];

function RecurringExpenseAdjustForm({
  expense,
  isDemo,
  merchant,
  recurringExpenseId
}: Pick<RecurringCandidateActionsProps, "expense" | "isDemo" | "merchant" | "recurringExpenseId">) {
  const [open, setOpen] = useState(false);
  const [state, action, saving] = useActionState(updateRecurringExpenseDetailsAction, initialState);
  const canAdjust = Boolean(expense && recurringExpenseId && (expense.status === "pending" || expense.isNew));

  if (!canAdjust || !expense || !recurringExpenseId) return null;

  if (!open) {
    return (
      <button
        aria-label={`Adjust ${merchant} recurring details`}
        className={styles.secondaryButton}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Pencil size={14} aria-hidden />
        Adjust
      </button>
    );
  }

  const lastChargeDate = expense.lastChargeDate ?? expense.nextDueDate;

  return (
    <form
      action={action}
      className={styles.adjustForm}
      onSubmit={(event) => {
        if (isDemo) event.preventDefault();
      }}
    >
      <input name="recurringExpenseId" type="hidden" value={recurringExpenseId} />
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Merchant</span>
        <input className={styles.input} defaultValue={merchant} name="merchant" required type="text" />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Amount</span>
        <input
          className={styles.input}
          defaultValue={expense.amount.toFixed(2)}
          min="0.01"
          name="amount"
          required
          step="0.01"
          type="number"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Cadence</span>
        <select className={styles.select} defaultValue={expense.cadence} name="cadence">
          {CADENCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Last charge</span>
        <input className={styles.input} defaultValue={lastChargeDate} name="lastChargeDate" required type="date" />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Next due</span>
        <input className={styles.input} defaultValue={expense.nextDueDate} name="nextDueDate" type="date" />
      </label>
      <div className={styles.adjustActions}>
        <button className={styles.primaryButton} disabled={saving || isDemo} type="submit">
          <Save size={14} aria-hidden />
          {isDemo ? "Read-only demo" : saving ? "Saving..." : "Save"}
        </button>
        <button className={styles.secondaryButton} onClick={() => setOpen(false)} type="button">
          <X size={14} aria-hidden />
          Cancel
        </button>
      </div>
      {state.error ? (
        <div className={styles.inlineError} role="alert" aria-live="assertive">
          {state.error}
        </div>
      ) : state.message ? (
        <div className={styles.inlineMessage} role="status" aria-live="polite">
          {state.message}
        </div>
      ) : null}
    </form>
  );
}

export function RecurringCandidateActions({
  candidateId,
  expense,
  isDemo,
  merchant,
  recurringExpenseId
}: RecurringCandidateActionsProps) {
  const [confirmState, confirmAction, confirming] = useActionState(confirmRecurringCandidateAction, initialState);
  const [dismissState, dismissAction, dismissing] = useActionState(dismissRecurringCandidateAction, initialState);
  const disabled = confirming || dismissing || isDemo;
  // Prefer the most recent action's outcome; suppress messages while pending to avoid stale toasts.
  const message = disabled ? undefined : (dismissState.message ?? confirmState.message);
  const error = disabled ? undefined : (dismissState.error ?? confirmState.error);

  return (
    <div className={styles.actionForms} data-recurring-resolving={disabled ? "true" : undefined}>
      <form
        action={confirmAction}
        onSubmit={(event) => {
          if (isDemo) event.preventDefault();
        }}
      >
        {candidateId ? <input name="candidateId" type="hidden" value={candidateId} /> : null}
        {recurringExpenseId ? <input name="recurringExpenseId" type="hidden" value={recurringExpenseId} /> : null}
        <button
          aria-label={`Confirm ${merchant} as recurring`}
          className={styles.primaryButton}
          disabled={disabled}
          type="submit"
        >
          <Check size={14} aria-hidden />
          {isDemo ? "Read-only demo" : confirming ? "Confirming..." : "Confirm"}
        </button>
      </form>

      <form
        action={dismissAction}
        onSubmit={(event) => {
          if (isDemo) event.preventDefault();
        }}
      >
        {candidateId ? <input name="candidateId" type="hidden" value={candidateId} /> : null}
        {recurringExpenseId ? <input name="recurringExpenseId" type="hidden" value={recurringExpenseId} /> : null}
        <button
          aria-label={`Dismiss ${merchant} recurring candidate`}
          className={styles.secondaryButton}
          disabled={disabled}
          type="submit"
        >
          <X size={14} aria-hidden />
          {isDemo ? "Read-only demo" : dismissing ? "Dismissing..." : "Dismiss"}
        </button>
      </form>

      <RecurringExpenseAdjustForm
        expense={expense}
        isDemo={isDemo}
        merchant={merchant}
        recurringExpenseId={recurringExpenseId}
      />

      {isDemo ? (
        <div className={styles.inlineMessage} role="status" aria-live="polite">
          Demo recurring actions are read-only. Sign in to confirm or dismiss real recurring rows.
        </div>
      ) : null}
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
