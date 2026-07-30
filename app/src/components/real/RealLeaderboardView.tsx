"use client";

// src/components/real/RealLeaderboardView.tsx
//
// The Real face of /leaderboard: ROAD TO $1M.
//
// It sits on the far side of the `isPlay ? … : …` branch in
// LeaderboardByMode, so in Play mode this is UNMOUNTED — no Real request
// runs and no Real row can linger. Nothing here reads Play data.
//
// WHAT IS RANKED — and why it is not called "realized PnL"
// -------------------------------------------------------
// CLAIMED PROFIT: completed cash flows only. Claims, refunds and sell
// proceeds, minus gross buy cost including the fees the user paid. A
// winning position that has not been claimed cannot be valued off-chain
// (the payout depends on the market account's live balance and on claim
// ordering), so it is EXCLUDED until the claim is recorded rather than
// estimated or counted as zero. The page says so in plain sight — twice —
// because a metric that quietly omits unclaimed winners would otherwise
// read as a complete ranking.
//
// ACCOUNTING UNIT IS SOL
// ----------------------
// Ranking, sorting and every stored figure are SOL. The dollar amounts are
// display only, converted server-side at the current price, and they
// disappear entirely — along with the progress bar — when no defensible
// price exists. No historical trade is ever re-priced.
//
// The visual system is the validated Play podium: equal-size cards,
// #2 · #1 · #3 on desktop, #1 above the pair on mobile, restrained metal
// tints on black. The identity is Real's own.

import { useMemo } from "react";
import Link from "next/link";
import { Medal, Trophy } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  useRealLeaderboard,
  type RealLeaderboardRowView,
} from "@/components/real/useRealLeaderboard";

/** Matches the cap the API applies — asking for more changes nothing. */
const LEADERBOARD_LIMIT = 100;

/** The milestone the road counts towards. A target, never a promise. */
const ROAD_TARGET_USD = 1_000_000;

/**
 * Optional snapshot schedule. Configuration-driven so a ranking deadline
 * can be announced without a code change; absent, the page simply omits
 * the line. A full Real contest system is deliberately not built yet.
 */
const SNAPSHOT_AT = process.env.NEXT_PUBLIC_REAL_SNAPSHOT_AT || "";
const CLAIM_DEADLINE_AT = process.env.NEXT_PUBLIC_REAL_CLAIM_DEADLINE_AT || "";

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                 */
/* -------------------------------------------------------------------------- */

function shortAddr(addr: string) {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** The server already summed in integer lamports; this only renders it. */
function solNumber(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** "+12.45 SOL" / "-0.1056 SOL". */
function formatSol(v: string): string {
  const n = solNumber(v);
  const body = `${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })} SOL`;
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}

function profitToneClass(v: string): string {
  const n = solNumber(v);
  if (n > 0) return "text-pump-green";
  if (n < 0) return "text-[#ff5c73]";
  return "text-gray-400";
}

/** "≈ $2,180" — display only, and only when a price exists. */
function formatUsdApprox(sol: string, price: number | null): string | null {
  if (price == null) return null;
  const usd = solNumber(sol) * price;
  if (!Number.isFinite(usd)) return null;
  const abs = Math.abs(usd);
  return `≈ ${usd < 0 ? "-" : ""}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: abs < 100 ? 2 : 0,
    maximumFractionDigits: abs < 100 ? 2 : 0,
  })}`;
}

/** "0.6667" → "67%". */
function formatWinRate(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
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

function hasUsername(row: RealLeaderboardRowView): boolean {
  return !!row.username && row.username.trim().length > 0;
}

function displayName(row: RealLeaderboardRowView): string {
  return hasUsername(row) ? (row.username as string).trim() : shortAddr(row.wallet_address);
}

function initialsOf(row: RealLeaderboardRowView): string {
  return (row.username?.trim() || row.wallet_address).slice(0, 2).toUpperCase();
}

/* -------------------------------------------------------------------------- */
/*  Medals — the same restrained metal tints Play uses                         */
/* -------------------------------------------------------------------------- */

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
/*  Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

function Avatar({
  row,
  size,
  ringClass,
}: {
  row: RealLeaderboardRowView;
  size: "sm" | "md";
  ringClass?: string;
}) {
  const box =
    size === "md"
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

function Identity({
  row,
  align = "left",
  nameClass,
}: {
  row: RealLeaderboardRowView;
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

function Stat({
  value,
  label,
  valueClass,
  compact,
}: {
  value: string;
  label: string;
  valueClass?: string;
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
/*  Road to $1M progress                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A COMMUNITY MILESTONE, not a prize.
 *
 * The bar tracks the leading trader's claimed profit against a $1,000,000
 * target. FunMarket is not paying $1M and the copy never says it does —
 * the wording is deliberately "community milestone" and "road progress".
 *
 * The percentage needs a dollar denominator, so it renders only when a
 * fresh price exists. Without one the SOL figure still shows and the
 * percentage disappears rather than being computed from a stale rate.
 */
function RoadProgress({
  leaderSol,
  price,
}: {
  leaderSol: string;
  price: { usd: number; as_of: string } | null;
}) {
  const sol = Math.max(solNumber(leaderSol), 0);
  const usd = price ? sol * price.usd : null;
  const pct = usd != null ? Math.min((usd / ROAD_TARGET_USD) * 100, 100) : null;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0c0e12] px-4 py-4 md:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Community milestone
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-pump-green" aria-hidden />
            <span className="text-lg font-extrabold tabular-nums text-white">
              Road to ${ROAD_TARGET_USD.toLocaleString("en-US")}
            </span>
          </div>
        </div>

        <div className="text-left sm:text-right">
          <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
            Current leader
          </div>
          <div className="text-lg font-extrabold tabular-nums text-pump-green">
            {formatSol(leaderSol)}
          </div>
          {usd != null && (
            <div className="text-[11px] tabular-nums text-gray-400">
              {formatUsdApprox(leaderSol, price!.usd)}
            </div>
          )}
        </div>
      </div>

      {pct != null ? (
        <>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-pump-green transition-[width] duration-700"
              // Sub-1% progress would otherwise be an invisible bar, so it
              // keeps a hairline width purely so the track reads as started.
              style={{ width: `${Math.max(pct, 0.35)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-semibold tabular-nums text-pump-green">
              {pct < 0.01 ? "<0.01" : pct.toFixed(pct < 1 ? 3 : 2)}% of the road
            </span>
            <span className="text-[10px] text-gray-600">
              USD equivalent based on the current SOL price ·{" "}
              {formatWhen(price!.as_of)}
            </span>
          </div>
        </>
      ) : (
        <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] text-gray-500">
          Road progress is unavailable right now — the SOL price could not be
          confirmed. Rankings below are unaffected: they are calculated in SOL.
        </p>
      )}

      <p className="mt-3 border-t border-white/[0.06] pt-3 text-[11px] leading-relaxed text-gray-500">
        A community progress milestone based on the leading trader&apos;s claimed
        profit. It is not a prize pool and not a guaranteed payout.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Podium                                                                     */
/* -------------------------------------------------------------------------- */

function Podium({
  rows,
  ownWallet,
  price,
}: {
  rows: RealLeaderboardRowView[];
  ownWallet: string | null;
  price: number | null;
}) {
  const top = rows.slice(0, 3);
  if (top.length === 0) return null;

  const gridCols =
    top.length === 3
      ? "md:grid-cols-3"
      : top.length === 2
        ? "md:grid-cols-2 md:max-w-2xl md:mx-auto"
        : "md:grid-cols-1 md:max-w-sm md:mx-auto";

  const desktopOrder = ["md:order-2", "md:order-1", "md:order-3"];
  const full = top.length === 3;

  const firstOnMobile = full
    ? "min-[360px]:col-span-2 min-[360px]:mx-auto " +
      "min-[360px]:w-[calc((100%-0.75rem)/2)] " +
      "md:mx-0 md:w-auto md:col-span-1"
    : "";

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
          price={price}
          isOwn={!!ownWallet && row.wallet_address === ownWallet}
          layoutClass={[
            row.rank === 1 ? firstOnMobile : "",
            stackedWidth,
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
  price,
}: {
  row: RealLeaderboardRowView;
  layoutClass: string;
  isOwn: boolean;
  price: number | null;
}) {
  const medal = medalFor(row.rank);
  const usd = formatUsdApprox(row.claimed_profit_sol, price);

  return (
    <Link
      href={`/profile/${row.wallet_address}`}
      className={`group relative flex flex-col items-center rounded-2xl border bg-[#0c0e12] px-3 py-5 transition
        hover:-translate-y-0.5 hover:border-white/20 hover:bg-[#101319]
        md:px-4 md:py-6
        ${isOwn ? "border-pump-green/40" : "border-white/10"}
        ${medal?.glow ?? ""} ${layoutClass}`}
    >
      <span
        className={`absolute -top-3 inline-flex h-7 items-center justify-center rounded-full border px-3 text-xs font-extrabold tabular-nums
          ${medal?.chip ?? "border-white/15 bg-[#0c0e12] text-gray-400"}`}
      >
        #{row.rank}
      </span>

      <Avatar row={row} size="md" ringClass={medal?.ring} />

      {/* Fixed height so a named trader and an unnamed one produce cards of
          identical height and the podium never sits crooked. */}
      <div className="mt-3 flex min-h-[2.75rem] w-full items-start justify-center">
        <Identity row={row} align="center" nameClass="text-sm" />
      </div>

      {/* CLAIMED PROFIT — dominant, in SOL, the unit everything is ranked on. */}
      <div
        className={`mt-2 max-w-full truncate text-lg font-extrabold tabular-nums md:text-xl ${profitToneClass(
          row.claimed_profit_sol
        )}`}
      >
        {formatSol(row.claimed_profit_sol)}
      </div>
      {/* The dollar figure is secondary and vanishes with the price feed. */}
      {usd && (
        <div className="max-w-full truncate text-[11px] tabular-nums text-gray-500">
          {usd}
        </div>
      )}
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-500">
        Claimed profit
      </div>

      <div className="mt-4 grid w-full grid-cols-3 gap-1 border-t border-white/[0.06] pt-3">
        <Stat value={String(row.wins)} label="Wins" compact />
        <Stat value={String(row.settled_claimed_positions)} label="Settled" compact />
        <Stat value={formatWinRate(row.win_rate)} label="Win rate" compact />
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Standings                                                                  */
/* -------------------------------------------------------------------------- */

const GRID = "grid-cols-[2.5rem_minmax(0,1fr)_8rem_3.5rem_3.5rem_4.5rem] gap-3";

function StandingsHeader() {
  return (
    <div
      className={`hidden ${GRID} items-center border-b border-white/[0.07] px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-gray-500 md:grid`}
    >
      <span>Rank</span>
      <span>Trader</span>
      <span className="text-right" title="Completed cash flows on settled markets">
        Claimed profit
      </span>
      <span className="text-right" title="Settled positions counted">
        Settled
      </span>
      <span className="text-right">Wins</span>
      <span className="text-right" title="Wins ÷ (wins + losses). Refunds excluded.">
        Win rate
      </span>
    </div>
  );
}

function StandingsRow({
  row,
  isOwn,
  price,
}: {
  row: RealLeaderboardRowView;
  isOwn: boolean;
  price: number | null;
}) {
  const medal = medalFor(row.rank);
  const usd = formatUsdApprox(row.claimed_profit_sol, price);

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

        <span className="text-right">
          <span
            className={`block text-sm font-bold tabular-nums ${profitToneClass(
              row.claimed_profit_sol
            )}`}
          >
            {formatSol(row.claimed_profit_sol)}
          </span>
          {usd && (
            <span className="block text-[10px] tabular-nums text-gray-600">{usd}</span>
          )}
        </span>

        <span className="text-right text-sm tabular-nums text-gray-300">
          {row.settled_claimed_positions}
        </span>
        <span className="text-right text-sm tabular-nums text-gray-300">{row.wins}</span>
        <span className="text-right text-sm tabular-nums text-gray-300">
          {formatWinRate(row.win_rate)}
        </span>
      </div>

      {/* Mobile */}
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
          <span className="shrink-0 text-right">
            <span
              className={`block text-sm font-bold tabular-nums ${profitToneClass(
                row.claimed_profit_sol
              )}`}
            >
              {formatSol(row.claimed_profit_sol)}
            </span>
            {usd && (
              <span className="block text-[10px] tabular-nums text-gray-600">{usd}</span>
            )}
          </span>
        </div>
        <div className="mt-1.5 pl-[4.75rem] text-[11px] text-gray-500">
          {row.wins} {row.wins === 1 ? "win" : "wins"} ·{" "}
          {row.settled_claimed_positions} settled · {formatWinRate(row.win_rate)} win
          rate
        </div>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Your rank                                                                  */
/* -------------------------------------------------------------------------- */

function YourRankCard({
  viewer,
  connected,
  price,
}: {
  viewer: RealLeaderboardRowView | null;
  connected: boolean;
  price: number | null;
}) {
  if (!viewer) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#0c0e12] px-5 py-4">
        <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
          Your rank
        </div>
        <p className="mt-1.5 text-sm font-semibold text-white">
          You&apos;re not ranked yet.
        </p>
        <p className="mt-0.5 text-xs text-gray-400">
          {connected
            ? "Settle and claim your first Real market to enter the Road to $1M."
            : "Connect your wallet to see where you stand."}
        </p>
      </div>
    );
  }

  const medal = medalFor(viewer.rank);
  const usd = formatUsdApprox(viewer.claimed_profit_sol, price);

  return (
    <Link
      href={`/profile/${viewer.wallet_address}`}
      className="block rounded-2xl border border-pump-green/30 bg-pump-green/[0.04] px-5 py-4 transition hover:border-pump-green/50 hover:bg-pump-green/[0.07]"
    >
      <div className="text-[10px] font-medium uppercase tracking-wider text-pump-green/80">
        Your rank
      </div>

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
            value={formatSol(viewer.claimed_profit_sol)}
            label={usd ? `Profit · ${usd}` : "Claimed profit"}
            valueClass={profitToneClass(viewer.claimed_profit_sol)}
          />
          <Stat value={String(viewer.wins)} label="Wins" />
          <Stat value={String(viewer.settled_claimed_positions)} label="Settled" />
        </span>
      </div>
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  View                                                                       */
/* -------------------------------------------------------------------------- */

export default function RealLeaderboardView() {
  const { publicKey, connected } = useWallet();
  const connectedWallet = connected && publicKey ? publicKey.toBase58() : null;

  const { data, error, pending, refresh } = useRealLeaderboard({
    limit: LEADERBOARD_LIMIT,
    wallet: connectedWallet,
  });

  const rows = data?.rows ?? [];
  const viewer = data?.viewer ?? null;
  const meta = data?.meta ?? null;
  const price = data?.sol_usd?.usd ?? null;

  const hasRows = rows.length > 0;
  const standings = rows.slice(3);

  const snapshotLine = useMemo(() => {
    if (!SNAPSHOT_AT) return null;
    const claim = CLAIM_DEADLINE_AT ? formatWhen(CLAIM_DEADLINE_AT) : null;
    return claim
      ? `Next snapshot ${formatWhen(SNAPSHOT_AT)} · claim by ${claim}`
      : `Next snapshot ${formatWhen(SNAPSHOT_AT)}`;
  }, []);

  return (
    <div className="min-h-screen bg-black">
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
                Real-money leaderboard
              </span>
              {meta && meta.total_traders > 0 && (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
                  {meta.total_traders.toLocaleString()}{" "}
                  {meta.total_traders === 1 ? "trader" : "traders"}
                </span>
              )}
            </div>

            <h1 className="mt-4 text-3xl font-extrabold uppercase leading-none tracking-tight text-white md:text-5xl">
              Road to $1M
            </h1>

            <p className="mt-3 text-base font-semibold text-white/90 md:text-lg">
              Trade real markets. Claim your winnings. Climb the Road to $1M.
            </p>
            <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-gray-400">
              Rankings are based on claimed profit from settled Real markets.
            </p>
            <p className="mt-2 text-[11px] text-gray-600">
              Claim your winnings before each snapshot to have your profit counted.
            </p>
            {snapshotLine && (
              <p className="mt-1.5 text-[11px] font-semibold tabular-nums text-pump-green/90">
                {snapshotLine}
              </p>
            )}
          </header>

          {/* DEVNET banner — never rendered in production, where the
              eligibility gate refuses undeclared rows outright. */}
          {meta?.is_test_data && (
            <div className="mt-6 rounded-xl border border-[#f5c451]/40 bg-[#f5c451]/[0.08] px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-[#f5c451]">
              Devnet test data — not real trading results
            </div>
          )}

          {/* BODY */}
          <div className="mt-10 md:mt-12">
            {error ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#0c0e12] px-5 py-16 text-center">
                <p className="text-sm text-gray-400">
                  Couldn&apos;t load the Real leaderboard.
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
                <div className="h-[120px] animate-pulse rounded-2xl border border-white/10 bg-[#0c0e12]" />
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
            ) : !hasRows ? (
              <div className="rounded-2xl border border-white/10 bg-[#0c0e12] px-5 py-16 text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-pump-green/25 bg-pump-green/[0.08]">
                  <Trophy className="h-7 w-7 text-pump-green" />
                </div>
                <h2 className="text-lg font-bold text-white">
                  No settled Real results yet.
                </h2>
                <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-gray-400">
                  Be the first trader on the Road to $1M.
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
                <RoadProgress
                  leaderSol={rows[0].claimed_profit_sol}
                  price={data?.sol_usd ?? null}
                />

                <Podium rows={rows} ownWallet={connectedWallet} price={price} />

                <YourRankCard
                  viewer={viewer}
                  connected={!!connectedWallet}
                  price={price}
                />

                {standings.length > 0 && (
                  <section>
                    <div className="mb-3 flex items-baseline justify-between gap-3">
                      <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                        Traders
                      </h2>
                      {meta && meta.total_traders > rows.length && (
                        <span className="text-[11px] tabular-nums text-gray-500">
                          Top {rows.length} of {meta.total_traders.toLocaleString()}
                        </span>
                      )}
                    </div>

                    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0c0e12]">
                      <StandingsHeader />
                      {standings.map((row) => (
                        <StandingsRow
                          key={row.wallet_address}
                          row={row}
                          price={price}
                          isOwn={
                            !!connectedWallet &&
                            row.wallet_address === connectedWallet
                          }
                        />
                      ))}
                    </div>
                  </section>
                )}

                {/* The limitation, stated in the body and not only in a
                    tooltip: an unclaimed win is simply absent from this
                    board, and a reader is entitled to know how many. */}
                <p className="text-center text-[11px] leading-relaxed text-gray-500">
                  Rankings are based on claimed profit from settled Real markets.
                  Winning positions that have not been claimed are not counted
                  {meta && meta.excluded_unclaimed_positions > 0
                    ? ` — ${meta.excluded_unclaimed_positions} unclaimed ${
                        meta.excluded_unclaimed_positions === 1
                          ? "position is"
                          : "positions are"
                      } currently excluded`
                    : ""}
                  . Claim your winnings before the snapshot to have your profit
                  counted.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
