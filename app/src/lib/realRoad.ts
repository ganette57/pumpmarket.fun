// src/lib/realRoad.ts
//
// The COMMUNITY ROAD: cumulative eligible Real trading volume, and the
// reward milestones it unlocks.
//
// DELIBERATELY SEPARATE FROM THE TRADER RANKING
// ---------------------------------------------
// The page carries two metrics and they must never be conflated:
//
//   Trader ranking — CLAIMED PROFIT per wallet, in SOL. Competitive.
//   Community road — CUMULATIVE VOLUME across everyone, in SOL. Collective.
//
// The road used to be driven by the leading trader's profit, which made
// one person's result look like the community's progress. It is now
// driven by volume, which is what every trade actually contributes to.
//
// PURE AND SHARED
// ---------------
// No `server-only` and no I/O, so the server can compute the authoritative
// numbers and the client can render the same ladder without a second copy
// of the thresholds. Everything here is a pure function of (volume, price).
//
// REWARDS ARE NOT GUARANTEED
// --------------------------
// Every amount below is an UPPER BOUND on a campaign that is verified,
// reviewed and subject to published terms before anything is paid. The
// copy says "up to" everywhere and nothing here implies a funded pool.

/** The campaign's final volume goal, in USD. */
export const ROAD_FINAL_GOAL_USD = 100_000_000;

/**
 * CUMULATIVE milestones: reaching a threshold means the community reward
 * ceiling for the campaign becomes that amount IN TOTAL — it is not added
 * on top of the previous tier. $1M at $100M volume is the whole campaign
 * maximum, not the eighth instalment.
 */
export type RoadMilestone = {
  /** Cumulative eligible Real volume, in USD. */
  volume_usd: number;
  /** Total community rewards unlocked at that volume, in USD. */
  rewards_usd: number;
  /** Compact label for the milestone track. */
  label: string;
};

export const ROAD_MILESTONES: RoadMilestone[] = [
  { volume_usd: 100_000, rewards_usd: 1_000, label: "$100K" },
  { volume_usd: 500_000, rewards_usd: 5_000, label: "$500K" },
  { volume_usd: 1_000_000, rewards_usd: 10_000, label: "$1M" },
  { volume_usd: 5_000_000, rewards_usd: 50_000, label: "$5M" },
  { volume_usd: 10_000_000, rewards_usd: 100_000, label: "$10M" },
  { volume_usd: 25_000_000, rewards_usd: 250_000, label: "$25M" },
  { volume_usd: 50_000_000, rewards_usd: 500_000, label: "$50M" },
  { volume_usd: 100_000_000, rewards_usd: 1_000_000, label: "$100M" },
];

/** The campaign maximum — the last milestone's total, never a sum of tiers. */
export const ROAD_MAX_REWARDS_USD =
  ROAD_MILESTONES[ROAD_MILESTONES.length - 1].rewards_usd;

/* -------------------------------------------------------------------------- */
/*  Reward distribution — the ONE place any split is written down              */
/* -------------------------------------------------------------------------- */

/**
 * How a milestone's pool is planned to be split.
 *
 * SINGLE SOURCE. The card, the podium badges and the remaining-places line
 * all read these numbers; none of them writes an amount of its own. A
 * split that lived in three components would drift the first time one
 * changed, and a leaderboard that advertises two different first prizes
 * is worse than one that advertises none.
 *
 * PLANNED MAXIMUMS. Every figure is an upper bound on a campaign that is
 * verified and reviewed before anything is paid — never a funded pool.
 */
export type MilestoneRewardBreakdown = {
  milestone_usd: number;
  total_reward_usd: number;
  rewarded_traders: number;
  first_usd: number;
  second_usd: number;
  third_usd: number;
  remaining_from_rank: number;
  remaining_to_rank: number;
  /** Shared across remaining_from_rank..remaining_to_rank. */
  remaining_pool_usd: number;
};

/**
 * Only the FIRST milestone has a published split. Later milestones
 * deliberately have none yet: inventing seven more top-three ladders
 * would commit the product to numbers nobody has decided, and the UI is
 * built to say "breakdown will be published before the snapshot" rather
 * than guess. Adding one later is appending an entry here — no component
 * changes.
 *
 * INVARIANT: first + second + third + remaining_pool === total_reward.
 * 400 + 250 + 150 + 200 = 1000.
 */
export const MILESTONE_REWARD_BREAKDOWNS: MilestoneRewardBreakdown[] = [
  {
    milestone_usd: 100_000,
    total_reward_usd: 1_000,
    rewarded_traders: 10,
    first_usd: 400,
    second_usd: 250,
    third_usd: 150,
    remaining_from_rank: 4,
    remaining_to_rank: 10,
    remaining_pool_usd: 200,
  },
];

/** The published split for a milestone, or null when none exists yet. */
export function rewardBreakdownFor(
  milestoneUsd: number | null | undefined
): MilestoneRewardBreakdown | null {
  if (milestoneUsd == null) return null;
  return (
    MILESTONE_REWARD_BREAKDOWNS.find((b) => b.milestone_usd === milestoneUsd) ??
    null
  );
}

/** The planned reward for a podium rank, or null off the published podium. */
export function plannedRewardForRank(
  breakdown: MilestoneRewardBreakdown | null,
  rank: number
): number | null {
  if (!breakdown) return null;
  if (rank === 1) return breakdown.first_usd;
  if (rank === 2) return breakdown.second_usd;
  if (rank === 3) return breakdown.third_usd;
  return null;
}

/**
 * Community rewards actually distributed so far, in USD.
 *
 * A CONFIG CONSTANT, not a computed figure: no backend tracks payouts yet,
 * and inventing a number here would be claiming payments that never
 * happened. It stays 0 until verified results exist to point at.
 */
export const ROAD_REWARDS_DISTRIBUTED_USD = Number(
  process.env.NEXT_PUBLIC_REAL_REWARDS_DISTRIBUTED_USD || 0
);

export type RoadProgress = {
  /** Authoritative unit. Always present, price or no price. */
  total_real_volume_sol: string;
  /** Null when no defensible SOL price exists — hide every USD figure. */
  total_real_volume_usd: number | null;
  /** Threshold the current step started from. 0 below the first milestone. */
  previous_milestone_usd: number | null;
  /** Threshold being worked towards. Null once the final goal is reached. */
  next_milestone_usd: number | null;
  /** Total rewards unlocked by reaching next_milestone_usd. */
  next_reward_usd: number | null;
  /** 0..1 within the CURRENT step, not across the whole campaign. */
  milestone_progress: number | null;
  /** Total rewards unlocked by milestones already passed. 0 when none. */
  unlocked_rewards_usd: number | null;
  final_goal_usd: number;
  maximum_rewards_usd: number;
  rewards_distributed_usd: number;
  /**
   * The published split for the milestone currently being worked towards.
   * Null when that milestone has no split configured yet — the UI then
   * says so rather than showing a stale one from an earlier milestone.
   */
  reward_breakdown: MilestoneRewardBreakdown | null;
  /** When the price used here was reported. Null when there is no price. */
  price_timestamp: string | null;
};

/**
 * Where the community stands on the road.
 *
 * PROGRESS IS PER-STEP, not campaign-wide: a bar that crawls across
 * $100,000,000 would read as motionless for a year, whereas "how far
 * through the CURRENT milestone" moves visibly and is the number a
 * trader can act on.
 *
 *   below the first milestone   current / 100,000
 *   between two milestones      (current − previous) / (next − previous)
 *   at or above the final goal  1
 *
 * Without a price the SOL total still returns and every USD-derived field
 * is null, so the caller shows volume and hides milestone progress rather
 * than deriving it from a stale rate.
 */
export function computeRoadProgress(args: {
  volumeSol: string;
  solUsd: number | null;
  priceAsOf: string | null;
}): RoadProgress {
  const base = {
    total_real_volume_sol: args.volumeSol,
    final_goal_usd: ROAD_FINAL_GOAL_USD,
    maximum_rewards_usd: ROAD_MAX_REWARDS_USD,
    rewards_distributed_usd: ROAD_REWARDS_DISTRIBUTED_USD,
  };

  const sol = Number(args.volumeSol);
  if (args.solUsd == null || !Number.isFinite(sol)) {
    return {
      ...base,
      total_real_volume_usd: null,
      previous_milestone_usd: null,
      next_milestone_usd: null,
      next_reward_usd: null,
      milestone_progress: null,
      unlocked_rewards_usd: null,
      // Without a price there is no way to know WHICH milestone is next,
      // so no split is claimed either. Showing the first one regardless
      // would be wrong the moment volume has already passed it.
      reward_breakdown: null,
      price_timestamp: null,
    };
  }

  const usd = Math.max(sol * args.solUsd, 0);

  // The first milestone not yet reached. `undefined` means the community
  // is at or past the final goal.
  const nextIndex = ROAD_MILESTONES.findIndex((m) => usd < m.volume_usd);
  const reachedCount = nextIndex === -1 ? ROAD_MILESTONES.length : nextIndex;

  const unlocked =
    reachedCount > 0 ? ROAD_MILESTONES[reachedCount - 1].rewards_usd : 0;

  if (nextIndex === -1) {
    // Final goal reached: the step is complete by definition.
    return {
      ...base,
      total_real_volume_usd: usd,
      previous_milestone_usd: ROAD_FINAL_GOAL_USD,
      next_milestone_usd: null,
      next_reward_usd: null,
      milestone_progress: 1,
      unlocked_rewards_usd: unlocked,
      // Campaign complete: there is no next milestone to split.
      reward_breakdown: null,
      price_timestamp: args.priceAsOf,
    };
  }

  const next = ROAD_MILESTONES[nextIndex];
  const previous = nextIndex === 0 ? 0 : ROAD_MILESTONES[nextIndex - 1].volume_usd;
  const span = next.volume_usd - previous;

  // span is positive for every pair in the ladder, but guard anyway so a
  // future edit that duplicates a threshold cannot divide by zero.
  const progress = span > 0 ? Math.min(Math.max((usd - previous) / span, 0), 1) : 0;

  return {
    ...base,
    total_real_volume_usd: usd,
    previous_milestone_usd: previous,
    next_milestone_usd: next.volume_usd,
    next_reward_usd: next.rewards_usd,
    milestone_progress: progress,
    unlocked_rewards_usd: unlocked,
    // Null once the community passes $100K, until a split is configured
    // for the milestone after it. The UI says so rather than keeping the
    // $100K ladder on screen as though it were still the active one.
    reward_breakdown: rewardBreakdownFor(next.volume_usd),
    price_timestamp: args.priceAsOf,
  };
}
