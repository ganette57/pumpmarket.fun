// Fun Points / Rewards system — Phase 2 (Supabase-backed)
//
// Read paths use the public anon client (RLS allows SELECT on the relevant
// tables). All write paths go through server API routes which use the
// service-role client to call SECURITY DEFINER RPCs — that's how we keep
// the ledger as the single source of truth and avoid trusting the client.
//
// Schema lives at app/supabase/migrations/20260608_fun_points_phase2.sql.

import { supabase } from "@/lib/supabaseClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FunPointsActivityKind =
  | "trade_volume"
  | "daily_checkin"
  | "referral_signup"
  | "referral_first_trade"
  | "referral_trade_bonus"
  | "task_reward";

export type FunPointsActivity = {
  id: string;
  kind: FunPointsActivityKind;
  label: string;
  points: number;
  at: string; // ISO timestamp
  metadata?: Record<string, unknown>;
};

export type FunPointsSummary = {
  wallet: string | null;
  balance: number;
  lifetimePoints: number;
  streak: number;
  claimedToday: boolean;
  recent: FunPointsActivity[];
  referralCode: string | null;
};

export type RewardTask = {
  id: string;
  title: string;
  description: string | null;
  points: number;
  taskType: string;
  url: string | null;
  active: boolean;
  done: boolean;
};

export type ReferralSummary = {
  code: string;
  link: string;
  invited: number;
  successfulTrades: number;
  // Points earned from referrals in the current period. For now (no
  // time-window concept yet) this equals lifetime — the field is kept
  // separate so a future "this month / this week" filter can land
  // without changing the UI.
  pointsEarned: number;
  lifetimePointsEarned: number;
};

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const REFERRAL_BASE_URL = "https://funmarket.app/?ref=";
const REFERRAL_CODE_FALLBACK = "FUN000000";

export function formatPoints(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// Compact format for tight spots like the mobile header.
// 999 -> "999", 1240 -> "1.2K", 12400 -> "12.4K", 1_240_000 -> "1.2M".
export function formatPointsCompact(n: number): string {
  const v = Math.round(n);
  if (v < 1000) return String(v);
  if (v < 1_000_000) {
    const k = v / 1000;
    return `${k.toFixed(k < 10 ? 1 : 0).replace(/\.0$/, "")}K`;
  }
  const m = v / 1_000_000;
  return `${m.toFixed(m < 10 ? 1 : 0).replace(/\.0$/, "")}M`;
}

export function activityLabel(kind: FunPointsActivityKind): string {
  switch (kind) {
    case "trade_volume":          return "Trade volume";
    case "daily_checkin":         return "Daily check-in";
    case "referral_signup":       return "Referral signup";
    case "referral_first_trade":  return "Referral first trade";
    case "referral_trade_bonus":  return "Referral trading bonus";
    case "task_reward":           return "Task reward";
    default:                      return String(kind);
  }
}

function deterministicCode(wallet: string): string {
  // Mirrors the SQL function fp_referral_code_for() so the UI can show a
  // sensible code even before the user has any ledger activity (before
  // fp_ensure_account has stored a code).
  let h = 0;
  for (let i = 0; i < wallet.length; i++) {
    h = (h * 31 + wallet.charCodeAt(i)) >>> 0;
  }
  const hex = h.toString(16).toUpperCase().padStart(6, "0").slice(0, 6);
  return `FUN${hex}`;
}

// ---------------------------------------------------------------------------
// Read paths — anon SELECT via RLS
// ---------------------------------------------------------------------------

const EMPTY_SUMMARY: FunPointsSummary = {
  wallet: null,
  balance: 0,
  lifetimePoints: 0,
  streak: 0,
  claimedToday: false,
  recent: [],
  referralCode: null,
};

export async function getFunPointsSummary(
  wallet: string | null | undefined
): Promise<FunPointsSummary> {
  if (!wallet) return EMPTY_SUMMARY;

  // Account
  const { data: acc } = await supabase
    .from("fun_points_accounts")
    .select("wallet,total_points,lifetime_points,current_streak,last_checkin_date,referral_code")
    .eq("wallet", wallet)
    .maybeSingle();

  // Recent activity (last 10)
  const { data: ledger } = await supabase
    .from("fun_points_ledger")
    .select("id,type,points,metadata,created_at")
    .eq("wallet", wallet)
    .order("created_at", { ascending: false })
    .limit(10);

  const recent: FunPointsActivity[] = (ledger || []).map((r: any) => ({
    id: String(r.id),
    kind: r.type as FunPointsActivityKind,
    label: activityLabel(r.type as FunPointsActivityKind),
    points: Number(r.points) || 0,
    at: r.created_at,
    metadata: r.metadata || undefined,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const claimedToday = !!acc && acc.last_checkin_date === today;

  return {
    wallet,
    balance: Number(acc?.total_points) || 0,
    lifetimePoints: Number(acc?.lifetime_points) || 0,
    streak: Number(acc?.current_streak) || 0,
    claimedToday,
    recent,
    referralCode: (acc?.referral_code as string) || deterministicCode(wallet),
  };
}

// Lightweight: just the balance (used by the header pill).
export async function getFunPointsBalance(
  wallet: string | null | undefined
): Promise<number> {
  if (!wallet) return 0;
  const { data } = await supabase
    .from("fun_points_accounts")
    .select("total_points")
    .eq("wallet", wallet)
    .maybeSingle();
  return Number(data?.total_points) || 0;
}

export async function getReferralSummary(
  wallet: string | null | undefined
): Promise<ReferralSummary> {
  const code = wallet ? deterministicCode(wallet) : REFERRAL_CODE_FALLBACK;
  const fallback: ReferralSummary = {
    code,
    link: `${REFERRAL_BASE_URL}${code}`,
    invited: 0,
    successfulTrades: 0,
    pointsEarned: 0,
    lifetimePointsEarned: 0,
  };
  if (!wallet) return fallback;

  // Stored code (if account exists) takes precedence
  const { data: acc } = await supabase
    .from("fun_points_accounts")
    .select("referral_code")
    .eq("wallet", wallet)
    .maybeSingle();

  const finalCode = (acc?.referral_code as string) || code;

  const [{ count: invitedCount }, { count: tradesCount }, { data: bonusRows }] =
    await Promise.all([
      supabase
        .from("referrals")
        .select("referred_wallet", { count: "exact", head: true })
        .eq("referrer_wallet", wallet),
      supabase
        .from("referrals")
        .select("referred_wallet", { count: "exact", head: true })
        .eq("referrer_wallet", wallet)
        .not("first_trade_at", "is", null),
      supabase
        .from("fun_points_ledger")
        .select("points,type")
        .eq("wallet", wallet)
        .in("type", ["referral_signup", "referral_first_trade", "referral_trade_bonus"]),
    ]);

  const earned = (bonusRows || []).reduce(
    (sum: number, r: any) => sum + (Number(r.points) || 0),
    0
  );

  return {
    code: finalCode,
    link: `${REFERRAL_BASE_URL}${finalCode}`,
    invited: invitedCount || 0,
    successfulTrades: tradesCount || 0,
    pointsEarned: earned,
    lifetimePointsEarned: earned,
  };
}

export async function getActiveTasks(
  wallet: string | null | undefined
): Promise<RewardTask[]> {
  const { data: tasks } = await supabase
    .from("reward_tasks")
    .select("id,title,description,points,task_type,url,active,created_at")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (!tasks?.length) return [];

  let completed = new Set<string>();
  if (wallet) {
    const { data: done } = await supabase
      .from("task_completions")
      .select("task_id")
      .eq("wallet", wallet);
    completed = new Set((done || []).map((r: any) => String(r.task_id)));
  }

  return tasks.map((t: any) => ({
    id: String(t.id),
    title: t.title,
    description: t.description ?? null,
    points: Number(t.points) || 0,
    taskType: t.task_type,
    url: t.url ?? null,
    active: !!t.active,
    done: completed.has(String(t.id)),
  }));
}

// Top wallets by lifetime points. Phase 2 helper for the future leaderboard.
export async function getLifetimeLeaderboard(limit = 100): Promise<
  Array<{ wallet: string; lifetimePoints: number; totalPoints: number }>
> {
  const { data } = await supabase
    .from("fun_points_accounts")
    .select("wallet,total_points,lifetime_points")
    .order("lifetime_points", { ascending: false })
    .limit(limit);
  return (data || []).map((r: any) => ({
    wallet: r.wallet,
    lifetimePoints: Number(r.lifetime_points) || 0,
    totalPoints: Number(r.total_points) || 0,
  }));
}

// ---------------------------------------------------------------------------
// Write paths — proxied through /api/rewards/* so the service role and
// SECURITY DEFINER RPCs stay server-side.
// ---------------------------------------------------------------------------

type ClaimDailyResponse = {
  awarded: boolean;
  points: number;
  streak: number;
  balance: number;
};

export async function claimDailyReward(
  wallet: string | null | undefined
): Promise<ClaimDailyResponse> {
  if (!wallet) return { awarded: false, points: 0, streak: 0, balance: 0 };
  const res = await fetch("/api/rewards/daily-checkin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  if (!res.ok) return { awarded: false, points: 0, streak: 0, balance: 0 };
  return (await res.json()) as ClaimDailyResponse;
}

export async function completeRewardTask(
  wallet: string,
  taskId: string
): Promise<{ awarded: boolean; points: number; balance: number }> {
  const res = await fetch("/api/rewards/complete-task", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, taskId }),
  });
  if (!res.ok) return { awarded: false, points: 0, balance: 0 };
  return await res.json();
}

export async function recordReferral(
  referrer: string,
  referred: string
): Promise<{ ok: boolean; created: boolean }> {
  if (!referrer || !referred || referrer === referred) {
    return { ok: false, created: false };
  }
  const res = await fetch("/api/rewards/record-referral", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ referrer, referred }),
  });
  if (!res.ok) return { ok: false, created: false };
  return await res.json();
}

// Awarded automatically after a successful trade. Fire-and-forget from the
// trade success path — never throws.
export async function awardTradePoints(params: {
  wallet: string;
  costSol: number;
  marketAddress?: string | null;
  txSignature?: string | null;
}): Promise<void> {
  try {
    if (!params.wallet || !params.costSol || params.costSol <= 0) return;
    await fetch("/api/rewards/award-trade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    // Never block trading on points failure.
  }
}
