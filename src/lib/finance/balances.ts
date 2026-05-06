import type { AccountRecord, AccountType, BalanceSnapshotRecord } from "@/lib/db";

export type AccountGroupKey = "cash" | "credit" | "investments" | "retirement";
export type TrendSource = "current" | "snapshot";
export type SyncState = "fresh" | "stale" | "never";

export interface AccountBalanceTotals {
  cash: number;
  credit: number;
  investments: number;
  retirement: number;
  assets: number;
  liabilities: number;
  netWorth: number;
}

export interface AccountGroup {
  key: AccountGroupKey;
  label: string;
  description: string;
  accounts: AccountRecord[];
  total: number;
}

export interface BalanceTrendPoint {
  date: string;
  netWorth: number;
  source: TrendSource;
}

export interface SyncSummary {
  latestSyncedAt: string | null;
  freshCount: number;
  staleCount: number;
  neverSyncedCount: number;
  status: "empty" | SyncState;
}

interface BalanceLike {
  type: AccountType;
  balance: number;
}

const GROUP_ORDER: AccountGroupKey[] = ["cash", "credit", "investments", "retirement"];

const GROUP_META: Record<AccountGroupKey, Pick<AccountGroup, "description" | "label">> = {
  cash: {
    description: "Checking, savings, and other depository balances.",
    label: "Cash"
  },
  credit: {
    description: "Credit cards and revolving liabilities.",
    label: "Credit / liabilities"
  },
  investments: {
    description: "Taxable brokerage and investment accounts.",
    label: "Investments"
  },
  retirement: {
    description: "Retirement accounts and tax-advantaged investments.",
    label: "Retirement"
  }
};

export function accountGroupKey(type: AccountType): AccountGroupKey {
  if (type === "depository") return "cash";
  if (type === "credit") return "credit";
  if (type === "investment") return "investments";
  return "retirement";
}

export function balanceContribution({ balance, type }: BalanceLike): number {
  if (type === "credit") {
    return -Math.abs(balance);
  }

  return balance;
}

export function calculateAccountTotals(accounts: readonly AccountRecord[]): AccountBalanceTotals {
  const totals = accounts.reduce(
    (sum, account) => {
      const value = balanceContribution(account);
      const key = accountGroupKey(account.type);
      sum[key] += value;

      if (key === "credit") {
        sum.liabilities += Math.abs(value);
      } else {
        sum.assets += value;
      }

      sum.netWorth += value;
      return sum;
    },
    {
      assets: 0,
      cash: 0,
      credit: 0,
      investments: 0,
      liabilities: 0,
      netWorth: 0,
      retirement: 0
    }
  );

  return totals;
}

export function groupAccounts(accounts: readonly AccountRecord[]): AccountGroup[] {
  return GROUP_ORDER.map((key) => {
    const groupedAccounts = accounts.filter((account) => accountGroupKey(account.type) === key);

    return {
      ...GROUP_META[key],
      accounts: groupedAccounts,
      key,
      total: groupedAccounts.reduce((sum, account) => sum + balanceContribution(account), 0)
    };
  });
}

export function buildBalanceTrend(
  accounts: readonly AccountRecord[],
  snapshots: readonly BalanceSnapshotRecord[],
  options: { asOfDate?: string; maxPoints?: number } = {}
): BalanceTrendPoint[] {
  if (accounts.length === 0) return [];

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const totalsByDate = new Map<string, number>();

  snapshots.forEach((snapshot) => {
    const account = accountById.get(snapshot.accountId);
    if (!account) return;

    totalsByDate.set(
      snapshot.snapshotDate,
      (totalsByDate.get(snapshot.snapshotDate) ?? 0) +
        balanceContribution({ balance: snapshot.currentBalance, type: account.type })
    );
  });

  const points = [...totalsByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, netWorth]) => ({ date, netWorth, source: "snapshot" as const }));

  if (points.length > 0) {
    return points.slice(-(options.maxPoints ?? 24));
  }

  return [
    {
      date: options.asOfDate ?? new Date().toISOString().slice(0, 10),
      netWorth: calculateAccountTotals(accounts).netWorth,
      source: "current"
    }
  ];
}

export function accountSyncState(
  account: Pick<AccountRecord, "lastSyncedAt">,
  options: { now?: Date; staleAfterHours?: number } = {}
): SyncState {
  if (!account.lastSyncedAt) return "never";

  const syncedAt = new Date(account.lastSyncedAt);
  if (Number.isNaN(syncedAt.getTime())) return "never";

  const now = options.now ?? new Date();
  const staleAfterMs = (options.staleAfterHours ?? 24) * 60 * 60 * 1000;
  return now.getTime() - syncedAt.getTime() > staleAfterMs ? "stale" : "fresh";
}

export function summarizeSync(
  accounts: readonly Pick<AccountRecord, "lastSyncedAt">[],
  options: { now?: Date; staleAfterHours?: number } = {}
): SyncSummary {
  if (accounts.length === 0) {
    return {
      freshCount: 0,
      latestSyncedAt: null,
      neverSyncedCount: 0,
      staleCount: 0,
      status: "empty"
    };
  }

  let latestSyncedAt: string | null = null;

  const counts = accounts.reduce(
    (sum, account) => {
      const state = accountSyncState(account, options);
      if (state === "fresh") sum.freshCount += 1;
      if (state === "stale") sum.staleCount += 1;
      if (state === "never") sum.neverSyncedCount += 1;

      if (
        account.lastSyncedAt &&
        (!latestSyncedAt || new Date(account.lastSyncedAt).getTime() > new Date(latestSyncedAt).getTime())
      ) {
        latestSyncedAt = account.lastSyncedAt;
      }

      return sum;
    },
    { freshCount: 0, neverSyncedCount: 0, staleCount: 0 }
  );

  return {
    ...counts,
    latestSyncedAt,
    status: counts.neverSyncedCount === accounts.length ? "never" : counts.staleCount > 0 ? "stale" : "fresh"
  };
}
