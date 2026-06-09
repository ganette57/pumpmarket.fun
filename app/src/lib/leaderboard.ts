// Global Fun Points leaderboard — read-only queries over the Phase 2
// tables. No writes, no new tables: everything is derived from
// fun_points_accounts (the running balance per wallet) and optionally
// joined to profiles for display name / avatar.
//
// Ranking is by lifetime_points desc, matching the documented future
// leaderboard rule SUM(lifetime_points) — here lifetime_points is the
// already-accumulated per-wallet total.

import { supabase } from "@/lib/supabaseClient";
import { getProfiles, type Profile } from "@/lib/profiles";

export type LeaderboardRow = {
  rank: number;
  wallet: string;
  displayName: string | null;
  avatarUrl: string | null;
  totalPoints: number;
  lifetimePoints: number;
  streak: number;
  referralCode: string | null;
  createdAt: string | null;
};

export type LeaderboardStats = {
  totalPlayers: number;
  totalPoints: number;
  topTraderWallet: string | null;
  topTraderName: string | null;
};

export type UserRank = {
  rank: number;
  totalPoints: number;
  lifetimePoints: number;
  streak: number;
  // Points the user still needs to overtake the wallet directly above
  // them. null when the user is already #1 (or unranked).
  pointsToNextRank: number | null;
};

function shortWallet(w: string): string {
  if (!w) return "";
  if (w.length <= 10) return w;
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

export function displayNameForRow(row: LeaderboardRow): string {
  return row.displayName?.trim() || shortWallet(row.wallet);
}

// Top N wallets by lifetime points, joined to profiles for name/avatar.
export async function getLeaderboard(limit = 100): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase
    .from("fun_points_accounts")
    .select("wallet,total_points,lifetime_points,current_streak,referral_code,created_at")
    .order("lifetime_points", { ascending: false })
    .order("created_at", { ascending: true }) // stable tie-break
    .limit(limit);

  if (error || !data) return [];

  // Best-effort profile join. Never let a profile fetch failure break
  // the leaderboard — fall back to short wallets.
  let profileMap = new Map<string, Profile>();
  try {
    const profiles = await getProfiles(data.map((r: any) => r.wallet));
    profileMap = new Map(profiles.map((p) => [p.wallet_address, p]));
  } catch {
    /* ignore — show wallets */
  }

  return data.map((r: any, i: number) => {
    const p = profileMap.get(r.wallet);
    return {
      rank: i + 1,
      wallet: r.wallet,
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
      totalPoints: Number(r.total_points) || 0,
      lifetimePoints: Number(r.lifetime_points) || 0,
      streak: Number(r.current_streak) || 0,
      referralCode: (r.referral_code as string) ?? null,
      createdAt: r.created_at ?? null,
    };
  });
}

export async function getLeaderboardStats(): Promise<LeaderboardStats> {
  const empty: LeaderboardStats = {
    totalPlayers: 0,
    totalPoints: 0,
    topTraderWallet: null,
    topTraderName: null,
  };

  // Player count (head request, no rows transferred)
  const { count } = await supabase
    .from("fun_points_accounts")
    .select("wallet", { count: "exact", head: true });

  // Sum of lifetime points. Launch-scale: pull the single column and sum
  // client-side. If the table grows large this should move to an RPC.
  const { data: allPts } = await supabase
    .from("fun_points_accounts")
    .select("lifetime_points");
  const totalPoints = (allPts || []).reduce(
    (s: number, r: any) => s + (Number(r.lifetime_points) || 0),
    0
  );

  // Top trader
  const { data: topRows } = await supabase
    .from("fun_points_accounts")
    .select("wallet,lifetime_points")
    .order("lifetime_points", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  const topWallet = topRows?.[0]?.wallet ?? null;
  let topName: string | null = null;
  if (topWallet) {
    try {
      const profiles = await getProfiles([topWallet]);
      topName = profiles[0]?.display_name ?? null;
    } catch {
      /* ignore */
    }
    if (!topName) topName = shortWallet(topWallet);
  }

  return {
    totalPlayers: count ?? 0,
    totalPoints,
    topTraderWallet: topWallet,
    topTraderName: topName,
  };
}

// Rank for a single wallet. Computed as (number of wallets with strictly
// more lifetime points) + 1 — O(1) round trip via a head count.
export async function getUserRank(wallet: string | null | undefined): Promise<UserRank | null> {
  if (!wallet) return null;

  const { data: acc } = await supabase
    .from("fun_points_accounts")
    .select("total_points,lifetime_points,current_streak")
    .eq("wallet", wallet)
    .maybeSingle();

  if (!acc) return null;

  const lifetime = Number(acc.lifetime_points) || 0;

  const { count: above } = await supabase
    .from("fun_points_accounts")
    .select("wallet", { count: "exact", head: true })
    .gt("lifetime_points", lifetime);

  const rank = (above ?? 0) + 1;

  // Points to overtake the wallet directly above. We grab the smallest
  // lifetime_points value strictly greater than ours.
  let pointsToNextRank: number | null = null;
  if (rank > 1) {
    const { data: nextUp } = await supabase
      .from("fun_points_accounts")
      .select("lifetime_points")
      .gt("lifetime_points", lifetime)
      .order("lifetime_points", { ascending: true })
      .limit(1);
    const nextVal = Number(nextUp?.[0]?.lifetime_points);
    if (Number.isFinite(nextVal)) {
      pointsToNextRank = Math.max(0, nextVal - lifetime) + 1;
    }
  }

  return {
    rank,
    totalPoints: Number(acc.total_points) || 0,
    lifetimePoints: lifetime,
    streak: Number(acc.current_streak) || 0,
    pointsToNextRank,
  };
}

export { shortWallet };
