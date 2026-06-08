"use client";

import { History, Loader2 } from "lucide-react";
import { useActionState } from "react";
import {
  runHistoricalReimbursementScanAction,
  type HistoricalReimbursementScanActionState
} from "./actions";
import styles from "./review.module.css";

const initialState: HistoricalReimbursementScanActionState = {};

export function HistoricalReimbursementScanForm({ isDemo }: { isDemo: boolean }) {
  const [state, action, pending] = useActionState(runHistoricalReimbursementScanAction, initialState);
  const disabled = isDemo || pending;

  return (
    <section className={styles.scanPanel} aria-label="Historical reimbursement scan">
      <div>
        <span>Reimbursements</span>
        <h2>Scan past transactions</h2>
      </div>
      <form action={action}>
        <button className={styles.secondaryButton} disabled={disabled} type="submit">
          {pending ? <Loader2 size={14} aria-hidden /> : <History size={14} aria-hidden />}
          {isDemo ? "Read-only demo" : pending ? "Scanning..." : "Run historical scan"}
        </button>
      </form>
      {!pending && state.error ? (
        <div className={styles.inlineError} role="alert" aria-live="assertive">
          {state.error}
        </div>
      ) : null}
      {!pending && state.message && !state.error ? (
        <div className={styles.inlineSuccess} role="status" aria-live="polite">
          {state.message}
        </div>
      ) : null}
    </section>
  );
}
