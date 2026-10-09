"use client";

// src/components/play/PlayProfileView.tsx
//
// The Play face of /profile/[wallet]. Same route, same header visual
// language, same identity — a different body.
//
// It sits on the far side of an outer `isPlay ? … : …` branch in
// src/app/profile/[wallet]/page.tsx, so the Real profile is not merely
// hidden here: it is UNMOUNTED. No Real query runs in Play mode, and none of
// this component's state can survive a switch back to Real.
//
// SHARED IDENTITY, ON PURPOSE
// ---------------------------
// Username, avatar and bio come from the SAME public.profiles row Real Mode
// reads, and Edit profile writes back through the SAME upsertProfile /
// uploadAvatar path. One wallet, one identity, in both modes. There is no
// Play username, no Play avatar and no Play profile table.
//
// WHAT IS NOT HERE
// ----------------
// No Markets tab, no markets-created count, no SOL, no follower counts, no
// Real transaction links, no creator copy. And no unrealized P&L: an open
// position shows its stake and a dash, never a quoted valuation dressed up
// as profit.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { Pencil, Share2 } from "lucide-react";
import EditProfileModal from "@/components/EditProfileModal";
import FlashMarketResultModal from "@/components/FlashMarketResultModal";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { usePlayProfile } from "@/components/play/usePlayProfile";
import {
  formatUsd,
  toCents,
  type PlayProfilePositionView,
} from "@/lib/playClient";
import { buildPlayProfileShareInput } from "@/lib/resultPayload";
import type { ResultCardInput } from "@/lib/resultCard";

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                 */
/* -------------------------------------------------------------------------- */

function shortAddr(addr: string) {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** "+$800.00" / "-$2,000.00" / "$0.00". Sign is decided in exact cents. */
function formatPnl(v: string | null): string {
  if (v == null) return "—";
  const c = toCents(v);
  if (c === null) return "—";
  const body = formatUsd(v);
  return c > BigInt(0) ? `+${body}` : body;
}

function pnlToneClass(v: string | null): string {
  if (v == null) return "text-gray-400";
  const c = toCents(v);
  if (c === null || c === BigInt(0)) return "text-gray-400";
  return c > BigInt(0) ? "text-pump-green" : "text-[#ff5c73]";
}

/** "26 Jul" — compact enough for a mobile card and a desktop column. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fullDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function formatShares(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function pickLabel(p: PlayProfilePositionView): string {
  return p.outcome_name || `Outcome #${p.outcome_index + 1}`;
}

/** Outcome 0 keeps the green accent every other Play surface already uses. */
function pickToneClass(outcomeIndex: number): string {
  return outcomeIndex === 0 ? "text-pump-green" : "text-[#ff5c73]";
}

const STATUS_LABEL: Record<PlayProfilePositionView["status"], string> = {
  open: "OPEN",
  won: "WON",
  lost: "LOST",
  refunded: "REFUNDED",
};

function StatusPill({ status }: { status: PlayProfilePositionView["status"] }) {
  const tone =
    status === "won"
      ? "bg-pump-green/15 text-pump-green"
      : status === "lost"
        ? "bg-[#ff5c73]/15 text-[#ff5c73]"
        : "bg-white/[0.06] text-gray-400";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${tone}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Status + Share, together. A plain <button> — the profile rows are not links,
 * and this must not become one, so there is no anchor to nest.
 */
function StatusCell({
  position,
  onShare,
}: {
  position: PlayProfilePositionView;
  onShare: (p: PlayProfilePositionView) => void;
}) {
  // No button on a row whose result cannot be stated truthfully.
  const shareable = buildPlayProfileShareInput(position) !== null;
  return (
    <div className="flex items-center gap-1.5">
      <StatusPill status={position.status} />
      {shareable ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onShare(position);
          }}
          aria-label={`Share this result: ${STATUS_LABEL[position.status]} on ${
            position.market_title || position.market_address
          }`}
          title="Share this result"
          // Roomier tap target on touch layouts, tighter inside the dense
          // desktop table where the pointer is precise.
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-pump-green md:h-7 md:w-7"
        >
          <Share2 className="h-4 w-4 md:h-3.5 md:w-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Header pieces — same visual language as the Real profile header            */
/* -------------------------------------------------------------------------- */

function StatInline({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 leading-none whitespace-nowrap">
      <span className="text-base font-bold text-white">{value}</span>
      <span className="text-[11px] uppercase tracking-wide text-gray-500">
        {label}
      </span>
    </span>
  );
}

function StatDivider() {
  return <span aria-hidden className="h-4 w-px bg-gray-800" />;
}

/* -------------------------------------------------------------------------- */
/*  View                                                                       */
/* -------------------------------------------------------------------------- */

export default function PlayProfileView({ wallet }: { wallet: string }) {
  const router = useRouter();
  const { publicKey, connected } = useFunMarketWallet();
  const viewerWallet = connected && publicKey ? publicKey.toBase58() : null;
  // Mirrors the Real profile: the Edit affordance follows the CONNECTED
  // wallet. Releasing the balance is a stricter, server-side check.
  const isOwnProfile = !!viewerWallet && viewerWallet === wallet;

  const { profile, error, pending, refresh } = usePlayProfile(wallet);
  const {
    authenticated,
    authenticating,
    balanceUsd: sessionBalanceUsd,
    ensureSession,
  } = usePlaySession();

  const [editOpen, setEditOpen] = useState(false);

  // The historical result being shared, if any. It reuses the very same
  // result modal, card renderer and share hook the live surfaces use — this
  // screen only supplies the payload.
  const [shareInput, setShareInput] = useState<ResultCardInput | null>(null);

  const handleShare = useCallback((position: PlayProfilePositionView) => {
    const input = buildPlayProfileShareInput(position);
    if (input) setShareInput(input);
  }, []);

  // Identity is seeded from the API and patched locally on save, so an edit
  // shows immediately without a refetch. Same fields, same table, same row
  // the Real profile reads.
  const [identity, setIdentity] = useState<{
    display_name: string | null;
    bio: string | null;
    avatar_url: string | null;
  }>({ display_name: null, bio: null, avatar_url: null });

  useEffect(() => {
    setIdentity({
      display_name: profile?.username ?? null,
      bio: profile?.bio ?? null,
      avatar_url: profile?.avatar_url ?? null,
    });
  }, [profile?.username, profile?.bio, profile?.avatar_url]);

  const displayName =
    identity.display_name && identity.display_name.trim().length > 0
      ? identity.display_name
      : shortAddr(wallet);

  const initials = useMemo(() => {
    const src = (identity.display_name || wallet).trim();
    return src.slice(0, 2).toUpperCase();
  }, [identity.display_name, wallet]);

  // Balance is owner-only. The API value wins: it is read from play_accounts
  // at request time, and the hook refetches on return-to-tab, so a settlement
  // payout credited while the user was away is included. The session value is
  // the fallback for the window before the first response lands.
  const ownerBalance = isOwnProfile
    ? profile?.balance_usd ?? (authenticated ? sessionBalanceUsd : null)
    : null;

  const positions = profile?.positions ?? [];

  return (
    <div className="min-h-screen bg-black pb-24 md:pb-12">
      {/* HEADER */}
      <section className="relative">
        {/* subtle neon backdrop */}
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-pump-green/10 via-pump-green/[0.03] to-transparent pointer-events-none" />

        <div className="relative max-w-3xl mx-auto px-4 pt-6 md:pt-10">
          <div className="flex flex-col items-center text-center">
            {/* Avatar */}
            <div className="relative">
              <div className="h-24 w-24 md:h-28 md:w-28 rounded-full overflow-hidden border-2 border-pump-green bg-gray-900 flex items-center justify-center text-2xl font-bold text-white shadow-[0_0_30px_rgba(0,255,135,0.25)]">
                {identity.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={identity.avatar_url}
                    alt={displayName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
            </div>

            {/* Name + handle */}
            <h1 className="mt-3 text-xl md:text-2xl font-bold text-white truncate max-w-full">
              {displayName}
            </h1>
            <p className="mt-0.5 text-xs md:text-sm text-gray-400 font-mono">
              {shortAddr(wallet)}
            </p>

            {/* Bio — the user's own line, or a neutral Play one. The Real
                page's creator sentence is deliberately not used here. */}
            <p className="mt-3 max-w-md text-sm text-gray-300/90 leading-relaxed whitespace-pre-line">
              {identity.bio && identity.bio.trim().length > 0
                ? identity.bio
                : "Playing markets on FunMarket."}
            </p>

            {/* Stats — Balance (owner only), Realized PnL, Picks. No SOL, no
                markets created, no followers. */}
            <div className="mt-5 flex items-center justify-center gap-3 sm:gap-5 text-sm w-full max-w-md flex-wrap">
              {isOwnProfile && (
                <>
                  <StatInline
                    value={
                      pending
                        ? "—"
                        : ownerBalance != null
                          ? formatUsd(ownerBalance, { compact: true })
                          : "—"
                    }
                    label="Balance"
                  />
                  <StatDivider />
                </>
              )}
              <StatInline
                value={
                  pending || !profile
                    ? "—"
                    : formatPnl(profile.realized_pnl_usd)
                }
                label="Realized PnL"
              />
              <StatDivider />
              <StatInline
                value={pending || !profile ? "—" : String(profile.position_count)}
                label="Picks"
              />
            </div>

            {/* Edit profile — owner only, exactly as in Real. */}
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="mt-5 inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full text-sm font-semibold transition w-full max-w-xs bg-transparent border border-pump-green text-pump-green hover:bg-pump-green/10"
              >
                <Pencil className="w-4 h-4" />
                Edit profile
              </button>
            )}

            {/* No Play session yet: the balance is genuinely unknown, not
                zero. Offer the one action that resolves it. */}
            {isOwnProfile && !authenticated && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await ensureSession();
                  if (ok) refresh();
                }}
                disabled={authenticating}
                className="mt-2 text-[11px] text-gray-500 hover:text-pump-green transition disabled:opacity-60"
              >
                {authenticating ? "Enabling Play…" : "Enable Play to see your balance"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Edit modal — own profile only. Same modal, same table, same storage
          bucket as Real: an edit here shows in both modes. */}
      {isOwnProfile && (
        <EditProfileModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          wallet={wallet}
          initial={identity}
          onSaved={(next) => setIdentity(next)}
        />
      )}

      {/* ACTIVITY — the only tab in Play. The tab strip is kept so the page
          keeps its spacing and rhythm, with Activity permanently active. */}
      <section className="max-w-6xl mx-auto px-4 mt-8 md:mt-10">
        <div
          role="tablist"
          aria-label="Profile sections"
          className="flex items-center gap-6 border-b border-gray-800 mb-5"
        >
          <span
            role="tab"
            aria-selected
            className="relative -mb-px pb-2.5 text-sm font-semibold text-white border-b-2 border-pump-green"
          >
            Activity
          </span>
        </div>

        <PlayPositions
          positions={positions}
          pending={pending}
          error={error}
          onRetry={refresh}
          onShare={handleShare}
          onOpenPosition={(position) => router.push(`/trade/${position.market_address}`)}
        />
      </section>

      {/* One shared result modal for the whole list — the same component the
          Live and Trade surfaces open, pre-filled with a historical row. */}
      {shareInput ? (
        <FlashMarketResultModal
          open
          mode={shareInput.mode}
          result={shareInput.state}
          marketTitle={shareInput.marketTitle}
          pickLabel={shareInput.pickLabel}
          outcomeLabel={shareInput.winningOutcomeLabel}
          secondaryText={shareInput.marketResultText}
          currency={shareInput.currency}
          stake={shareInput.stake}
          payout={shareInput.payout}
          profit={shareInput.profit}
          payoutQualifier={shareInput.payoutQualifier}
          claimAvailable={shareInput.claimAvailable}
          provisional={shareInput.provisional}
          marketPath={shareInput.marketPath}
          onClose={() => setShareInput(null)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Grouped positions                                                          */
/* -------------------------------------------------------------------------- */

function PlayPositions({
  positions,
  pending,
  error,
  onRetry,
  onShare,
  onOpenPosition,
}: {
  positions: PlayProfilePositionView[];
  pending: boolean;
  error: boolean;
  onRetry: () => void;
  onShare: (p: PlayProfilePositionView) => void;
  onOpenPosition: (p: PlayProfilePositionView) => void;
}) {
  if (error) {
    return (
      <div className="py-14 flex flex-col items-center justify-center text-center gap-2">
        <p className="text-sm text-gray-400">Couldn&apos;t load Play activity.</p>
        <button
          onClick={onRetry}
          className="px-3 py-1.5 rounded-lg border border-gray-700 text-xs font-semibold text-gray-300 hover:border-gray-500 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (pending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[72px] rounded-xl border border-gray-800 bg-[#05070b] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="py-14 text-center">
        <p className="text-gray-400 text-sm">No Play activity yet</p>
        <p className="text-gray-600 text-xs mt-1">
          Picks made in Play mode will show up here.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop / tablet: Market · Pick · Stake · Result · PnL · Date */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
              <th className="text-left font-medium py-2 pr-3">Market</th>
              <th className="text-left font-medium py-2 px-3">Pick</th>
              <th className="text-right font-medium py-2 px-3">Stake</th>
              <th className="text-left font-medium py-2 px-3">Result</th>
              <th className="text-right font-medium py-2 px-3">PnL</th>
              <th className="text-right font-medium py-2 pl-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr
                key={`${p.market_address}|${p.outcome_index}`}
                onClick={p.status === "open" ? (event) => {
                  if ((event.target as HTMLElement).closest("a,button,input,select,textarea,[role=button]")) return;
                  onOpenPosition(p);
                } : undefined}
                onKeyDown={p.status === "open" ? (event) => {
                  if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onOpenPosition(p);
                  }
                } : undefined}
                role={p.status === "open" ? "link" : undefined}
                tabIndex={p.status === "open" ? 0 : undefined}
                className={`border-b border-gray-800/60 last:border-0 ${p.status === "open" ? "cursor-pointer transition hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-pump-green" : ""}`}
              >
                <td className="py-3 pr-3 max-w-[280px] lg:max-w-[420px]">
                  <div className="text-white truncate" title={p.market_title ?? undefined}>
                    {p.market_title || shortAddr(p.market_address)}
                  </div>
                  <div className="text-[11px] text-gray-600">
                    {formatShares(p.total_shares)} shares
                    {p.trade_count > 1 ? ` · ${p.trade_count} buys` : ""}
                  </div>
                </td>
                <td className="py-3 px-3">
                  <span
                    className={`font-semibold ${pickToneClass(p.outcome_index)}`}
                  >
                    {pickLabel(p)}
                  </span>
                </td>
                <td className="py-3 px-3 text-right tabular-nums text-white/85">
                  {formatUsd(p.total_stake_usd)}
                </td>
                <td className="py-3 px-3">
                  <StatusCell position={p} onShare={onShare} />
                </td>
                <td
                  className={`py-3 px-3 text-right tabular-nums font-semibold ${p.status === "open" && p.estimated_payout_usd != null ? "text-pump-green" : pnlToneClass(p.realized_pnl_usd)}`}
                  title={
                    p.status === "open" && p.estimated_payout_usd != null
                      ? `Estimated payout ${formatUsd(p.estimated_payout_usd)}`
                      : p.payout_usd != null
                      ? `Payout ${formatUsd(p.payout_usd)}`
                      : undefined
                  }
                >
                  {p.status === "open" && <span className="block text-[10px] font-normal text-gray-500">Est. payout if resolved now</span>}
                  {p.status === "open" && p.estimated_payout_usd != null
                    ? formatUsd(p.estimated_payout_usd)
                    : formatPnl(p.realized_pnl_usd)}
                </td>
                <td
                  className="py-3 pl-3 text-right text-gray-500 whitespace-nowrap"
                  title={fullDate(p.last_trade_at)}
                >
                  {shortDate(p.last_trade_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: one card per grouped position */}
      <div className="md:hidden space-y-2">
        {positions.map((p) => (
          <div
            key={`${p.market_address}|${p.outcome_index}`}
            onClick={p.status === "open" ? (event) => {
                  if ((event.target as HTMLElement).closest("a,button,input,select,textarea,[role=button]")) return;
                  onOpenPosition(p);
                } : undefined}
            onKeyDown={p.status === "open" ? (event) => {
              if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onOpenPosition(p);
              }
            } : undefined}
            role={p.status === "open" ? "link" : undefined}
            tabIndex={p.status === "open" ? 0 : undefined}
            className={`rounded-xl border border-gray-800 bg-pump-dark/40 p-3 ${p.status === "open" ? "cursor-pointer transition active:border-pump-green/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pump-green" : ""}`}
          >
            <div className="text-sm text-white truncate">
              {p.market_title || shortAddr(p.market_address)}
            </div>
            <div className="mt-0.5 text-xs text-gray-400 truncate">
              Pick:{" "}
              <span className={`font-semibold ${pickToneClass(p.outcome_index)}`}>
                {pickLabel(p)}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-3">
              <StatusCell position={p} onShare={onShare} />
              <span
                className={`${p.status === "open" ? "min-w-0 text-right" : "max-w-[48%] truncate"} text-sm font-bold tabular-nums ${p.status === "open" && p.estimated_payout_usd != null ? "text-pump-green" : pnlToneClass(p.realized_pnl_usd)}`}
              >
                {p.status === "open" && <span className="block text-[10px] font-normal text-gray-500">Est. payout if resolved now</span>}
                {p.status === "open" && p.estimated_payout_usd != null
                  ? formatUsd(p.estimated_payout_usd)
                  : formatPnl(p.realized_pnl_usd)}
              </span>
            </div>

            <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-gray-500">
              <span className="tabular-nums">
                {formatUsd(p.total_stake_usd)} staked
              </span>
              <span className="whitespace-nowrap">
                {shortDate(p.last_trade_at)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
