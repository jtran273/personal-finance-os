import type { LiabilityAccountSummary } from "./liabilities";

export type UtilizationTier = "optimal" | "ok" | "high" | "critical" | "unknown";

export interface PayoffCardPlan {
  accountId: string;
  name: string;
  mask: string | null;
  balance: number;
  creditLimit: number | null;
  utilizationPercent: number | null;
  tier: UtilizationTier;
  payToReachThirty: number;
  payToReachTen: number;
  payToZero: number;
  suggestedPayment: number;
}

export interface PayoffPlan {
  cards: PayoffCardPlan[];
  totalBalance: number;
  totalLimit: number;
  aggregateUtilization: number | null;
  aggregateTier: UtilizationTier;
  cashAvailable: number;
  cashApplied: number;
  projectedUtilization: number | null;
  projectedTier: UtilizationTier;
  topPick: PayoffCardPlan | null;
  topPickRationale: string | null;
}

const OPTIMAL_MAX = 10;
const OK_MAX = 30;
const HIGH_MAX = 50;

export function tierForUtilization(util: number | null): UtilizationTier {
  if (util === null) return "unknown";
  if (util < OPTIMAL_MAX) return "optimal";
  if (util < OK_MAX) return "ok";
  if (util < HIGH_MAX) return "high";
  return "critical";
}

export function tierLabel(tier: UtilizationTier): string {
  switch (tier) {
    case "optimal":
      return "Optimal (<10%)";
    case "ok":
      return "OK (<30%)";
    case "high":
      return "High (30–50%)";
    case "critical":
      return "Critical (50%+)";
    default:
      return "No limit reported";
  }
}

function payToReach(balance: number, limit: number | null, targetPct: number): number {
  if (!limit || limit <= 0) return 0;
  const target = (targetPct / 100) * limit;
  return Math.max(0, Math.round((balance - target) * 100) / 100);
}

export function buildPayoffPlan({
  rows,
  cashAvailable
}: {
  rows: readonly LiabilityAccountSummary[];
  cashAvailable: number;
}): PayoffPlan {
  const activeRows = rows.filter((row) => row.amountOwed > 0);

  const totalBalance = Math.round(activeRows.reduce((sum, r) => sum + r.amountOwed, 0) * 100) / 100;
  const totalLimit = activeRows.reduce((sum, r) => sum + (r.creditLimit ?? 0), 0);
  const aggregateUtilization =
    totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 1000) / 10 : null;

  const cards: PayoffCardPlan[] = activeRows.map((row) => {
    const tier = tierForUtilization(row.utilizationPercent);
    return {
      accountId: row.accountId,
      name: row.name,
      mask: row.mask,
      balance: row.amountOwed,
      creditLimit: row.creditLimit,
      utilizationPercent: row.utilizationPercent,
      tier,
      payToReachThirty: payToReach(row.amountOwed, row.creditLimit, OK_MAX),
      payToReachTen: payToReach(row.amountOwed, row.creditLimit, OPTIMAL_MAX),
      payToZero: row.amountOwed,
      suggestedPayment: 0
    };
  });

  // Allocation strategy (default = save money proxy w/o APR):
  // 1. Drop any card above 30% down to 30% (biggest score lift per dollar).
  // 2. Then drop any card above 10% down to 10%.
  // 3. Then apply remaining cash to highest balance first (interest-saving proxy).
  const order = [...cards].sort((a, b) => {
    const aUtil = a.utilizationPercent ?? -1;
    const bUtil = b.utilizationPercent ?? -1;
    if (bUtil !== aUtil) return bUtil - aUtil;
    return b.balance - a.balance;
  });

  let remaining = Math.max(0, cashAvailable);

  for (const card of order) {
    if (card.payToReachThirty <= 0) continue;
    const apply = Math.min(remaining, card.payToReachThirty);
    card.suggestedPayment += apply;
    remaining -= apply;
    if (remaining <= 0) break;
  }
  for (const card of order) {
    if (remaining <= 0) break;
    const stillOwedAfter = card.balance - card.suggestedPayment;
    const target = card.creditLimit ? (OPTIMAL_MAX / 100) * card.creditLimit : 0;
    const need = Math.max(0, stillOwedAfter - target);
    if (need <= 0) continue;
    const apply = Math.min(remaining, need);
    card.suggestedPayment += apply;
    remaining -= apply;
  }
  const byBalance = [...cards].sort((a, b) => b.balance - a.balance);
  for (const card of byBalance) {
    if (remaining <= 0) break;
    const stillOwedAfter = card.balance - card.suggestedPayment;
    if (stillOwedAfter <= 0) continue;
    const apply = Math.min(remaining, stillOwedAfter);
    card.suggestedPayment += apply;
    remaining -= apply;
  }

  const cashApplied = Math.round((Math.max(0, cashAvailable) - remaining) * 100) / 100;
  for (const card of cards) {
    card.suggestedPayment = Math.round(card.suggestedPayment * 100) / 100;
  }

  const projectedBalance = Math.max(0, totalBalance - cashApplied);
  const projectedUtilization =
    totalLimit > 0 ? Math.round((projectedBalance / totalLimit) * 1000) / 10 : null;

  // Top pick: card receiving the largest suggested payment, breaking ties by utilization.
  const ranked = [...cards]
    .filter((c) => c.suggestedPayment > 0)
    .sort((a, b) => {
      if (b.suggestedPayment !== a.suggestedPayment) return b.suggestedPayment - a.suggestedPayment;
      return (b.utilizationPercent ?? 0) - (a.utilizationPercent ?? 0);
    });
  const topPick = ranked[0] ?? null;

  let topPickRationale: string | null = null;
  if (topPick) {
    if (topPick.tier === "critical" || topPick.tier === "high") {
      topPickRationale = "Highest utilization — biggest credit-score lift per dollar.";
    } else if (topPick.tier === "ok") {
      topPickRationale = "Already under 30% — extra payment pushes it toward the optimal <10% tier.";
    } else if (topPick.tier === "optimal") {
      topPickRationale = "Largest remaining balance — cuts the most interest at equal APRs.";
    }
  }

  return {
    cards,
    totalBalance,
    totalLimit,
    aggregateUtilization,
    aggregateTier: tierForUtilization(aggregateUtilization),
    cashAvailable: Math.max(0, cashAvailable),
    cashApplied,
    projectedUtilization,
    projectedTier: tierForUtilization(projectedUtilization),
    topPick,
    topPickRationale
  };
}
