// Fun Points / Rewards system — Phase 1 (mock data)
//
// This module is the lightweight foundation for the Fun Points system.
// The shape of the helpers is intentionally close to what a future
// Supabase-backed implementation will look like (async, wallet-keyed),
// so callers can stay unchanged when real persistence lands.

export type FunPointsActivityKind =
  | "daily_checkin"
  | "first_trade"
  | "referral_bonus"
  | "trade"
  | "task";

export type FunPointsActivity = {
  id: string;
  kind: FunPointsActivityKind;
  label: string;
  points: number;
  // ISO timestamp
  at: string;
};

export type FunPointsSummary = {
  // Total cumulative Fun Points balance for the user.
  balance: number;
  // Recent earning events, newest first.
  recent: FunPointsActivity[];
  // Whether the daily check-in reward has already been claimed today.
  claimedToday: boolean;
};

export type RewardTask = {
  id: string;
  title: string;
  description?: string;
  points: number;
  // The action the user takes to claim.
  cta: string;
  // True when the task has already been completed by the user.
  done: boolean;
};

export type ReferralSummary = {
  // Short code shown to the user (derived from wallet address or mocked).
  code: string;
  // Full shareable link including the code.
  link: string;
  // Number of friends who signed up using the code.
  invited: number;
};

// Mock values for Phase 1. A future iteration will hydrate these from
// Supabase keyed by wallet address.
const MOCK_BALANCE = 1240;
const DAILY_REWARD_POINTS = 10;

const MOCK_RECENT: FunPointsActivity[] = [
  {
    id: "mock-daily",
    kind: "daily_checkin",
    label: "Daily Check-in",
    points: 10,
    at: new Date().toISOString(),
  },
  {
    id: "mock-first-trade",
    kind: "first_trade",
    label: "First Trade",
    points: 50,
    at: new Date().toISOString(),
  },
  {
    id: "mock-referral",
    kind: "referral_bonus",
    label: "Referral Bonus",
    points: 100,
    at: new Date().toISOString(),
  },
];

export function getFunPointsSummary(_wallet?: string | null): FunPointsSummary {
  return {
    balance: MOCK_BALANCE,
    recent: MOCK_RECENT,
    claimedToday: false,
  };
}

export function getDailyRewardPoints(): number {
  return DAILY_REWARD_POINTS;
}

// Mock daily-claim helper. Returns the points awarded; callers should
// move to a claimed UI state on success. Phase 2 will write to Supabase
// with per-wallet rate limiting.
export function claimDailyReward(_wallet?: string | null): {
  points: number;
  newBalance: number;
} {
  return {
    points: DAILY_REWARD_POINTS,
    newBalance: MOCK_BALANCE + DAILY_REWARD_POINTS,
  };
}

const REFERRAL_BASE_URL = "https://funmarket.app/?ref=";

export function getReferralSummary(wallet?: string | null): ReferralSummary {
  const code = wallet
    ? wallet.slice(0, 6).toUpperCase()
    : "FUN123";
  return {
    code,
    link: `${REFERRAL_BASE_URL}${code}`,
    invited: 0,
  };
}

// Display helpers ----------------------------------------------------------

export function formatPoints(n: number): string {
  return n.toLocaleString("en-US");
}

// Compact format for tight spots like the mobile header.
// 999 -> "999", 1240 -> "1.2K", 12400 -> "12.4K", 1_240_000 -> "1.2M".
export function formatPointsCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v.toFixed(v < 10 ? 1 : 0).replace(/\.0$/, "")}K`;
  }
  const v = n / 1_000_000;
  return `${v.toFixed(v < 10 ? 1 : 0).replace(/\.0$/, "")}M`;
}
