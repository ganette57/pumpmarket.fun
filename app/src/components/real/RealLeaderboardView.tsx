"use client";

import MinimalLeaderboard, { type MinimalLeaderboardPlayer } from "@/components/leaderboard/MinimalLeaderboard";
import { useRealLeaderboard, type RealLeaderboardResponse, type RealLeaderboardRowView } from "@/components/real/useRealLeaderboard";

function shortWallet(wallet: string) {
  return wallet.length <= 10 ? wallet : `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

function scoreOf(value: string) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? amount : 0;
  const formatted = `${Math.abs(safe).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} SOL`;
  return safe > 0 ? `+${formatted}` : safe < 0 ? `-${formatted}` : formatted;
}

function playerOf(row: RealLeaderboardRowView): MinimalLeaderboardPlayer {
  return {
    rank: row.rank,
    wallet: row.wallet_address,
    name: row.username?.trim() || shortWallet(row.wallet_address),
    avatarUrl: row.avatar_url,
    score: scoreOf(row.claimed_profit_sol),
  };
}

function rewardCopy(data: RealLeaderboardResponse | null) {
  const breakdown = data?.road.reward_breakdown;
  if (!breakdown) return null;
  return `At the next configured volume milestone, up to $${breakdown.total_reward_usd.toLocaleString("en-US")} is planned for the top ${breakdown.rewarded_traders} traders. Rewards remain subject to verification.`;
}

function formatUsdVolume(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function RealLeaderboardView() {
  const { data, pending, error } = useRealLeaderboard({ limit: 3 });
  const road = data?.road ?? null;
  const hasProgress =
    road?.total_real_volume_usd != null &&
    road.milestone_progress != null;
  const target = road
    ? road.next_milestone_usd ?? road.final_goal_usd
    : null;
  const summary = pending
    ? ({ kind: "loading" } as const)
    : hasProgress && road && target != null
      ? ({
          kind: "progress",
          label: road.next_milestone_usd != null
            ? `Road to ${formatUsdVolume(road.next_milestone_usd)} volume`
            : "Final volume goal reached",
          current: formatUsdVolume(road.total_real_volume_usd as number),
          target: formatUsdVolume(target),
          percent: (road.milestone_progress as number) * 100,
        } as const)
      : ({
          kind: "empty",
          message: error ? "Leaderboard unavailable" : "Volume progress unavailable",
        } as const);

  return (
    <MinimalLeaderboard
      players={(data?.rows ?? []).slice(0, 3).map(playerOf)}
      summary={summary}
      pending={pending}
      unavailable={error}
      explanation={{
        participation: "Trade Real markets. Winning positions count once their payout has been claimed; completed sells and refunds are also included.",
        calculation: "Players are ranked by claimed profit in SOL: claim, refund and completed sell proceeds minus gross buy costs. Unclaimed winning positions are excluded because their payout cannot be valued safely off-chain.",
        context: {
          title: "Volume goal",
          body: hasProgress && road && target != null
            ? `The Real competition runs until its volume goals are reached. The current milestone is ${formatUsdVolume(target)} in eligible Real trading volume; progress is calculated by the server within the current milestone.`
            : "The Real competition is volume-based, not weekly. USD milestone progress is unavailable when FunMarket does not have a current SOL/USD price.",
        },
        rewards: rewardCopy(data),
      }}
    />
  );
}
