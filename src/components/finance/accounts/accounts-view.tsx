import type { AccountRecord, BalanceSnapshotRecord } from "@/lib/db";
import { accountSyncState, balanceContribution } from "@/lib/finance/balances";
import { PlaidConnectionPanel } from "@/components/plaid/plaid-connection-panel";
import {
  CheckCircle2,
  CircleSlash,
  Clock3,
  Database,
  Landmark,
  TriangleAlert,
  type LucideIcon
} from "lucide-react";
import styles from "./accounts.module.css";

interface AccountsViewProps {
  accounts: AccountRecord[];
  dataError?: string;
  isConfigured: boolean;
  isSignedIn: boolean;
  snapshots: BalanceSnapshotRecord[];
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

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatRelativeTime(value: string | null) {
  if (!value) return "Never synced";

  const syncedAt = new Date(value);
  if (Number.isNaN(syncedAt.getTime())) return "Never synced";

  const diffMs = Math.max(0, Date.now() - syncedAt.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return syncedAt.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

function formatAbsoluteSync(value: string | null) {
  if (!value) return "No sync recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No sync recorded";
  return date.toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatAccountKind(account: AccountRecord) {
  return account.subtype ?? account.type;
}

const SYNC_BADGE_META: Record<
  "fresh" | "stale" | "never" | "valuation",
  { icon: LucideIcon; label: string; tooltip: string }
> = {
  fresh: {
    icon: CheckCircle2,
    label: "Synced",
    tooltip: "Synced within the last 24 hours"
  },
  never: {
    icon: CircleSlash,
    label: "No sync yet",
    tooltip: "This account has not synced yet"
  },
  stale: {
    icon: Clock3,
    label: "Synced",
    tooltip: "Last successful sync was more than 24 hours ago"
  },
  valuation: {
    icon: Database,
    label: "Balance only",
    tooltip: "Investment and retirement accounts use saved balance snapshots here; holdings are not priced live in this app yet."
  }
};

function isValuationOnlyAccount(account: AccountRecord) {
  return account.type === "investment" || account.type === "retirement";
}

function groupAccountsByInstitution(accounts: readonly AccountRecord[]) {
  const groups = new Map<string, { institutionName: string; accounts: AccountRecord[]; total: number }>();
  for (const account of accounts) {
    const key = account.institutionName || "Other";
    let group = groups.get(key);
    if (!group) {
      group = { accounts: [], institutionName: key, total: 0 };
      groups.set(key, group);
    }
    group.accounts.push(account);
    group.total += balanceContribution(account);
  }
  return Array.from(groups.values()).sort((a, b) => a.institutionName.localeCompare(b.institutionName));
}

function latestSnapshotsByAccount(snapshots: readonly BalanceSnapshotRecord[]) {
  return snapshots.reduce((map, snapshot) => {
    const current = map.get(snapshot.accountId);
    if (!current || current.snapshotDate < snapshot.snapshotDate) {
      map.set(snapshot.accountId, snapshot);
    }
    return map;
  }, new Map<string, BalanceSnapshotRecord>());
}

function AccountCard({
  account,
  latestSnapshot
}: {
  account: AccountRecord;
  latestSnapshot?: BalanceSnapshotRecord;
}) {
  const displayBalance = balanceContribution(account);
  const valuationOnly = isValuationOnlyAccount(account);
  const syncState = valuationOnly ? "valuation" : accountSyncState(account);
  const badgeMeta = SYNC_BADGE_META[syncState];
  const BadgeIcon = badgeMeta.icon;
  const displayName = account.name || account.institutionName;
  const utilization = account.type === "credit" && account.creditLimit
    ? Math.min(100, Math.round((Math.abs(displayBalance) / account.creditLimit) * 100))
    : null;
  const needsRepair = !account.isActive;
  const absoluteSync = formatAbsoluteSync(account.lastSyncedAt);
  const availableLabel = valuationOnly ? "Reported value" : account.type === "credit" ? "Available credit" : "Available";
  const availableValue = account.availableBalance === null ? "Not reported" : formatMoney(account.availableBalance);
  const limitValue = account.creditLimit === null ? "Not reported" : formatMoney(account.creditLimit);

  return (
    <article className={`${styles.accountCard} ${needsRepair ? styles.inactiveCard : ""}`}>
      <div className={styles.accountHead}>
        <div className={styles.accountTitle}>
          <span className={styles.swatch} style={{ background: account.color ?? "var(--ink)" }} aria-hidden />
          <div className={styles.accountName}>
            <strong>{displayName}</strong>
            <span>{account.mask ? `•••• ${account.mask}` : formatAccountKind(account)}</span>
          </div>
        </div>
        <span
          className={`${styles.syncPill} ${styles[`sync-${syncState}`]}`}
          title={badgeMeta.tooltip}
        >
          <BadgeIcon size={11} aria-hidden />
          <span aria-hidden>{badgeMeta.label}</span>
          <span className="sr-only">{badgeMeta.label}</span>
        </span>
      </div>

      <div className={styles.balanceRow}>
        <div className={`${styles.balance} tabular-nums ${displayBalance < 0 ? styles.negative : ""}`}>
          {formatMoney(displayBalance)}
        </div>
        <span className={styles.kind}>{formatAccountKind(account)}</span>
      </div>

      <div className={styles.detailGrid}>
        <div>
          <span>{availableLabel}</span>
          <strong className="tabular-nums">{availableValue}</strong>
        </div>
        {account.type === "credit" ? (
          <div>
            <span>Limit</span>
            <strong className="tabular-nums">{limitValue}</strong>
          </div>
        ) : null}
      </div>

      {utilization !== null ? (
        <div className={styles.utilization}>
          <div>
            <span style={{ width: `${utilization}%` }} />
          </div>
          <strong className="tabular-nums">{utilization}% utilized</strong>
        </div>
      ) : null}

      {needsRepair ? (
        <div className={styles.repairBanner} role="status">
          <TriangleAlert size={13} aria-hidden />
          <span>Needs repair in Settings</span>
        </div>
      ) : null}

      <div className={styles.accountFoot}>
        <span title={absoluteSync}>
          {valuationOnly ? <Database size={12} aria-hidden /> : <Clock3 size={12} aria-hidden />}
          {valuationOnly ? "Balance only" : formatRelativeTime(account.lastSyncedAt)}
        </span>
        <span>
          {latestSnapshot ? `Snapshot ${formatDate(latestSnapshot.snapshotDate)}` : "No snapshot"}
        </span>
      </div>
    </article>
  );
}

export function AccountsView({
  accounts,
  dataError,
  isConfigured,
  isSignedIn,
  snapshots
}: AccountsViewProps) {
  const latestSnapshotByAccount = latestSnapshotsByAccount(snapshots);

  return (
    <div className={styles.shell}>
      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so persisted account data cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in with Supabase Auth to load your persisted accounts.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      <PlaidConnectionPanel />

      {accounts.length === 0 ? (
        <div className={styles.emptyState}>
          <Database size={24} aria-hidden />
          <div>
            <strong>No persisted accounts yet</strong>
            <span>Connected accounts will appear here with balances, snapshots, and sync status.</span>
          </div>
        </div>
      ) : (
        <>
          <section className={styles.accountListSection} aria-label="Connected accounts">
            <div className={styles.accountListHead}>
              <h2>Connected accounts</h2>
              <span>{accounts.length.toLocaleString("en-US")} connected</span>
            </div>
            <div className={styles.groupStack}>
              {groupAccountsByInstitution(accounts).map((group) => (
                <div className={styles.institutionGroup} key={group.institutionName}>
                  <div className={styles.institutionHead}>
                    <h3>
                      <Landmark size={13} aria-hidden />
                      {group.institutionName}
                      <span className={styles.institutionCount}>
                        {group.accounts.length} {group.accounts.length === 1 ? "account" : "accounts"}
                      </span>
                    </h3>
                    <strong className={`tabular-nums ${group.total < 0 ? styles.negative : ""}`.trim()}>
                      {formatMoney(group.total)}
                    </strong>
                  </div>
                  <div className={styles.accountGrid}>
                    {group.accounts.map((account) => (
                      <AccountCard
                        account={account}
                        key={account.id}
                        latestSnapshot={latestSnapshotByAccount.get(account.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
