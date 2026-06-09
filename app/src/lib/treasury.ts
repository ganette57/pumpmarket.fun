// Treasury — public Championship transparency / progress data.
//
// This is NOT accounting. No wallet balances, no fee wallets, no treasury
// addresses, no on-chain reads. Prize-pool / milestone figures are manual
// presentational constants. Trading volume is REAL: it reuses the same
// source Admin Overview uses — SUM(markets.total_volume) / 1e9 (lamports
// → SOL) — so the two screens always agree.

import { supabase } from "@/lib/supabaseClient";
import { getLeaderboardStats, shortWallet } from "@/lib/leaderboard";

// ---------------------------------------------------------------------------
// Manual presentational constants.
// Prize pool / target / milestone are NOT derived from any wallet or
// on-chain balance. SOL_USD_RATE is a TEMPORARY estimate used only to show
// an approximate USD value for the real on-platform SOL volume.
// ---------------------------------------------------------------------------
export const SOL_USD_RATE = 150; // TEMPORARY: estimated USD per 1 SOL

export const CHAMPIONSHIP_TREASURY = {
  currentPrizePool: "$150,000",
  targetPrizePool: "$1,000,000",
} as const;

// Progressive volume milestone ladder (USD). Progress is measured against
// the next un-reached rung, not the far-off championship target.
export const VOLUME_MILESTONES = [
  10_000,
  50_000,
  100_000,
  250_000,
  500_000,
  1_000_000,
  2_500_000,
  5_000_000,
  10_000_000,
  25_000_000,
  50_000_000,
  100_000_000,
] as const;

// The big-picture ambition, shown as context (not the progress target).
export const CHAMPIONSHIP_TARGET_USD = 100_000_000;

// ---------------------------------------------------------------------------
// Real traded volume — same calculation as Admin Overview
// (SUM markets.total_volume in lamports, /1e9 → SOL). Paginated to match
// the admin route and stay correct beyond 1000 markets.
// ---------------------------------------------------------------------------
export type TradedVolume = {
  sol: number;
  usd: number;
  // 0 when no milestone reached yet ("Launch").
  currentMilestone: number;
  // null when every milestone has been reached.
  nextMilestone: number | null;
  // Progress within the current..next milestone band, clamped 0..100.
  progressPct: number;
};

const MARKET_BATCH = 1000;

// Pure milestone math — exported for testability / reuse.
export function computeMilestones(usd: number): {
  currentMilestone: number;
  nextMilestone: number | null;
  progressPct: number;
} {
  let currentMilestone = 0;
  let nextMilestone: number | null = null;

  for (const m of VOLUME_MILESTONES) {
    if (usd >= m) {
      currentMilestone = m;
    } else {
      nextMilestone = m;
      break;
    }
  }

  let progressPct: number;
  if (nextMilestone == null) {
    // All milestones reached.
    progressPct = 100;
  } else {
    const span = nextMilestone - currentMilestone;
    progressPct = span > 0
      ? Math.max(0, Math.min(100, ((usd - currentMilestone) / span) * 100))
      : 0;
  }

  return { currentMilestone, nextMilestone, progressPct };
}

export async function getTradedVolume(): Promise<TradedVolume> {
  let sumLamports = 0;
  for (let from = 0; ; from += MARKET_BATCH) {
    const { data, error } = await supabase
      .from("markets")
      .select("total_volume")
      .order("id", { ascending: true })
      .range(from, from + MARKET_BATCH - 1);
    if (error || !data?.length) break;
    for (const r of data as any[]) sumLamports += Number(r.total_volume) || 0;
    if (data.length < MARKET_BATCH) break;
  }

  const sol = sumLamports / 1e9;
  const usd = sol * SOL_USD_RATE;
  const { currentMilestone, nextMilestone, progressPct } = computeMilestones(usd);

  return { sol, usd, currentMilestone, nextMilestone, progressPct };
}

// ---------------------------------------------------------------------------
// Real Championship stats — read-only counts.
// ---------------------------------------------------------------------------
export type ChampionshipStats = {
  activePlayers: number;
  markets: number;
  funPointsDistributed: number;
  topPlayerWallet: string | null;
  topPlayerName: string | null;
};

export async function getChampionshipStats(): Promise<ChampionshipStats> {
  const [lb, marketsCount] = await Promise.all([
    getLeaderboardStats().catch(() => ({
      totalPlayers: 0,
      totalPoints: 0,
      topTraderWallet: null as string | null,
      topTraderName: null as string | null,
    })),
    countMarkets().catch(() => 0),
  ]);

  return {
    activePlayers: lb.totalPlayers,
    markets: marketsCount,
    funPointsDistributed: lb.totalPoints,
    topPlayerWallet: lb.topTraderWallet,
    topPlayerName: lb.topTraderName,
  };
}

async function countMarkets(): Promise<number> {
  const { count } = await supabase
    .from("markets")
    .select("market_address", { count: "exact", head: true });
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------
export function formatSol(n: number): string {
  // Compact-ish: 2 decimals up to thousands, no decimals above.
  const v = Number(n) || 0;
  if (v >= 1000) return `${Math.round(v).toLocaleString("en-US")} SOL`;
  return `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;
}

export function formatUsd(n: number): string {
  const v = Math.round(Number(n) || 0);
  return `$${v.toLocaleString("en-US")}`;
}

export function formatUsdApprox(n: number): string {
  return `≈ ${formatUsd(n)}`;
}

// Milestone label: 0 → "Launch", otherwise "$X,XXX".
export function formatMilestone(n: number | null): string {
  if (n == null) return "Max";
  if (n <= 0) return "Launch";
  return formatUsd(n);
}

// Progress label: 0 → "0%", (0,1) → "<1%", else rounded.
export function formatProgressPct(p: number): string {
  const v = Number(p) || 0;
  if (v <= 0) return "0%";
  if (v < 1) return "<1%";
  return `${Math.round(v)}%`;
}

export { shortWallet };
