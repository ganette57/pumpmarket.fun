"use client";

// src/app/treasury/page.tsx
//
// The public transparency page for the ROAD TO $100M.
//
// WHAT THIS PAGE USED TO BE
// -------------------------
// A "Championship" page with a $150,000 prize pool that did not exist, a
// Fun Points ranking that is no longer surfaced anywhere, its own 12-rung
// milestone ladder, and SOL priced at a hardcoded $150. It summed a
// different volume column from the leaderboard and applied no
// cluster/program gating, so the two pages named different next
// milestones and differed on the dollar figure by roughly 2x.
//
// WHAT IT IS NOW
// --------------
// The same numbers as /leaderboard, from the same computation. Every
// figure below arrives from /api/real/road, which delegates to
// getRealLeaderboard + computeRoadProgress — the identical path the
// leaderboard uses. Milestones and the reward split are read from
// realRoad.ts; NOTHING on this page is written down a second time, so the
// two surfaces cannot drift.
//
// WHAT IT DOES NOT CLAIM
// ----------------------
// No treasury balance, no locked funds, no guaranteed payout, no
// automatic on-chain distribution, no committed revenue percentage. Every
// reward figure is a planned maximum, said once.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Trophy, TrendingUp, ShieldCheck, Medal } from "lucide-react";
import { ROAD_MILESTONES } from "@/lib/realRoad";

/* -------------------------------------------------------------------------- */
/*  Types (mirror /api/real/road)                                              */
/* -------------------------------------------------------------------------- */

type RoadResponse = {
  road: {
    total_real_volume_sol: string;
    total_real_volume_usd: number | null;
    previous_milestone_usd: number | null;
    next_milestone_usd: number | null;
    next_reward_usd: number | null;
    milestone_progress: number | null;
    unlocked_rewards_usd: number | null;
    final_goal_usd: number;
    maximum_rewards_usd: number;
    rewards_distributed_usd: number;
    reward_breakdown: {
      milestone_usd: number;
      total_reward_usd: number;
      rewarded_traders: number;
      first_usd: number;
      second_usd: number;
      third_usd: number;
      remaining_from_rank: number;
      remaining_to_rank: number;
      remaining_pool_usd: number;
    } | null;
    price_timestamp: string | null;
  };
  cluster: string;
  is_test_data: boolean;
  sol_usd: { usd: number; as_of: string } | null;
};

/* -------------------------------------------------------------------------- */
/*  Formatting — same conventions as the Real leaderboard                      */
/* -------------------------------------------------------------------------- */

function formatUsdWhole(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function solNumber(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatSolAmount(v: string): string {
  return `${solNumber(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} SOL`;
}

function ordinal(n: number): string {
  const abs = Math.abs(Math.round(n));
  const tens = abs % 100;
  if (tens >= 11 && tens <= 13) return `${abs}th`;
  const ones = abs % 10;
  return `${abs}${ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* -------------------------------------------------------------------------- */
/*  Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function Fact({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string | null;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div
        className={`mt-0.5 text-sm font-bold tabular-nums ${
          accent ? "text-pump-green" : "text-white"
        }`}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px] tabular-nums text-gray-500">{sub}</div>
      ) : null}
    </div>
  );
}

/** The eight-stop ladder, identical in behaviour to the leaderboard's. */
function MilestoneTrack({ currentUsd }: { currentUsd: number | null }) {
  return (
    <div className="mt-4 -mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-max items-center gap-1.5">
        {ROAD_MILESTONES.map((m) => {
          const reached = currentUsd != null && currentUsd >= m.volume_usd;
          const isNext =
            currentUsd != null &&
            !reached &&
            ROAD_MILESTONES.findIndex((x) => currentUsd < x.volume_usd) ===
              ROAD_MILESTONES.indexOf(m);
          return (
            <li
              key={m.volume_usd}
              title={`${m.label} volume → up to ${formatUsdWhole(
                m.rewards_usd
              )} in community rewards`}
              className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold tabular-nums transition ${
                reached
                  ? "border-pump-green/45 bg-pump-green/12 text-pump-green"
                  : isNext
                    ? "border-white/35 bg-white/[0.07] text-white"
                    : "border-white/10 text-gray-600"
              }`}
            >
              {reached ? "✓ " : ""}
              {m.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function HowItWorksStep({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-pump-green/35 bg-pump-green/[0.08] text-[11px] font-bold tabular-nums text-pump-green">
        {n}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-gray-400">
          {body}
        </span>
      </span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function TreasuryPage() {
  const [data, setData] = useState<RoadResponse | null>(null);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/real/road", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json || json.error) throw new Error("failed");
        setData(json as RoadResponse);
        setError(false);
      } catch {
        if (cancelled) return;
        setData(null);
        setError(true);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const road = data?.road ?? null;
  const usd = road?.total_real_volume_usd ?? null;
  const breakdown = road?.reward_breakdown ?? null;
  const pct = road?.milestone_progress != null ? road.milestone_progress * 100 : null;
  const nextLabel =
    ROAD_MILESTONES.find((m) => m.volume_usd === road?.next_milestone_usd)?.label ??
    (road?.next_milestone_usd != null ? formatUsdWhole(road.next_milestone_usd) : null);

  return (
    <div className="min-h-screen bg-black">
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-pump-green/[0.09] via-pump-green/[0.02] to-transparent"
        />

        <div className="relative mx-auto w-full max-w-4xl px-4 pb-16 pt-8 md:pt-12">
          {/* HERO */}
          <header className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-pump-green/25 bg-pump-green/[0.08] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-pump-green">
              <Trophy className="h-3.5 w-3.5" />
              Community rewards
            </span>

            <h1 className="mt-4 text-3xl font-extrabold uppercase leading-none tracking-tight text-white md:text-5xl">
              Road to $100M
            </h1>

            <p className="mt-3 text-base font-semibold text-white/90 md:text-lg">
              Every eligible Real trade moves the community toward the next reward
              milestone.
            </p>
            <p className="mx-auto mt-1.5 max-w-lg text-sm leading-relaxed text-gray-400">
              Follow verified Real trading volume, milestone progress and planned
              community rewards.
            </p>
          </header>

          {/* Same gate, same banner as the leaderboard. */}
          {data?.is_test_data && (
            <div className="mt-6 rounded-xl border border-[#f5c451]/40 bg-[#f5c451]/[0.08] px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-[#f5c451]">
              Devnet test data — not real trading results
            </div>
          )}

          <div className="mt-8 space-y-6 md:mt-10">
            {error ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[#0c0e12] px-5 py-16 text-center">
                <p className="text-sm text-gray-400">
                  Couldn&apos;t load Road progress.
                </p>
                <button
                  onClick={refresh}
                  className="rounded-full border border-white/15 px-4 py-1.5 text-xs font-semibold text-gray-200 transition hover:border-pump-green/60 hover:text-pump-green"
                >
                  Retry
                </button>
              </div>
            ) : !loaded || !road ? (
              <div className="space-y-6">
                <div className="h-[220px] animate-pulse rounded-2xl border border-white/10 bg-[#0c0e12]" />
                <div className="h-[160px] animate-pulse rounded-2xl border border-white/10 bg-[#0c0e12]" />
              </div>
            ) : (
              <>
                {/* ---- PROGRESS SUMMARY ---- */}
                <section className="rounded-2xl border border-white/10 bg-[#0c0e12] px-4 py-4 md:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                        Verified Real volume
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-pump-green" aria-hidden />
                        <span className="text-2xl font-extrabold tabular-nums text-white">
                          {formatSolAmount(road.total_real_volume_sol)}
                        </span>
                      </div>
                      {usd != null && (
                        <div className="mt-0.5 text-[12px] tabular-nums text-gray-400">
                          ≈ {formatUsdWhole(usd)}
                        </div>
                      )}
                    </div>

                    <div className="text-left sm:text-right">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                        Final goal
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-white">
                        Up to {formatUsdWhole(road.maximum_rewards_usd)} in community
                        rewards
                      </div>
                      <div className="text-[11px] tabular-nums text-gray-500">
                        at {formatUsdWhole(road.final_goal_usd)} volume
                      </div>
                    </div>
                  </div>

                  {usd != null && road.next_milestone_usd != null ? (
                    <>
                      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <Fact
                          label="Next reward milestone"
                          value={`${formatUsdWhole(
                            road.next_milestone_usd
                          )} verified Real volume`}
                        />
                        <Fact
                          label="Milestone reward pool"
                          value={`Up to ${formatUsdWhole(
                            road.next_reward_usd ?? 0
                          )} total`}
                          accent
                        />
                        <Fact
                          label="Rewarded traders"
                          value={
                            breakdown
                              ? `Top ${breakdown.rewarded_traders}`
                              : "To be confirmed"
                          }
                        />
                      </dl>

                      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-pump-green transition-[width] duration-700"
                          style={{ width: `${Math.max(pct ?? 0, 0.5)}%` }}
                        />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-[11px] font-semibold tabular-nums text-pump-green">
                          {pct != null && pct < 0.01 ? "<0.01" : (pct ?? 0).toFixed(2)}%
                          to the next milestone
                        </span>
                        <span className="text-[11px] tabular-nums text-gray-500">
                          {formatUsdWhole(usd)} /{" "}
                          {formatUsdWhole(road.next_milestone_usd)}
                        </span>
                      </div>
                    </>
                  ) : usd != null ? (
                    <p className="mt-4 rounded-lg border border-pump-green/25 bg-pump-green/[0.06] px-3 py-2 text-[11px] text-pump-green">
                      The community has reached the{" "}
                      {formatUsdWhole(road.final_goal_usd)} volume goal.
                    </p>
                  ) : (
                    <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-gray-400">
                      USD milestone progress is temporarily unavailable. Volume above
                      is authoritative and is measured in SOL.
                    </p>
                  )}

                  {breakdown && nextLabel && (
                    <p className="mt-3 text-[12px] font-medium leading-relaxed text-gray-300">
                      Reach {nextLabel} in verified Real volume to unlock up to{" "}
                      {formatUsdWhole(breakdown.total_reward_usd)} in rewards for the
                      Top {breakdown.rewarded_traders} traders.
                    </p>
                  )}

                  <MilestoneTrack currentUsd={usd} />

                  {road.price_timestamp && (
                    <p className="mt-2 text-[10px] text-gray-600">
                      USD equivalent based on the current SOL price ·{" "}
                      {formatWhen(road.price_timestamp)}
                    </p>
                  )}

                  {/* The ONE disclaimer on this page. */}
                  <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] leading-relaxed text-gray-600">
                    Reward amounts shown are planned maximums and remain subject to
                    volume verification, eligibility checks, anti-fraud review and the
                    published snapshot terms.
                  </p>
                </section>

                {/* ---- PLANNED MILESTONE DISTRIBUTION ---- */}
                <section className="rounded-2xl border border-white/10 bg-[#0c0e12] px-4 py-4 md:px-5">
                  <h2 className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Planned milestone distribution
                  </h2>

                  {breakdown ? (
                    <>
                      {/* Read from the shared config — no amount is written
                          down here, so this can never disagree with the
                          podium badges on /leaderboard. */}
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          { place: "1st place", amount: breakdown.first_usd },
                          { place: "2nd place", amount: breakdown.second_usd },
                          { place: "3rd place", amount: breakdown.third_usd },
                        ].map((r) => (
                          <div
                            key={r.place}
                            className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5"
                          >
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400">
                              <Medal className="h-3 w-3 shrink-0" aria-hidden />
                              {r.place}
                            </div>
                            <div className="mt-1 text-sm font-bold tabular-nums text-white">
                              Up to {formatUsdWhole(r.amount)}
                            </div>
                          </div>
                        ))}
                        <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                          <div className="text-[11px] font-semibold text-gray-400">
                            {ordinal(breakdown.remaining_from_rank)}–
                            {ordinal(breakdown.remaining_to_rank)} place
                          </div>
                          <div className="mt-1 text-sm font-bold tabular-nums text-white">
                            Share up to {formatUsdWhole(breakdown.remaining_pool_usd)}
                          </div>
                        </div>
                      </div>

                      <p className="mt-3 text-[11px] text-gray-500">
                        The detailed payout amounts will be confirmed before the
                        milestone snapshot.
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[12px] font-medium text-gray-300">
                      Reward breakdown will be published before the snapshot.
                    </p>
                  )}
                </section>

                {/* ---- HOW IT WORKS ---- */}
                <section className="rounded-2xl border border-white/10 bg-[#0c0e12] px-4 py-4 md:px-5">
                  <h2 className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    How it works
                  </h2>
                  <ol className="mt-3 grid gap-4 sm:grid-cols-2">
                    <HowItWorksStep
                      n={1}
                      title="Trade Real markets"
                      body="Eligible Real buy volume moves the community Road forward."
                    />
                    <HowItWorksStep
                      n={2}
                      title="Reach a milestone"
                      body="Each verified volume milestone unlocks a planned maximum community reward pool."
                    />
                    <HowItWorksStep
                      n={3}
                      title="Rank by Claimed Profit"
                      body="Trader rankings are based on claimed profit from settled Real markets."
                    />
                    <HowItWorksStep
                      n={4}
                      title="Verify and distribute"
                      body="Results are reviewed for eligibility, anti-fraud and snapshot compliance before rewards are recorded."
                    />
                  </ol>

                  <Link
                    href="/leaderboard"
                    className="mt-4 inline-flex h-9 items-center justify-center rounded-full border border-white/15 px-4 text-xs font-semibold text-gray-200 transition hover:border-pump-green/60 hover:text-pump-green"
                  >
                    View the leaderboard
                  </Link>
                </section>

                {/* ---- TRANSPARENCY + PLAY SEPARATION ---- */}
                <section className="rounded-2xl border border-white/10 bg-[#0c0e12] px-4 py-4 md:px-5">
                  <h2 className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-pump-green" aria-hidden />
                    Transparency
                  </h2>
                  <ul className="mt-3 space-y-2 text-[12px] leading-relaxed text-gray-400">
                    <li>
                      FunMarket may allocate platform revenue and other campaign
                      funding toward verified milestone rewards.
                    </li>
                    <li>
                      Published reward amounts are planned maximums, not guaranteed
                      balances already held in treasury.
                    </li>
                    <li>
                      Milestone results and recorded distributions will be published
                      after verification.
                    </li>
                  </ul>

                  <p className="mt-3 border-t border-white/[0.06] pt-3 text-[12px] leading-relaxed text-gray-500">
                    Play competitions are separate free-to-play events with their own
                    periods and prize pools. Play activity does not count toward the
                    Real Road to $100M volume.
                  </p>
                </section>

                {/* ---- REWARDS DISTRIBUTED ---- */}
                <section className="rounded-2xl border border-white/10 bg-[#0c0e12] px-4 py-4 md:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div>
                      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                        Rewards distributed
                      </div>
                      <div className="mt-0.5 text-2xl font-extrabold tabular-nums text-white">
                        {formatUsdWhole(road.rewards_distributed_usd)}
                      </div>
                    </div>
                    <p className="max-w-sm text-[11px] leading-relaxed text-gray-500">
                      Verified milestone results will appear here after the first
                      distribution.
                    </p>
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
