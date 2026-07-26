"use client";

// src/components/play/PlayLeaderboardView.tsx
//
// The Play face of /leaderboard. Same route, same shell, same visual language
// as the Real page — a different body.
//
// It sits on the far side of an outer `isPlay ? … : …` branch in
// src/app/leaderboard/page.tsx, so the Real leaderboard is not merely hidden
// here: it is UNMOUNTED. No Real read runs in Play mode, and none of this
// component's state can survive a switch back to Real.
//
// WHAT IS RANKED
// --------------
// Authoritative REALIZED P&L only — the sum of play_trades.realized_pnl_usd
// over settled rows, computed server-side. An open position contributes
// nothing: no quoted valuation is ever dressed up as profit here, exactly as
// on the Play profile.
//
// WHAT IS NOT HERE
// ----------------
// No SOL, no balance, no account id, no rewards or prize copy, no season
// competition, no badges. Every row links to /profile/[wallet], which in Play
// mode already renders the public Play profile — so the mode carries across
// the navigation with no reload and no query parameter.

import Link from "next/link";
import { Trophy } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayLeaderboard } from "@/components/play/usePlayLeaderboard";
import {
  formatUsd,
  toCents,
  type PlayLeaderboardRowView,
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
function formatPnl(v: string): string {
  const c = toCents(v);
  if (c === null) return "$0.00";
  const body = formatUsd(v);
  return c > BigInt(0) ? `+${body}` : body;
}

function pnlToneClass(v: string): string {
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

function hasUsername(row: PlayLeaderboardRowView): boolean {
  return !!row.username && row.username.trim().length > 0;
}

function displayName(row: PlayLeaderboardRowView): string {
  return hasUsername(row)
    ? (row.username as string).trim()
    : shortAddr(row.wallet_address);
}

function initialsOf(row: PlayLeaderboardRowView): string {
  return (row.username?.trim() || row.wallet_address).slice(0, 2).toUpperCase();
}

/**
 * Top three get a medal tint. This is the whole of the "podium" — the Real
 * page has no podium section to mirror, and inventing one would be a redesign
 * of a page this phase is not meant to redesign.
 */
function rankToneClass(rank: number): string {
  if (rank === 1) return "border-[#f5c451]/50 bg-[#f5c451]/10 text-[#f5c451]";
  if (rank === 2) return "border-gray-400/40 bg-gray-400/10 text-gray-300";
  if (rank === 3) return "border-[#cd7f32]/50 bg-[#cd7f32]/10 text-[#cd7f32]";
  return "border-gray-800 bg-white/[0.03] text-gray-500";
}

/* -------------------------------------------------------------------------- */
/*  Row pieces                                                                 */
/* -------------------------------------------------------------------------- */

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={`inline-flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-lg border px-1.5 text-xs font-bold tabular-nums ${rankToneClass(
        rank
      )}`}
    >
      {rank}
    </span>
  );
}

function Avatar({ row }: { row: PlayLeaderboardRowView }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-pump-green/40 bg-gray-900 text-[11px] font-bold text-white">
      {row.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.avatar_url}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        initialsOf(row)
      )}
    </span>
  );
}

/**
 * One player. A single <Link> per row — never a link inside a link — so the
 * whole row is clickable on both breakpoints with no nested-anchor warning.
 * Grid on desktop, stacked card on mobile.
 */
function PlayerRow({
  row,
  highlight,
}: {
  row: PlayLeaderboardRowView;
  highlight?: boolean;
}) {
  const name = displayName(row);
  return (
    <Link
      href={`/profile/${row.wallet_address}`}
      className={`block border-b border-gray-800/60 px-3 py-3 transition last:border-0 hover:bg-white/[0.03] ${
        highlight ? "bg-pump-green/[0.06]" : ""
      }`}
    >
      {/* Desktop / tablet: Rank · Player · Realized PnL · Picks · Wins · Win Rate */}
      <div className="hidden items-center gap-3 md:grid md:grid-cols-[auto_minmax(0,1fr)_7.5rem_4rem_4rem_5rem]">
        <RankBadge rank={row.rank} />

        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar row={row} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white" title={name}>
              {name}
            </span>
            {/* The wallet is the fallback NAME when there is no profile — only
                show it as a second line when it would not just repeat it. */}
            {hasUsername(row) && (
              <span className="block truncate font-mono text-[11px] text-gray-500">
                {shortAddr(row.wallet_address)}
              </span>
            )}
          </span>
        </span>

        <span
          className={`text-right text-sm font-bold tabular-nums ${pnlToneClass(
            row.realized_pnl_usd
          )}`}
        >
          {formatPnl(row.realized_pnl_usd)}
        </span>
        <span className="text-right text-sm tabular-nums text-white/85">
          {row.picks}
        </span>
        <span className="text-right text-sm tabular-nums text-white/85">
          {row.wins}
        </span>
        <span className="text-right text-sm tabular-nums text-gray-400">
          {formatWinRate(row.win_rate)}
        </span>
      </div>

      {/* Mobile: #rank avatar name / PnL / wins · picks */}
      <div className="md:hidden">
        <div className="flex items-center gap-2.5">
          <RankBadge rank={row.rank} />
          <Avatar row={row} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">
              {name}
            </span>
            {hasUsername(row) && (
              <span className="block truncate font-mono text-[11px] text-gray-500">
                {shortAddr(row.wallet_address)}
              </span>
            )}
          </span>
          <span
            className={`shrink-0 text-sm font-bold tabular-nums ${pnlToneClass(
              row.realized_pnl_usd
            )}`}
          >
            {formatPnl(row.realized_pnl_usd)}
          </span>
        </div>
        <div className="mt-1 pl-[4.25rem] text-[11px] text-gray-500">
          {row.wins} {row.wins === 1 ? "win" : "wins"} · {row.picks}{" "}
          {row.picks === 1 ? "pick" : "picks"} ·{" "}
          {formatWinRate(row.win_rate)} win rate
        </div>
      </div>
    </Link>
  );
}

function HeaderRow() {
  return (
    <div className="hidden grid-cols-[auto_minmax(0,1fr)_7.5rem_4rem_4rem_5rem] items-center gap-3 border-b border-gray-800 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500 md:grid">
      <span className="w-7">#</span>
      <span>Player</span>
      <span className="text-right">Realized PnL</span>
      {/* The Play profile's "Picks" counts EVERY position including open ones;
          this column counts settled positions only, because that is what the
          ranking is built from. The titles say so on hover. */}
      <span className="text-right" title="Settled positions (market + outcome)">
        Picks
      </span>
      <span className="text-right">Wins</span>
      <span className="text-right" title="Wins ÷ (wins + losses). Refunds excluded.">
        Win rate
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  View                                                                       */
/* -------------------------------------------------------------------------- */

export default function PlayLeaderboardView() {
  const { leaderboard, error, pending, refresh } = usePlayLeaderboard({
    limit: LEADERBOARD_LIMIT,
  });
  const { publicKey, connected } = useWallet();
  const connectedWallet = connected && publicKey ? publicKey.toBase58() : null;

  const rows = leaderboard?.rows ?? [];
  const viewer = leaderboard?.viewer ?? null;

  // "Me" is the wallet the server proved from the Play session cookie. The
  // connected wallet is only the fallback for highlighting when there is no
  // Play session yet — it can never produce a `viewer` row on its own, because
  // that row comes from the server or not at all.
  const ownWallet = viewer?.wallet_address ?? connectedWallet;

  // The viewer's own row is repeated below the table only when it is not
  // already visible in it. It carries the same public stats as any other row —
  // rank, P&L, picks, wins — and never a balance.
  const viewerOutsideTable =
    viewer != null &&
    !rows.some((r) => r.wallet_address === viewer.wallet_address);

  return (
    <div className="min-h-screen bg-pump-dark px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        {/* Hero — same shape as the Real page's */}
        <header className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-pump-green/30 bg-pump-green/10">
            <Trophy className="h-5 w-5 text-pump-green" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-white md:text-3xl">
              Play leaderboard
            </h1>
            <p className="mt-1 text-sm text-gray-400">
              Ranked by realized PnL on settled Play markets. Open positions
              don&apos;t count.
            </p>
          </div>
        </header>

        <section className="rounded-2xl border border-pump-border bg-pump-gray">
          {error ? (
            <div className="flex flex-col items-center justify-center gap-2 px-5 py-14 text-center">
              <p className="text-sm text-gray-400">
                Couldn&apos;t load the Play leaderboard.
              </p>
              <button
                onClick={refresh}
                className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 transition hover:border-gray-500"
              >
                Retry
              </button>
            </div>
          ) : pending ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[60px] animate-pulse rounded-xl border border-gray-800 bg-[#05070b]"
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-pump-green/30 bg-pump-green/10">
                <Trophy className="h-6 w-6 text-pump-green" />
              </div>
              <h2 className="text-base font-semibold text-white">
                No settled Play results yet
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-400">
                Players appear here once a market they picked resolves. Make a
                pick and wait for it to settle.
              </p>
              <Link
                href="/"
                className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-pump-green px-5 text-sm font-bold text-black transition hover:bg-pump-green/90"
              >
                Browse markets
              </Link>
            </div>
          ) : (
            <>
              <HeaderRow />
              <div>
                {rows.map((r) => (
                  <PlayerRow
                    key={r.wallet_address}
                    row={r}
                    highlight={!!ownWallet && r.wallet_address === ownWallet}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        {/* Your rank — only when the connected player is off the visible page. */}
        {viewerOutsideTable && viewer && (
          <section className="rounded-2xl border border-pump-green/30 bg-pump-gray">
            <div className="border-b border-gray-800 px-3 py-2 text-[11px] uppercase tracking-wide text-gray-500">
              Your rank
            </div>
            <PlayerRow row={viewer} highlight />
          </section>
        )}

        {rows.length > 0 && leaderboard && (
          <p className="text-center text-[11px] text-gray-600">
            {leaderboard.total_players.toLocaleString()} ranked{" "}
            {leaderboard.total_players === 1 ? "player" : "players"}
            {leaderboard.total_players > rows.length
              ? ` · showing top ${rows.length}`
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}
