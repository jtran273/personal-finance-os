import Link from "next/link";
import { ArrowRight, Repeat, TrendingUp, TriangleAlert } from "lucide-react";
import type { MonthlyCashflowRunwaySummary } from "@/lib/finance/cashflow";
import styles from "./cashflow-runway-card.module.css";

interface CashflowRunwayCardProps {
  summary: MonthlyCashflowRunwaySummary;
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency"
});

const moneyDetailFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short"
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatMoneyExact(value: number) {
  return moneyDetailFormatter.format(value);
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return dateFormatter.format(parsed);
}

function monthLabel(fromDate: string) {
  const parsed = new Date(`${fromDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return fromDate;
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function deltaLabel(current: number, previous: number) {
  const delta = current - previous;
  if (Math.abs(delta) < 0.005) return "Flat vs last month";
  const direction = delta > 0 ? "↑" : "↓";
  return `${direction} ${formatMoneyExact(Math.abs(delta))} vs last month`;
}

export function CashflowRunwayCard({ summary }: CashflowRunwayCardProps) {
  const { currentMonth, previousMonth } = summary;
  const partialMonthNote = summary.isPartialMonth
    ? `Day ${summary.monthElapsedDays} of ${summary.monthTotalDays}`
    : "Full month";
  const staleNote =
    summary.syncSummary.staleCount > 0
      ? `${summary.syncSummary.staleCount} account${summary.syncSummary.staleCount === 1 ? "" : "s"} have stale sync — totals may lag.`
      : null;

  return (
    <section aria-label="Monthly cashflow runway" className={styles.card}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>
            <TrendingUp size={13} aria-hidden /> Cashflow runway
          </span>
          <h2>{monthLabel(currentMonth.fromDate)}</h2>
          <p className={styles.sub}>
            {partialMonthNote}. Through {formatDate(summary.asOfDate)}.
          </p>
        </div>
        <div className={styles.netBlock}>
          <span>Net cashflow</span>
          <strong className={currentMonth.netCashflow < 0 ? styles.neg : styles.pos}>
            {formatMoney(currentMonth.netCashflow)}
          </strong>
          <span className={styles.sub}>{deltaLabel(currentMonth.netCashflow, previousMonth.netCashflow)}</span>
        </div>
      </header>

      <div className={styles.metricGrid}>
        <div className={styles.metric}>
          <span>Income this month</span>
          <strong className={styles.pos}>{formatMoney(currentMonth.income)}</strong>
          <span className={styles.subMuted}>Last month {formatMoney(previousMonth.income)}</span>
        </div>
        <div className={styles.metric}>
          <span>Spending this month</span>
          <strong className={styles.neg}>{formatMoney(currentMonth.spending)}</strong>
          <span className={styles.subMuted}>Last month {formatMoney(previousMonth.spending)}</span>
        </div>
        <div className={styles.metric}>
          <span>
            <Repeat size={11} aria-hidden /> Confirmed recurring load
          </span>
          <strong>{formatMoney(summary.confirmedRecurringMonthlyLoad)}</strong>
          <span className={styles.subMuted}>{summary.confirmedRecurringCount} active</span>
        </div>
        <div className={styles.metric}>
          <span>
            <TriangleAlert size={11} aria-hidden /> Pending recurring
          </span>
          <strong>{formatMoney(summary.pendingRecurringMonthlyLoad)}</strong>
          <span className={styles.subMuted}>{summary.pendingRecurringCount} pending</span>
        </div>
      </div>

      {summary.priceChanges.length > 0 ? (
        <div className={styles.priceChanges}>
          <h3>Recurring price changes</h3>
          <ul>
            {summary.priceChanges.slice(0, 3).map((change) => (
              <li key={change.transactionId}>
                <Link href={`/transactions/${change.transactionId}`}>
                  <span>{change.merchant}</span>
                  <span className={change.deltaAmount > 0 ? styles.neg : styles.pos}>
                    {change.deltaAmount > 0 ? "+" : "−"}
                    {formatMoneyExact(Math.abs(change.deltaAmount))}
                  </span>
                  <span className={styles.subMuted}>
                    {formatMoneyExact(change.previousAmount)} → {formatMoneyExact(change.currentAmount)}
                  </span>
                  <ArrowRight size={12} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {staleNote ? <p className={styles.staleNote}>{staleNote}</p> : null}
    </section>
  );
}
