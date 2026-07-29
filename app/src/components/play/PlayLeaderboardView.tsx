"use client";

// src/components/play/PlayLeaderboardView.tsx
//
// The Play face of /leaderboard: a competitive ladder — hero, top-three
// podium, "Your rank" card, full standings.
//
// It sits on the far side of an outer `isPlay ? … : …` branch in
// src/app/leaderboard/page.tsx, so the Real leaderboard is not merely hidden
// here: it is UNMOUNTED. No Real read runs in Play mode, and none of this
// component's state can survive a switch back to Real.
//
// WHAT IS RANKED — unchanged by this design pass
// ----------------------------------------------
// Authoritative REALIZED profit only: the sum of play_trades.realized_pnl_usd
// over settled rows, computed server-side in getPlayLeaderboard. An open
// position contributes nothing. This file reads that response and formats it;
// it computes no ranking, no P&L and no win rate of its own.
//
// COPY
// ----
// The UI says "Profit", not "realized PnL", and "Picks", not "settled grouped
// positions". The numbers behind those words are exactly the same ones the API
// returns — the plainer label describes the same quantity, it does not soften
// it. The hero's small print still states the one rule a player could
// otherwise get wrong: open positions do not count yet.
//
// WHAT THE PAGE SHOWS — the CONTEST, not All Time
// -----------------------------------------------
// Every number here belongs to one competition: the contest the admin
// configured, its prize ladder, and the ranking of results settled inside
// its window. Nothing on this page is hardcoded any more — the prize pool,
// the per-rank prizes, the period and the standings all come from
// /api/play/contest, so a contest edited in admin changes this page and no
// second source of truth exists to drift from it.
//
// The ranking has two sources and the API says which one it used:
//   `preview` — recalculated from settled trades in the window; may still
//               change, and the page says so.
//   `frozen`  — the immutable official snapshot; never recalculated.
//
// WHAT IS NOT HERE
// ----------------
// No SOL, no balance, no account id, no automatic-payout promise, no
// badges. Every card and row links to /profile/[wallet], which in Play mode
// already renders the public Play profile — so the mode carries across the
// navigation with no reload and no query parameter.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Medal, Trophy } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayContest } from "@/components/play/usePlayContest";
import {
  formatUsd,
  toCents,
  type PlayContestRowView,
  type PlayPublicContestView,
} from "@/lib/playClient";

/** Matches the cap the API applies — asking for more changes nothing. */
const LEADERBOARD_LIMIT = 100;

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                 */
/* -------------------------------------------------------------------------- */

function shortAddr(addr: string) {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** "+$4,699.98" / "-$2,000.00" / "$0.00". Sign is decided in exact cents. */
function formatProfit(v: string): string {
  const c = toCents(v);
  if (c === null) return "$0.00";
  const body = formatUsd(v);
  return c > BigInt(0) ? `+${body}` : body;
}

function profitToneClass(v: string): string {
  const c = toCents(v);
  if (c === null || c === BigInt(0)) return "text-gray-400";
  return c > BigInt(0) ? "text-pump-green" : "text-[#ff5c73]";
}

/** "0.6667" → "67%". Display only. */
function formatWinRate(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function hasUsername(row: PlayContestRowView): boolean {
  return !!row.username && row.username.trim().length > 0;
}

function displayName(row: PlayContestRowView): string {
  return hasUsername(row)
    ? (row.username as string).trim()
    : shortAddr(row.wallet_address);
}

function initialsOf(row: PlayContestRowView): string {
  return (row.username?.trim() || row.wallet_address).slice(0, 2).toUpperCase();
}

/* -------------------------------------------------------------------------- */
/*  Medals                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Restrained metal tints. Enough to read the top three at a glance, short of
 * the casino-gold treatment the rest of FunMarket deliberately avoids — the
 * page stays black-and-green, and the medals are accents on it.
 */
type MedalStyle = { chip: string; ring: string; glow: string; label: string };

const MEDALS: Record<1 | 2 | 3, MedalStyle> = {
  1: {
    chip: "border-[#f5c451]/45 bg-[#f5c451]/12 text-[#f5c451]",
    ring: "border-[#f5c451]/60",
    glow: "shadow-[0_0_40px_-12px_rgba(245,196,81,0.45)]",
    label: "text-[#f5c451]",
  },
  2: {
    chip: "border-[#cbd5e1]/35 bg-[#cbd5e1]/10 text-[#cbd5e1]",
    ring: "border-[#cbd5e1]/45",
    glow: "shadow-[0_0_30px_-14px_rgba(203,213,225,0.35)]",
    label: "text-[#cbd5e1]",
  },
  3: {
    chip: "border-[#cd7f32]/45 bg-[#cd7f32]/14 text-[#d08b45]",
    ring: "border-[#cd7f32]/50",
    glow: "shadow-[0_0_30px_-14px_rgba(205,127,50,0.35)]",
    label: "text-[#d08b45]",
  },
};

function medalFor(rank: number): MedalStyle | null {
  return rank === 1 || rank === 2 || rank === 3 ? MEDALS[rank] : null;
}

/* -------------------------------------------------------------------------- */
/*  Prizes — read from the contest, never declared here                        */
/* -------------------------------------------------------------------------- */

/**
 * PRIZE IS NOT PROFIT. Profit is the player's realized result on settled
 * markets — the metric the ranking is computed from. Prize is the cash reward
 * the CONTEST attaches to a final placing. They are rendered as separate
 * elements everywhere they appear together so the two can never be read as one
 * figure.
 *
 * Both now come from the same API response, so a prize shown here is the prize
 * the admin configured — there is no second copy of these numbers to drift.
 */

/** The raw prize decimal for a rank, or null when that rank pays nothing. */
function prizeAmountFor(
  contest: PlayPublicContestView | null,
  rank: number
): string | null {
  if (!contest) return null;
  const raw =
    rank === 1
      ? contest.first_prize_usd
      : rank === 2
        ? contest.second_prize_usd
        : rank === 3
          ? contest.third_prize_usd
          : null;
  if (raw == null) return null;
  // A zero prize is not a prize: a contest may pay only two places, or none.
  const c = toCents(raw);
  return c !== null && c > BigInt(0) ? raw : null;
}

/** "$15" / "$12.50" — trailing ".00" dropped, cents kept when they exist. */
function formatPrize(v: string): string {
  return formatUsd(v, { compact: true });
}

/* -------------------------------------------------------------------------- */
/*  Contest phase — one derivation, used by every piece of copy below          */
/* -------------------------------------------------------------------------- */

type Phase =
  | "upcoming"
  | "live"
  | "awaiting_review"
  | "under_review"
  | "verified"
  | "paid";

/**
 * The phase drives every conditional string on this page, so the banner, the
 * countdown, the disclaimer and the standings caption can never contradict
 * each other.
 *
 * Status comes from the server, which already reconciles it against the
 * clock. The one thing decided here is `upcoming` vs `live` for a contest
 * whose window flipped between the fetch and this render — a second's drift
 * that would otherwise show "starts in 00:00:00".
 */
function phaseOf(contest: PlayPublicContestView, nowMs: number): Phase {
  switch (contest.status) {
    case "under_review":
      return "under_review";
    case "verified":
      return "verified";
    case "paid":
      return "paid";
    case "ended":
      return "awaiting_review";
    default: {
      const starts = new Date(contest.starts_at).getTime();
      const ends = new Date(contest.ends_at).getTime();
      if (Number.isFinite(starts) && nowMs < starts) return "upcoming";
      if (Number.isFinite(ends) && nowMs >= ends) return "awaiting_review";
      return "live";
    }
  }
}

const PHASE_COPY: Record<
  Phase,
  { badge: string; note: string; tone: "green" | "amber" | "neutral" }
> = {
  upcoming: {
    badge: "Starting soon",
    note: "Standings open when the competition starts.",
    tone: "neutral",
  },
  live: {
    badge: "Live competition",
    note: "Results update as markets settle.",
    tone: "green",
  },
  awaiting_review: {
    badge: "Competition ended",
    note: "Results are awaiting review and may not yet be final.",
    tone: "amber",
  },
  under_review: {
    badge: "Results frozen",
    note: "Results frozen — verification in progress.",
    tone: "amber",
  },
  verified: {
    badge: "Official results",
    note: "These results have been verified.",
    tone: "green",
  },
  paid: {
    badge: "Official results",
    note: "Prizes recorded as paid.",
    tone: "green",
  },
};

/** A ranking is only worth showing once the competition has actually begun. */
function showsRanking(phase: Phase): boolean {
  return phase !== "upcoming";
}

/* -------------------------------------------------------------------------- */
/*  Time                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Timestamps are stored and compared in UTC; a visitor reads them in their
 * own zone. Eligibility is untouched by any of this — it is decided
 * server-side on settled_at.
 */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  } catch {
    return "local time";
  }
}

/** "29 Jul, 13:15" in the visitor's own zone. */
function formatLocal(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2d 04:11:09" / "04:11:09" until `iso`, or null once it has passed. */
function countdownTo(iso: string, nowMs: number): string | null {
  const ms = new Date(iso).getTime() - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(Math.floor((s % 86400) / 3600))}:${pad(
    Math.floor((s % 3600) / 60)
  )}:${pad(s % 60)}`;
  return d > 0 ? `${d}d ${clock}` : clock;
}

/** A 1s tick, but only while something on screen is actually counting down. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/* -------------------------------------------------------------------------- */
/*  Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

function Avatar({
  row,
  size,
  ringClass,
}: {
  row: PlayContestRowView;
  size: "sm" | "md" | "lg";
  ringClass?: string;
}) {
  const box =
    size === "lg"
      ? "h-16 w-16 text-lg md:h-20 md:w-20 md:text-xl"
      : size === "md"
        ? "h-11 w-11 text-xs md:h-14 md:w-14 md:text-sm"
        : "h-9 w-9 text-[11px]";
  return (
    <span
      className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-[#0e1116] font-bold text-white ${
        ringClass ?? "border-white/15"
      }`}
    >
      {row.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsOf(row)
      )}
    </span>
  );
}

/** Username primary + wallet secondary — and the wallet ALONE when unnamed. */
function Identity({
  row,
  align = "left",
  nameClass,
}: {
  row: PlayContestRowView;
  align?: "left" | "center";
  nameClass?: string;
}) {
  const named = hasUsername(row);
  return (
    <span className={`block min-w-0 ${align === "center" ? "text-center" : ""}`}>
      <span
        className={`block truncate font-semibold text-white ${nameClass ?? "text-sm"}`}
        title={displayName(row)}
      >
        {displayName(row)}
      </span>
      {named && (
        <span className="mt-0.5 block truncate font-mono text-[11px] text-gray-500">
          {shortAddr(row.wallet_address)}
        </span>
      )}
    </span>
  );
}

/** One "1,234 · Label" pair. The unit of every stat strip on this page. */
function Stat({
  value,
  label,
  valueClass,
  compact,
}: {
  value: string;
  label: string;
  valueClass?: string;
  /** For the narrow side-by-side podium cards — see the label note below. */
  compact?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-0.5">
      <span
        className={`max-w-full truncate text-sm font-bold tabular-nums ${
          valueClass ?? "text-white"
        }`}
      >
        {value}
      </span>
      {/* nowrap, because "Win rate" breaking onto two lines inside a podium
          card looks broken. It is the widest label by some way, so on a 320px
          screen — where a side card gives each stat ~35px — it is also dropped
          a point smaller, letting it bleed into the neighbouring column's
          slack instead of colliding with its text. */}
      <span
        className={`whitespace-nowrap uppercase tracking-wider text-gray-500 md:text-[10px] ${
          compact ? "text-[8px]" : "text-[9px]"
        }`}
      >
        {label}
      </span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Podium                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Top three, as cards rather than table rows.
 *
 * ONE CARD SIZE. All three use the same component with no size branch: same
 * padding, avatar, name block, profit type and stat strip. The hierarchy is
 * carried entirely by position, medal tint, border, glow and prize — never by
 * making the champion bigger. That also means the three cards are guaranteed
 * to measure identically at every breakpoint, rather than lining up by luck.
 *
 * Three layouts, one DOM order (rank order — the desktop arrangement is pure
 * CSS `order`, so the markup always reads #1, #2, #3):
 *
 *   < 360px   one column, stacked #1 · #2 · #3. Two columns at 320px leave
 *             ~138px per card, which is too narrow to read.
 *   ≥ 360px   two columns: #1 centred on the first row at exactly one column's
 *             width, #2 and #3 side by side beneath it. The narrowest case
 *             here is ~158px, which still holds the profit, the prize chip
 *             and the three stats.
 *   ≥ md      three columns, #2 · #1 · #3, with #1 lifted by a bottom margin
 *             against `items-end`.
 *
 * The lift is margin, not `translate-y`: the card already spends its transform
 * on `hover:-translate-y-0.5`, and a second translate would fight it and drop
 * the card on hover.
 */
function Podium({
  rows,
  ownWallet,
  contest,
}: {
  rows: PlayContestRowView[];
  ownWallet: string | null;
  contest: PlayPublicContestView | null;
}) {
  const top = rows.slice(0, 3);
  if (top.length === 0) return null;

  // With one or two players a three-column grid would leave a hole. Centre
  // what exists instead of rendering an empty column.
  const gridCols =
    top.length === 3
      ? "md:grid-cols-3"
      : top.length === 2
        ? "md:grid-cols-2 md:max-w-2xl md:mx-auto"
        : "md:grid-cols-1 md:max-w-sm md:mx-auto";

  const desktopOrder = ["md:order-2", "md:order-1", "md:order-3"];

  // The paired mobile row only makes sense for a full podium. With one or two
  // players it would strand an empty column, so those stay stacked until md.
  const full = top.length === 3;

  /**
   * #1 spans both mobile columns so it can be centred on its own row, but is
   * then held to EXACTLY one column's width — half the row minus half the
   * gap — so it measures the same as #2 and #3 rather than filling the row.
   * All of it is dropped at md, where the three-column grid sizes the cards.
   */
  const firstOnMobile = full
    ? "min-[360px]:col-span-2 min-[360px]:mx-auto " +
      "min-[360px]:w-[calc((100%-0.75rem)/2)] " +
      "md:mx-0 md:w-auto md:col-span-1"
    : "";

  // Stacked cards are capped and centred rather than run to the full width of
  // the page, which reads as a slab on a phone.
  const stackedWidth = full ? "" : "mx-auto w-full max-w-[400px] md:mx-0 md:max-w-none";

  return (
    <div
      className={`grid grid-cols-1 items-end gap-3 md:gap-4 ${
        full ? "min-[360px]:grid-cols-2" : ""
      } ${gridCols}`}
    >
      {top.map((row, i) => (
        <PodiumCard
          key={row.wallet_address}
          row={row}
          contest={contest}
          isOwn={!!ownWallet && row.wallet_address === ownWallet}
          layoutClass={[
            row.rank === 1 ? firstOnMobile : "",
            stackedWidth,
            // Only the full three-up podium lifts its champion; with one or
            // two players there is no row for it to rise out of.
            row.rank === 1 && full ? "md:mb-6" : "",
            full ? desktopOrder[i] : "",
          ]
            .filter(Boolean)
            .join(" ")}
        />
      ))}
    </div>
  );
}

function PodiumCard({
  row,
  layoutClass,
  isOwn,
  contest,
}: {
  row: PlayContestRowView;
  layoutClass: string;
  isOwn: boolean;
  contest: PlayPublicContestView | null;
}) {
  const medal = medalFor(row.rank);
  const prize = prizeAmountFor(contest, row.rank);

  return (
    <Link
      href={`/profile/${row.wallet_address}`}
      className={`group relative flex flex-col items-center rounded-2xl border bg-[#0c0e12] px-3 py-5 transition
        hover:-translate-y-0.5 hover:border-white/20 hover:bg-[#101319]
        md:px-4 md:py-6
        ${isOwn ? "border-pump-green/40" : "border-white/10"}
        ${medal?.glow ?? ""} ${layoutClass}`}
    >
      {/* Rank chip, straddling the top edge */}
      <span
        className={`absolute -top-3 inline-flex h-7 items-center justify-center rounded-full border px-3 text-xs font-extrabold tabular-nums
          ${medal?.chip ?? "border-white/15 bg-[#0c0e12] text-gray-400"}`}
      >
        #{row.rank}
      </span>

      <Avatar row={row} size="md" ringClass={medal?.ring} />

      {/* Fixed height so a named player and an unnamed one produce the same
          card — without it the second (wallet) line would make one card taller
          than its neighbour and the podium would sit crooked. */}
      <div className="mt-3 flex min-h-[2.75rem] w-full items-start justify-center">
        <Identity row={row} align="center" nameClass="text-sm" />
      </div>

      {/* PROFIT — the player's own result, from the API. */}
      <div
        className={`mt-2 max-w-full truncate text-lg font-extrabold tabular-nums md:text-xl ${profitToneClass(
          row.realized_pnl_usd
        )}`}
      >
        {formatProfit(row.realized_pnl_usd)}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500">
        Profit
      </div>

      {/* PRIZE — a separate thing entirely: the cash reward for finishing the
          week in this position. Deliberately a bordered chip in the medal tint
          rather than more plain numerals, so it can never be misread as part
          of the profit figure directly above it. */}
      {prize && (
        <span
          className={`mt-3 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold tabular-nums
            ${medal?.chip ?? "border-white/15 text-gray-300"}`}
        >
          <Medal className="h-3 w-3" aria-hidden />
          {formatPrize(prize)} Prize
        </span>
      )}

      <div className="mt-4 grid w-full grid-cols-3 gap-1 border-t border-white/[0.06] pt-3">
        <Stat value={String(row.wins)} label="Wins" compact />
        <Stat value={String(row.settled_picks)} label="Picks" compact />
        <Stat value={formatWinRate(row.win_rate)} label="Win rate" compact />
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Prize pool                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The contest's prize ladder and period, stated once above the podium.
 *
 * EVERY value here comes from the contest. A rank that pays nothing renders no
 * chip at all, so a two-place contest shows two chips rather than a "$0" third.
 *
 * The disclaimer is deliberately plain: it says prizes follow a verification
 * step and stops there, promising no automatic or on-chain payout, because no
 * such mechanism exists in this codebase.
 */
function PrizePool({
  contest,
  phase,
  nowMs,
}: {
  contest: PlayPublicContestView;
  phase: Phase;
  nowMs: number;
}) {
  const ranks = ([1, 2, 3] as const)
    .map((rank) => ({ rank, amount: prizeAmountFor(contest, rank) }))
    .filter((r): r is { rank: 1 | 2 | 3; amount: string } => r.amount !== null);

  const copy = PHASE_COPY[phase];
  const target = phase === "upcoming" ? contest.starts_at : contest.ends_at;
  const countdown = countdownTo(target, nowMs);

  const toneClass =
    copy.tone === "green"
      ? "border-pump-green/25 bg-pump-green/[0.08] text-pump-green"
      : copy.tone === "amber"
        ? "border-[#f5c451]/30 bg-[#f5c451]/[0.08] text-[#f5c451]"
        : "border-white/15 bg-white/[0.04] text-gray-300";

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0c0e12] px-4 py-4 md:px-5">
      <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${toneClass}`}
            >
              {copy.badge}
            </span>
            <span className="truncate text-[11px] font-medium text-gray-400">
              {contest.name}
            </span>
          </div>

          <div className="mt-1.5 flex items-center justify-center gap-2 sm:justify-start">
            <Trophy className="h-4 w-4 text-pump-green" aria-hidden />
            <span className="text-lg font-extrabold tabular-nums text-white">
              {formatPrize(contest.prize_pool_usd)} prize pool
            </span>
          </div>
        </div>

        {ranks.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {ranks.map(({ rank, amount }) => (
              <span
                key={rank}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums ${MEDALS[rank].chip}`}
              >
                <Medal className="h-3.5 w-3.5" aria-hidden />
                {rank === 1 ? "1st" : rank === 2 ? "2nd" : "3rd"}{" "}
                {formatPrize(amount)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Period + countdown. Times are stored in UTC and rendered in the
          visitor's own zone, with the zone named so it is never ambiguous. */}
      <div className="mt-3 flex flex-col items-center gap-1 border-t border-white/[0.06] pt-3 sm:flex-row sm:justify-between">
        <span className="text-[11px] tabular-nums text-gray-500">
          {formatLocal(contest.starts_at)} → {formatLocal(contest.ends_at)}{" "}
          <span className="text-gray-600">({browserTimeZone()})</span>
        </span>

        {countdown && (
          <span className="text-[11px] font-semibold tabular-nums text-gray-300">
            {phase === "upcoming" ? "Competition starts in " : "Ends in "}
            <span className={copy.tone === "green" ? "text-pump-green" : "text-white"}>
              {countdown}
            </span>
          </span>
        )}
      </div>

      <p className="mt-3 border-t border-white/[0.06] pt-3 text-center text-[11px] leading-relaxed text-gray-500 sm:text-left">
        {copy.note} Prizes are awarded after results are verified.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Standings                                                                  */
/* -------------------------------------------------------------------------- */

const GRID =
  "grid-cols-[2.5rem_minmax(0,1fr)_7rem_3.5rem_3.5rem_4.5rem] gap-3";

function StandingsHeader() {
  return (
    <div
      className={`hidden ${GRID} items-center border-b border-white/[0.07] px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-gray-500 md:grid`}
    >
      <span>Rank</span>
      <span>Player</span>
      <span className="text-right">Profit</span>
      {/* Same word the Play profile uses, counted over SETTLED positions here
          because that is what the ranking is built from. */}
      <span className="text-right" title="Settled picks (market + outcome)">
        Picks
      </span>
      <span className="text-right">Wins</span>
      <span className="text-right" title="Wins ÷ (wins + losses). Refunds excluded.">
        Win rate
      </span>
    </div>
  );
}

/**
 * One player. A single <Link> per row — never a link inside a link — so the
 * whole row is clickable on both breakpoints with no nested-anchor warning.
 */
function StandingsRow({
  row,
  isOwn,
}: {
  row: PlayContestRowView;
  isOwn: boolean;
}) {
  const medal = medalFor(row.rank);

  return (
    <Link
      href={`/profile/${row.wallet_address}`}
      className={`group block border-b border-white/[0.05] px-4 transition last:border-0
        hover:bg-white/[0.035] ${isOwn ? "bg-pump-green/[0.07]" : ""}`}
    >
      {/* Desktop / tablet */}
      <div className={`hidden ${GRID} items-center py-3 md:grid`}>
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold tabular-nums
            ${medal?.chip ?? "border-white/10 bg-white/[0.03] text-gray-400"}`}
        >
          {row.rank}
        </span>

        <span className="flex min-w-0 items-center gap-3">
          <Avatar row={row} size="sm" ringClass={medal?.ring} />
          <Identity row={row} />
        </span>

        <span
          className={`text-right text-sm font-bold tabular-nums ${profitToneClass(
            row.realized_pnl_usd
          )}`}
        >
          {formatProfit(row.realized_pnl_usd)}
        </span>
        <span className="text-right text-sm tabular-nums text-white/80">
          {row.settled_picks}
        </span>
        <span className="text-right text-sm tabular-nums text-white/80">
          {row.wins}
        </span>
        <span className="text-right text-sm tabular-nums text-gray-400">
          {formatWinRate(row.win_rate)}
        </span>
      </div>

      {/* Mobile: rank + player + profit on line one, stats on line two */}
      <div className="py-3 md:hidden">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-bold tabular-nums
              ${medal?.chip ?? "border-white/10 bg-white/[0.03] text-gray-400"}`}
          >
            {row.rank}
          </span>
          <Avatar row={row} size="sm" ringClass={medal?.ring} />
          <span className="min-w-0 flex-1">
            <Identity row={row} />
          </span>
          <span
            className={`shrink-0 text-sm font-bold tabular-nums ${profitToneClass(
              row.realized_pnl_usd
            )}`}
          >
            {formatProfit(row.realized_pnl_usd)}
          </span>
        </div>
        <div className="mt-1.5 pl-[4.75rem] text-[11px] text-gray-500">
          {row.wins} {row.wins === 1 ? "win" : "wins"} · {row.settled_picks}{" "}
          {row.settled_picks === 1 ? "pick" : "picks"} · {formatWinRate(row.win_rate)} win
          rate
        </div>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Your rank                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The player's own standing. `viewer` is produced server-side from the Play
 * session cookie, so this card appears only for a signed-in player who has a
 * ranked result — never for a wallet a visitor merely typed. It carries the
 * same public stats as any other row and NEVER a balance.
 */
function YourRankCard({
  viewer,
  frozen,
}: {
  viewer: PlayContestRowView | null;
  /** True when the ranking is the official snapshot, not a live preview. */
  frozen: boolean;
}) {
  if (!viewer) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#0c0e12] px-5 py-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
          Your rank
        </div>
        <p className="mt-1.5 text-sm font-semibold text-white">
          You&apos;re not ranked in this competition yet.
        </p>
        <p className="mt-0.5 text-xs text-gray-400">
          {frozen
            ? "You're not in the official results for this competition."
            : "Settle a Play market during the competition window to enter."}
        </p>
      </div>
    );
  }

  const medal = medalFor(viewer.rank);

  return (
    <Link
      href={`/profile/${viewer.wallet_address}`}
      className="block rounded-2xl border border-pump-green/30 bg-pump-green/[0.04] px-5 py-4 transition hover:border-pump-green/50 hover:bg-pump-green/[0.07]"
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-pump-green/80">
        Your rank
      </div>

      {/* Stacks on mobile — rank + identity, then the stat strip — so a long
          name never has to fight three numbers for the same 375px row. */}
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={`shrink-0 text-2xl font-extrabold tabular-nums ${
              medal?.label ?? "text-white"
            }`}
          >
            #{viewer.rank}
          </span>
          <Avatar row={viewer} size="sm" ringClass={medal?.ring} />
          <Identity row={viewer} />
        </span>

        <span className="flex shrink-0 items-center justify-between gap-4 border-t border-white/[0.06] pt-3 sm:justify-end sm:gap-6 sm:border-0 sm:pt-0">
          <Stat
            value={formatProfit(viewer.realized_pnl_usd)}
            label="Profit"
            valueClass={profitToneClass(viewer.realized_pnl_usd)}
          />
          <Stat value={String(viewer.wins)} label="Wins" />
          <Stat value={String(viewer.settled_picks)} label="Picks" />
        </span>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  View                                                                       */
/* -------------------------------------------------------------------------- */

export default function PlayLeaderboardView() {
  const { data, error, pending, refresh } = usePlayContest({
    limit: LEADERBOARD_LIMIT,
  });
  const { publicKey, connected } = useWallet();
  const connectedWallet = connected && publicKey ? publicKey.toBase58() : null;

  const contest = data?.contest ?? null;
  const rows = data?.ranking ?? [];
  const viewer = data?.viewer ?? null;
  const totalPlayers = data?.meta.total_players ?? 0;
  const frozen = data?.meta.ranking_state === "frozen";

  // Tick only while a countdown is on screen — an upcoming or running
  // competition. A frozen result has nothing to count down to.
  const phaseForTick = contest ? contest.status : null;
  const now = useNow(
    phaseForTick === "draft" || phaseForTick === "live"
  );

  const phase = contest ? phaseOf(contest, now) : null;

  // "Me" is the wallet the server proved from the Play session cookie. The
  // connected wallet is only the fallback for highlighting when there is no
  // Play session yet — it can never produce a `viewer` card on its own,
  // because that comes from the server or not at all.
  const ownWallet = viewer?.wallet_address ?? connectedWallet;

  const hasRows = rows.length > 0;
  const ranked = !!phase && showsRanking(phase);

  // The podium already IS the ranking for the first three, so the standings
  // list carries on from #4 rather than reprinting them. With three players or
  // fewer the podium is the whole ladder and no table renders at all.
  const standings = rows.slice(3);

  return (
    <div className="min-h-screen bg-black">
      {/* Ambient green wash behind the hero — the same accent the rest of Play
          uses, kept to a single soft band rather than a full gradient sheet. */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-pump-green/[0.09] via-pump-green/[0.02] to-transparent"
        />

        <div className="relative mx-auto w-full max-w-5xl px-4 pb-16 pt-8 md:pt-12">
          {/* HERO */}
          <header className="text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-pump-green/25 bg-pump-green/[0.08] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-pump-green">
                <Trophy className="h-3.5 w-3.5" />
                Free-to-play competition
              </span>
              {/* Scale of the field, so the count never depends on the
                  standings table existing. */}
              {ranked && totalPlayers > 0 && (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
                  {totalPlayers.toLocaleString()}{" "}
                  {totalPlayers === 1 ? "player" : "players"}
                </span>
              )}
            </div>

            <h1 className="mt-4 text-3xl font-extrabold uppercase leading-none tracking-tight text-white md:text-5xl">
              Play leaderboard
            </h1>

            <p className="mt-3 text-base font-semibold text-white/90 md:text-lg">
              Play for free. Climb the leaderboard. Win real prizes.
            </p>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-gray-400">
              Make your picks, earn profit on settled markets, and finish the
              competition on top.
            </p>
            <p className="mt-2 text-[11px] text-gray-600">
              Open positions do not count until the market settles.
            </p>
          </header>

          {/* BODY */}
          <div className="mt-10 md:mt-12">
            {error ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#0c0e12] px-5 py-16 text-center">
                <p className="text-sm text-gray-400">
                  Couldn&apos;t load the leaderboard.
                </p>
                <button
                  onClick={refresh}
                  className="rounded-full border border-white/15 px-4 py-1.5 text-xs font-semibold text-gray-200 transition hover:border-pump-green/60 hover:text-pump-green"
                >
                  Retry
                </button>
              </div>
            ) : pending ? (
              <div className="space-y-8">
                {/* Podium skeleton — same three-up rhythm as the real thing */}
                <div className="flex flex-col gap-3 md:grid md:grid-cols-3 md:items-end md:gap-4">
                  <div className="h-[232px] animate-pulse rounded-2xl border border-white/10 bg-[#0c0e12] md:order-1" />
                  <div className="h-[272px] animate-pulse rounded-2xl border border-white/10 bg-[#0c0e12] md:order-2" />
                  <div className="h-[232px] animate-pulse rounded-2xl border border-white/10 bg-[#0c0e12] md:order-3" />
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c0e12]">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-[58px] animate-pulse border-b border-white/[0.05] last:border-0"
                    />
                  ))}
                </div>
              </div>
            ) : !contest || !phase ? (
              /* NO CONTEST. Deliberately shows no prize ladder and no
                 ranking: there is no competition to advertise, and the
                 old hardcoded $50 week must never stand in for one. */
              <div className="rounded-2xl border border-white/10 bg-[#0c0e12] px-5 py-16 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                  <Trophy className="h-7 w-7 text-gray-500" />
                </div>
                <h2 className="text-lg font-bold text-white">
                  No Play competition is currently scheduled.
                </h2>
                <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-gray-400">
                  Play markets are still open — results from your picks will
                  count towards the next competition.
                </p>
                <Link
                  href="/"
                  className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-pump-green px-6 text-sm font-bold text-black transition hover:bg-pump-green/90"
                >
                  Browse markets
                </Link>
              </div>
            ) : (
              <div className="space-y-8">
                {/* Prizes and period always render once a contest exists —
                    including before it starts, which is the whole point of
                    an upcoming state. */}
                <PrizePool contest={contest} phase={phase} nowMs={now} />

                {!ranked ? (
                  /* UPCOMING. No ranking at all rather than an empty
                     podium: nothing settled inside the window yet, so any
                     standings shown here would be misleading. */
                  <div className="rounded-2xl border border-white/10 bg-[#0c0e12] px-5 py-14 text-center">
                    <h2 className="text-lg font-bold text-white">
                      The competition hasn&apos;t started yet.
                    </h2>
                    <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-gray-400">
                      Standings open at{" "}
                      <span className="tabular-nums text-gray-300">
                        {formatLocal(contest.starts_at)}
                      </span>
                      . Only markets that settle inside the competition window
                      count.
                    </p>
                    <Link
                      href="/"
                      className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-pump-green px-6 text-sm font-bold text-black transition hover:bg-pump-green/90"
                    >
                      Browse markets
                    </Link>
                  </div>
                ) : !hasRows ? (
                  <div className="rounded-2xl border border-white/10 bg-[#0c0e12] px-5 py-14 text-center">
                    <h2 className="text-lg font-bold text-white">
                      No settled results in this competition yet.
                    </h2>
                    <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-gray-400">
                      Finish a Play market before the competition ends to claim
                      the first spot.
                    </p>
                    <Link
                      href="/"
                      className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-pump-green px-6 text-sm font-bold text-black transition hover:bg-pump-green/90"
                    >
                      Browse markets
                    </Link>
                  </div>
                ) : (
                  <>
                    <Podium
                      rows={rows}
                      ownWallet={ownWallet}
                      contest={contest}
                    />

                    <YourRankCard viewer={viewer} frozen={frozen} />

                    {standings.length > 0 && (
                      <section>
                        <div className="mb-3 flex items-baseline justify-between gap-3">
                          <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                            Top players
                          </h2>
                          {totalPlayers > rows.length && (
                            <span className="text-[11px] tabular-nums text-gray-500">
                              Top {rows.length} of{" "}
                              {totalPlayers.toLocaleString()}
                            </span>
                          )}
                        </div>

                        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c0e12]">
                          <StandingsHeader />
                          {standings.map((row) => (
                            <StandingsRow
                              key={row.wallet_address}
                              row={row}
                              isOwn={
                                !!ownWallet && row.wallet_address === ownWallet
                              }
                            />
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
