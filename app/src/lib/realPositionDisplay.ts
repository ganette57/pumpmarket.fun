import { realCurrentPositionPayoutLamports } from "./realTradeQuote";

export type RealOpenPosition = {
  marketAddress: string;
  outcomeIndex: number;
  outcomeName: string;
  title: string;
  shares: number;
  payoutLamports: number | null;
  /** The program records cost for the whole market, not individual outcomes. */
  marketNetStakeLamports: number | null;
  heldOutcomeCount: number;
  lastTradeAt: string | null;
};

export function realOpenPositionRows(
  marketAddress: string, position: any, market: any, poolLamports: number,
  metadata?: { question?: string | null; outcome_names?: unknown },
): RealOpenPosition[] {
  if (!position || position.claimed || !market || market.resolved || market.cancelled) return [];
  const status = Object.keys(market.status ?? {})[0]?.toLowerCase();
  if (status === "finalized" || status === "cancelled") return [];
  const shares = (position.shares ?? []).map(Number) as number[];
  const held = shares.map((value, outcomeIndex) => ({ value, outcomeIndex }))
    .filter(({ value }) => Number.isSafeInteger(value) && value > 0);
  const rawCost = position.net_cost_lamports ?? position.netCostLamports;
  const cost = rawCost == null ? NaN : Number(String(rawCost));
  // Never take abs(): negative net cash contributed is not a positive stake.
  const marketNetStakeLamports = Number.isSafeInteger(cost) ? cost : null;
  const timestamp = Number(position.last_trade_ts ?? position.lastTradeTs);
  const date = timestamp > 0 ? new Date(timestamp * 1000) : null;
  const names = metadata?.outcome_names ?? market.outcome_names ?? market.outcomeNames;
  return held.map(({ value, outcomeIndex }) => ({
    marketAddress, outcomeIndex, shares: value,
    title: metadata?.question || market.question || marketAddress,
    outcomeName: Array.isArray(names) && names[outcomeIndex] != null
      ? String(names[outcomeIndex]) : `Outcome #${outcomeIndex + 1}`,
    payoutLamports: realCurrentPositionPayoutLamports(
      poolLamports, Number(market.q?.[outcomeIndex]), value,
    ),
    marketNetStakeLamports, heldOutcomeCount: held.length,
    lastTradeAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
  }));
}

export function onlyHeldPosition<T>(positions: T[], shares: (position: T) => number): T | null {
  const held = positions.filter(position => shares(position) > 0);
  return held.length === 1 ? held[0] : null;
}
