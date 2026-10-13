"use client";

import { useCallback } from "react";
import MinimalLeaderboard, { type MinimalLeaderboardPlayer } from "@/components/leaderboard/MinimalLeaderboard";
import { usePlayContest } from "@/components/play/usePlayContest";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { formatUsd, toCents, type PlayContestRowView, type PlayPublicContestView } from "@/lib/playClient";

function shortWallet(wallet: string) {
  return wallet.length <= 10 ? wallet : `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

function scoreOf(value: string) {
  const cents = toCents(value);
  const formatted = formatUsd(value);
  return cents !== null && cents > BigInt(0) ? `+${formatted}` : formatted;
}

function playerOf(row: PlayContestRowView): MinimalLeaderboardPlayer {
  return {
    rank: row.rank,
    wallet: row.wallet_address,
    name: row.username?.trim() || shortWallet(row.wallet_address),
    avatarUrl: row.avatar_url,
    score: scoreOf(row.realized_pnl_usd),
  };
}

function rewardCopy(contest: PlayPublicContestView | null) {
  if (!contest || Number(contest.prize_pool_usd) <= 0) return null;
  const prizes = [
    ["1st", contest.first_prize_usd],
    ["2nd", contest.second_prize_usd],
    ["3rd", contest.third_prize_usd],
  ]
    .filter(([, value]) => Number(value) > 0)
    .map(([rank, value]) => `${rank}: ${formatUsd(value)}`)
    .join(", ");
  return `${formatUsd(contest.prize_pool_usd)} is configured for this competition${prizes ? ` (${prizes})` : ""}. Results are verified before prizes are awarded.`;
}

export default function PlayLeaderboardView() {
  const { data, pending, error, refresh } = usePlayContest({ limit: 3 });
  const { ready, connected } = useFunMarketWallet();
  const { authenticated } = usePlaySession();
  const contest = data?.contest ?? null;
  const now = Date.now();
  const startsAt = contest ? new Date(contest.starts_at).getTime() : Number.NaN;
  const endsAt = contest ? new Date(contest.ends_at).getTime() : Number.NaN;
  const activeContest =
    contest?.status === "live" &&
    Number.isFinite(startsAt) &&
    Number.isFinite(endsAt) &&
    startsAt <= now &&
    now < endsAt
      ? contest
      : null;
  const refreshAtPeriodEnd = useCallback(() => refresh(), [refresh]);
  const summary = pending
    ? ({ kind: "loading" } as const)
    : activeContest
      ? ({ kind: "countdown", endsAt: activeContest.ends_at } as const)
      : ({ kind: "empty", message: error ? "Leaderboard unavailable" : "No active contest" } as const);
  const viewer = activeContest ? data?.viewer ?? null : null;
  const viewerPosition = !ready || pending
    ? ({ kind: "loading" } as const)
    : !connected
      ? ({ kind: "empty", message: "Connect wallet" } as const)
      : !authenticated
        ? ({ kind: "empty", message: "Sign in to view" } as const)
        : viewer
          ? ({ kind: "ranked", rank: viewer.rank, score: scoreOf(viewer.realized_pnl_usd) } as const)
          : ({ kind: "empty", message: "Not ranked" } as const);

  return (
    <MinimalLeaderboard
      players={activeContest ? (data?.ranking ?? []).slice(0, 3).map(playerOf) : []}
      summary={summary}
      prizePool={activeContest ? formatUsd(activeContest.prize_pool_usd, { compact: true }) : null}
      viewerPosition={viewerPosition}
      pending={pending}
      unavailable={error}
      showPodium={pending || !!activeContest}
      onPeriodEnd={refreshAtPeriodEnd}
      explanation={{
        participation: "Make Play picks during the active competition. Only results from markets settled inside the configured competition window enter this ranking.",
        calculation: "Players are ranked by realized profit from settled Play positions. Open positions do not count. Ties are decided by wins, then settled picks, then wallet address.",
        context: activeContest
          ? {
              title: "Contest period",
              body: `This contest ends at ${new Date(activeContest.ends_at).toLocaleString()}. The countdown uses that administrator-configured end time.`,
            }
          : {
              title: "Contests",
              body: "Play contests are created manually by an administrator with their own start and end dates. No contest is active right now.",
            },
        rewards: rewardCopy(activeContest),
      }}
    />
  );
}
