"use client";

// src/components/onboarding/FunMarketOnboarding.tsx
//
// The three-step first-run explainer: what Play money is, what it is FOR,
// and how Real works when you want it.
//
// Full screen on mobile, a 560px modal on desktop — one tree, because the
// three steps carry identical copy and identical data on both, and a second
// component would be a second place for that copy to drift.
//
// NOTHING HERE IS INVENTED
// ------------------------
// Every figure on these screens is read back from the app:
//
//   step 1 — the starting bankroll from /api/play/settings, which is the
//            same play_settings row the daily grant credits from. For someone
//            who already HAS a Play balance (replaying it from "How it
//            works") their own balance is shown instead, because that is what
//            their header says.
//   step 2 — the live public Play leaderboard, top three plus the viewer's
//            own row when they have one. No sample players, no sample profits.
//   step 3 — the viewer's own Play and SOL balances.
//
// When a value is not known — signed out, offline, still loading — the
// element that would have stated it is not rendered, or falls back to a
// neutral label. A tour is a bad reason to show someone a number that is not
// theirs, and step 2 in particular must never invite comparison against a
// leaderboard of people who do not exist.
//
// IT CANNOT SWITCH MODES
// ----------------------
// The mode control drawn on step 3 is a picture: aria-hidden, no handlers.
// Entering Real still happens through the header control and still routes
// through ModeProvider's confirmation dialog — this explains that flow, it
// does not shortcut it. "Start Playing" closes the tour and nothing else.

import { useEffect, useRef, useState } from "react";
import { Wallet } from "lucide-react";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { useSolBalance } from "@/hooks/useSolBalance";
import { formatBalanceSol, formatBalanceUsd } from "@/lib/compactBalance";
import {
  formatUsd,
  playClient,
  toCents,
  type PlayLeaderboardRowView,
  type PlayLeaderboardView,
} from "@/lib/playClient";

const STEP_COUNT = 3;

/* -------------------------------------------------------------------------- */
/*  Formatting — mirrors the Play leaderboard page exactly                     */
/* -------------------------------------------------------------------------- */

function shortAddr(addr: string) {
  if (!addr) return "";
  return addr.length <= 10 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** "+$4,120.00" / "-$310.00" / "$0.00". Sign decided in exact cents. */
function formatProfit(v: string): string {
  const c = toCents(v);
  if (c === null) return "$0.00";
  const body = formatUsd(v, { compact: true });
  return c > BigInt(0) ? `+${body}` : body;
}

function profitTone(v: string): string {
  const c = toCents(v);
  if (c === null || c === BigInt(0)) return "text-gray-400";
  return c > BigInt(0) ? "text-pump-green" : "text-[#ff5c73]";
}

/** "0.6400" → "64%". */
function formatWinRate(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "—";
}

function displayName(row: PlayLeaderboardRowView): string {
  const u = row.username?.trim();
  return u || shortAddr(row.wallet_address);
}

/* -------------------------------------------------------------------------- */
/*  Rank tints — the restrained metals the leaderboard already uses            */
/* -------------------------------------------------------------------------- */

const RANK_TINT: Record<number, string> = {
  1: "border-[#f5c451]/45 bg-[#f5c451]/[0.12] text-[#f5c451]",
  2: "border-[#cbd5e1]/35 bg-[#cbd5e1]/10 text-[#cbd5e1]",
  3: "border-[#cd7f32]/45 bg-[#cd7f32]/[0.14] text-[#d08b45]",
};

const RING_TINT: Record<number, string> = {
  1: "border-[#f5c451]/45",
  2: "border-[#cbd5e1]/35",
  3: "border-[#cd7f32]/50",
};

/* -------------------------------------------------------------------------- */
/*  Small shared pieces                                                        */
/* -------------------------------------------------------------------------- */

function WalletGlyph({ tone }: { tone: "play" | "real" }) {
  return (
    <Wallet
      aria-hidden="true"
      strokeWidth={2.25}
      className={`h-3.5 w-3.5 shrink-0 md:h-4 md:w-4 ${
        tone === "play" ? "text-pump-green" : "text-white"
      }`}
    />
  );
}

/**
 * A drawing of the header control, not the control. No handlers, no mode
 * state, hidden from assistive tech — the real one is in the header behind
 * the confirmation dialog.
 */
function ModeSwitchIllustration({ active }: { active: "play" | "real" }) {
  const seg =
    "inline-flex h-[30px] items-center gap-1.5 rounded-full px-3 text-[11px] font-extrabold uppercase tracking-[0.05em] md:h-8 md:px-3.5 md:text-xs";
  return (
    <div
      aria-hidden="true"
      className="ml-auto inline-flex shrink-0 items-center rounded-full border border-white/[0.13] bg-black p-[3px]"
    >
      <span
        className={`${seg} ${
          active === "play"
            ? "bg-pump-green text-black"
            : "text-gray-400"
        }`}
      >
        Play
      </span>
      <span
        className={`${seg} ${
          active === "real"
            ? "bg-[#101319] text-white ring-1 ring-inset ring-pump-green/55"
            : "text-gray-400"
        }`}
      >
        Real
      </span>
    </div>
  );
}

/** One row of the step-3 illustration: a balance and the mode it belongs to. */
function BalancePreviewRow({
  tone,
  value,
  fallbackLabel,
}: {
  tone: "play" | "real";
  /** Formatted balance, or null when it is not known for this viewer. */
  value: string | null;
  fallbackLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex shrink-0 items-center gap-1.5 md:gap-2">
        <WalletGlyph tone={tone} />
        {value ? (
          <span className="text-base font-extrabold tabular-nums text-white md:text-xl">
            {value}
          </span>
        ) : (
          <span className="text-xs font-semibold uppercase tracking-[0.06em] text-gray-500 md:text-sm">
            {fallbackLabel}
          </span>
        )}
      </span>
      <ModeSwitchIllustration active={tone} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Step 2 — the live Play leaderboard                                         */
/* -------------------------------------------------------------------------- */

function LeaderboardPreview() {
  const [board, setBoard] = useState<PlayLeaderboardView | null>(null);
  const [failed, setFailed] = useState(false);

  // One fetch, for as long as the tour is open. Public route: it works
  // signed out, and it carries `viewer` only when a Play session exists.
  useEffect(() => {
    let cancelled = false;
    playClient
      .leaderboard({ limit: 3 })
      .then((l) => {
        if (!cancelled) setBoard(l);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cell =
    "grid grid-cols-[2.5rem_minmax(0,1fr)_5rem] items-center gap-3 px-3.5 py-2.5 md:grid-cols-[2.5rem_minmax(0,1fr)_6rem_5rem] md:px-4";

  const shell =
    "overflow-hidden rounded-2xl border border-white/10 bg-[#0c0e12]";

  if (failed) {
    return (
      <div className={`${shell} px-4 py-6 text-center text-[13px] text-gray-500`}>
        Standings are unavailable right now.
      </div>
    );
  }

  if (!board) {
    return (
      <div className={shell} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${cell} border-b border-white/5 last:border-b-0`}>
            <span className="h-7 w-7 rounded-lg bg-white/5" />
            <span className="h-3 w-24 rounded bg-white/5" />
            <span className="h-3 justify-self-end rounded bg-white/5 w-14" />
            <span className="hidden h-3 w-10 justify-self-end rounded bg-white/5 md:block" />
          </div>
        ))}
      </div>
    );
  }

  const rows = board.rows.slice(0, 3);
  // Never duplicate the viewer: when they are already in the top three the
  // highlighted row IS their row up there.
  const viewer =
    board.viewer &&
    !rows.some((r) => r.wallet_address === board.viewer?.wallet_address)
      ? board.viewer
      : null;

  if (rows.length === 0) {
    return (
      <div className={`${shell} px-4 py-6 text-center text-[13px] text-gray-500`}>
        The standings open as the first markets settle.
      </div>
    );
  }

  const row = (r: PlayLeaderboardRowView, isViewer: boolean) => (
    <div
      key={`${r.wallet_address}-${isViewer ? "you" : "top"}`}
      className={`${cell} border-b border-white/5 last:border-b-0 ${
        isViewer ? "border-l-2 border-l-pump-green bg-pump-green/[0.06]" : ""
      }`}
    >
      <span
        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold tabular-nums ${
          isViewer
            ? "border-pump-green/50 bg-pump-green/[0.12] text-pump-green"
            : RANK_TINT[r.rank] ?? "border-white/10 bg-white/5 text-gray-300"
        }`}
      >
        {r.rank}
      </span>

      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`h-[26px] w-[26px] shrink-0 overflow-hidden rounded-full border-2 bg-[#0e1116] ${
            isViewer ? "border-pump-green/50" : RING_TINT[r.rank] ?? "border-white/10"
          }`}
        >
          {r.avatar_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.avatar_url} alt="" className="h-full w-full object-cover" />
          )}
        </span>
        <span
          className={`truncate text-[13px] text-white ${
            isViewer ? "font-bold" : "font-semibold"
          }`}
        >
          {isViewer ? "You" : displayName(r)}
        </span>
      </span>

      <span
        className={`justify-self-end text-[13px] font-bold tabular-nums ${profitTone(
          r.realized_pnl_usd
        )}`}
      >
        {formatProfit(r.realized_pnl_usd)}
      </span>

      <span className="hidden justify-self-end text-[13px] tabular-nums text-white/80 md:block">
        {formatWinRate(r.win_rate)}
      </span>
    </div>
  );

  return (
    <div className={shell}>
      <div
        className={`${cell} border-b border-white/[0.07] text-[10px] font-bold uppercase tracking-[0.12em] text-gray-500`}
      >
        <span>Rank</span>
        <span>Player</span>
        <span className="justify-self-end">Profit</span>
        <span className="hidden justify-self-end md:block">Win rate</span>
      </div>
      {rows.map((r) => row(r, r.wallet_address === board.viewer?.wallet_address))}
      {viewer && row(viewer, true)}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The tour                                                                   */
/* -------------------------------------------------------------------------- */

export default function FunMarketOnboarding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const play = usePlaySession();
  const { connected } = useFunMarketWallet();

  // Only step 3 shows a SOL figure, so only step 3 pays for reading it.
  const sol = useSolBalance({ enabled: connected && step === 2 });

  const [startingBankroll, setStartingBankroll] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    playClient
      .settings()
      .then(({ startingBankrollUsd }) => {
        if (!cancelled) setStartingBankroll(startingBankrollUsd);
      })
      .catch(() => {
        /* no amount rather than a guessed one */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // The viewer's own Play balance, when they have one. Someone replaying the
  // tour from "How it works" should see their header's number, not the grant
  // they were credited on day one.
  const ownPlayBalance =
    play.authenticated && play.balanceUsd !== null
      ? formatBalanceUsd(play.balanceUsd)
      : null;

  const grant = startingBankroll ? formatBalanceUsd(startingBankroll) : null;
  const heroAmount = ownPlayBalance ?? grant;
  const heroHeadline = ownPlayBalance
    ? `You have ${ownPlayBalance} in Play`
    : grant
    ? `Start with ${grant} in Play`
    : "Start with virtual funds in Play";

  const solBalance = connected ? formatBalanceSol(sol.lamports) : null;

  const isLast = step === STEP_COUNT - 1;
  const next = () => (isLast ? onClose() : setStep((s) => s + 1));

  return (
    <div
      className="fixed inset-0 z-[190] flex bg-black md:items-center md:justify-center md:bg-black/80 md:p-6 md:backdrop-blur-sm"
      // On desktop the scrim is a dismissal, like Escape. On mobile the sheet
      // is the whole screen, so there is no scrim to hit.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fm-onboarding-title"
        className="flex h-full w-full flex-col md:h-auto md:max-h-[92vh] md:w-full md:max-w-[560px] md:overflow-y-auto md:rounded-[20px] md:border md:border-gray-800 md:bg-[#0d0d0d] md:shadow-2xl"
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* Progress + skip */}
        <div className="flex items-center justify-between px-5 pt-[18px] md:px-[22px]">
          <div className="flex gap-1.5">
            {Array.from({ length: STEP_COUNT }).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                aria-current={i === step}
                className={`h-1 w-7 rounded-sm transition-colors ${
                  i === step
                    ? "bg-pump-green"
                    : i < step
                    ? "bg-pump-green/45"
                    : "bg-gray-800"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-semibold text-gray-500 transition hover:text-gray-300"
          >
            Skip
          </button>
        </div>

        {/* Steps */}
        <div className="flex flex-1 flex-col justify-center gap-5 px-6 py-6 md:flex-none md:justify-start md:gap-[18px] md:px-[30px] md:pb-1 md:pt-[26px]">
          {step === 0 && (
            <>
              <span className="inline-flex w-fit items-center gap-[7px] rounded-full border border-pump-green/40 bg-pump-green/[0.08] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-pump-green">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-pump-green" />
                Play mode
              </span>

              <div>
                {heroAmount && (
                  <div className="text-[clamp(40px,13vw,64px)] font-black leading-none tracking-[-0.03em] tabular-nums text-white md:text-[76px] md:tracking-[-0.035em]">
                    {heroAmount}
                  </div>
                )}
                <h2
                  id="fm-onboarding-title"
                  className={`text-[26px] font-extrabold leading-tight text-white ${
                    heroAmount ? "mt-3.5" : ""
                  }`}
                >
                  {heroHeadline}
                </h2>
              </div>

              <p className="max-w-[300px] text-[15px] leading-[1.55] text-gray-400 md:max-w-[400px]">
                Trade real markets with virtual funds. No deposit, no risk.
              </p>

              {heroAmount && (
                <div className="flex w-fit items-center gap-2 rounded-full border border-white/10 bg-pump-dark px-3.5 py-2">
                  <WalletGlyph tone="play" />
                  <span className="text-[15px] font-extrabold tabular-nums text-white">
                    {heroAmount}
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.06em] text-gray-600">
                    in your header
                  </span>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <h2
                  id="fm-onboarding-title"
                  className="text-[34px] font-black leading-[1.1] tracking-[-0.02em] text-white md:text-[38px] md:tracking-[-0.025em]"
                >
                  Play. Win. Climb.
                </h2>
                <p className="mt-3 text-[15px] leading-[1.55] text-gray-400">
                  Build your bankroll, climb the leaderboard and compete for real
                  prizes.
                </p>
              </div>

              <LeaderboardPreview />

              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#f5c451]/30 bg-[#f5c451]/[0.08] px-2.5 py-1.5 text-[11px] font-bold text-[#f5c451]">
                <span aria-hidden="true">🏆</span> Compete for real prizes
              </span>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <h2
                  id="fm-onboarding-title"
                  className="text-[34px] font-black leading-[1.15] tracking-[-0.02em] text-white md:text-[38px] md:leading-[1.1] md:tracking-[-0.025em]"
                >
                  Ready to go real?
                </h2>
                <p className="mt-3 text-[15px] leading-[1.55] text-gray-400">
                  Switch to REAL anytime to trade with real funds and real
                  winnings.
                </p>
              </div>

              <div className="flex flex-col gap-3.5 rounded-2xl border border-white/10 bg-pump-dark p-4 md:p-[18px]">
                <BalancePreviewRow
                  tone="play"
                  value={ownPlayBalance}
                  fallbackLabel="Play balance"
                />
                <div className="flex items-center gap-2.5 pl-1">
                  <span aria-hidden="true" className="text-base text-pump-green">
                    ↓
                  </span>
                  <span className="text-[11px] uppercase tracking-[0.06em] text-gray-500">
                    the balance follows the mode
                  </span>
                </div>
                <BalancePreviewRow
                  tone="real"
                  value={solBalance}
                  fallbackLabel="Real balance"
                />
              </div>

              <p className="text-[13px] leading-[1.55] text-gray-500">
                Your Play balance stays separate. Switch back anytime.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2.5 px-5 pb-6 md:flex-row md:items-center md:gap-4 md:px-[30px] md:pb-[26px] md:pt-[22px]">
          <button
            type="button"
            onClick={next}
            className={`flex h-[52px] w-full items-center justify-center rounded-[14px] bg-pump-green text-[15px] font-extrabold text-black transition hover:opacity-90 md:h-12 md:w-auto md:px-[26px] ${
              isLast ? "shadow-[0_6px_24px_rgba(0,255,136,0.22)]" : ""
            }`}
          >
            {isLast ? "Start Playing" : "Next"}
          </button>

          {isLast && (
            <button
              type="button"
              onClick={onClose}
              className="text-center text-[13px] font-semibold text-gray-500 transition hover:text-gray-300"
            >
              Maybe later
            </button>
          )}

          <span className="hidden text-xs text-gray-600 md:ml-auto md:block">
            Step {step + 1} of {STEP_COUNT}
          </span>
        </div>
      </div>
    </div>
  );
}
