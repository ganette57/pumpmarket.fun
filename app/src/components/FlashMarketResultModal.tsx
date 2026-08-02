"use client";

// src/components/FlashMarketResultModal.tsx
//
// The market result experience — win, loss and refund, in Play and in Real.
//
// It renders ONLY what the caller proved. Every monetary field is optional and
// a missing one is dropped rather than defaulted, because a zero here would be
// a lie about somebody's money. See src/lib/resultCard.ts for the model and
// the payout wording rules.
//
// The share preview is the exact PNG that gets shared: one canvas renderer
// feeds both, so the preview can never drift from the exported card.

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  buildResultCardView,
  type ResultCardInput,
  type ResultCurrency,
  type ResultMode,
  type ResultState,
  type PayoutQualifier,
} from "@/lib/resultCard";
import { CARD_HEIGHT, CARD_WIDTH } from "@/lib/resultCardImage";
import { useResultCardShare } from "@/components/result/useResultCardShare";

/**
 * Kept as the historical name/type so existing imports stay valid; "refund"
 * is new alongside the original win/lose pair.
 */
export type FlashMarketResultState = ResultState;

export type FlashMarketResultModalProps = {
  open: boolean;
  result: FlashMarketResultState;
  onClose: () => void;

  mode?: ResultMode;
  currency?: ResultCurrency;

  marketTitle?: string | null;
  /** The outcome the user backed. */
  pickLabel?: string | null;
  /** The outcome the market settled on. */
  outcomeLabel?: string | null;
  secondaryText?: string | null;

  /** Exact decimal strings — never floats, never guessed. */
  stake?: string | null;
  payout?: string | null;
  profit?: string | null;
  payoutQualifier?: PayoutQualifier | null;
  claimAvailable?: boolean;

  /** Public path for the shared URL, e.g. "/trade/<address>". */
  marketPath?: string | null;

  /** Optional extra action. Rendered only when provided. */
  onNextMarket?: (() => void) | null;
  nextMarketLabel?: string;
  /** Where a Real claim is performed. Claiming itself is unchanged. */
  claimHref?: string;

  /** Legacy prop, still honoured by Real Live callers. */
  winningShares?: number | null;
};

const CARD_ASPECT = `${CARD_WIDTH} / ${CARD_HEIGHT}`;

export default function FlashMarketResultModal({
  open,
  result,
  onClose,
  mode = "real",
  currency,
  marketTitle = null,
  pickLabel = null,
  outcomeLabel = null,
  secondaryText = "Market finalized.",
  stake = null,
  payout = null,
  profit = null,
  payoutQualifier = null,
  claimAvailable = false,
  marketPath = null,
  onNextMarket = null,
  nextMarketLabel = "Next market",
  claimHref = "/dashboard",
  winningShares = null,
}: FlashMarketResultModalProps) {
  const resolvedCurrency: ResultCurrency = currency ?? (mode === "play" ? "usd" : "sol");

  const view = useMemo(() => {
    if (!open) return null;
    const input: ResultCardInput = {
      mode,
      state: result,
      marketTitle,
      // A win means the pick WAS the winning outcome; callers that only know
      // the settled outcome still get a correct Pick row that way.
      pickLabel: pickLabel ?? (result === "win" ? outcomeLabel : null),
      winningOutcomeLabel: outcomeLabel,
      marketResultText: secondaryText,
      currency: resolvedCurrency,
      stake,
      payout,
      profit,
      payoutQualifier,
      claimAvailable,
      marketPath,
    };
    return buildResultCardView(input);
  }, [
    open,
    mode,
    result,
    marketTitle,
    pickLabel,
    outcomeLabel,
    secondaryText,
    resolvedCurrency,
    stake,
    payout,
    profit,
    payoutQualifier,
    claimAvailable,
    marketPath,
  ]);

  const share = useResultCardShare(view);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const primaryActionRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);

  /** Escape closes — but never while the native share sheet is open. */
  const requestClose = useCallback(() => {
    if (share.sharing) return;
    onClose();
  }, [share.sharing, onClose]);

  /**
   * Focus restoration lives in a cleanup, not in an "open === false" effect:
   * most callers unmount the modal to close it, so an effect body would never
   * run. A cleanup fires on unmount too.
   */
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    previouslyFocusedRef.current = opener;
    return () => {
      if (opener && typeof opener.focus === "function") {
        opener.focus({ preventScroll: true });
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // preventScroll matters: the dialog is overflow-hidden but still
    // programmatically scrollable, so a plain focus() on the footer button
    // scrolls the header out of view the instant the modal opens.
    const focusTimer = window.setTimeout(
      () => primaryActionRef.current?.focus({ preventScroll: true }),
      0
    );

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestClose();
        return;
      }
      if (e.key !== "Tab") return;

      // Contain focus inside the dialog.
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, requestClose]);

  if (!open || !view) return null;

  const isWin = view.state === "win";
  const isRefund = view.state === "refund";

  const accentText = isWin
    ? "text-pump-green"
    : isRefund
    ? "text-[#f5c451]"
    : "text-[#ff4d6a]";
  const accentBorder = isWin
    ? "border-pump-green/40"
    : isRefund
    ? "border-[#f5c451]/40"
    : "border-[#ff4d6a]/40";
  const accentChip = isWin
    ? "bg-pump-green/15 text-pump-green ring-pump-green/30"
    : isRefund
    ? "bg-[#f5c451]/15 text-[#f5c451] ring-[#f5c451]/30"
    : "bg-[#ff4d6a]/15 text-[#ff4d6a] ring-[#ff4d6a]/30";

  const primaryToneClass =
    view.primaryTone === "positive"
      ? "text-pump-green"
      : view.primaryTone === "negative"
      ? "text-[#ff4d6a]"
      : "text-white";

  const legacyShares =
    Number.isFinite(Number(winningShares)) && Number(winningShares) > 0
      ? Math.floor(Number(winningShares))
      : null;

  const showClaimAction = mode === "real" && claimAvailable && view.claimNote !== null && isWin;

  return (
    <div
      className="fixed inset-0 z-[320] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close result"
        tabIndex={-1}
        onClick={requestClose}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-modal-title"
        aria-describedby="result-modal-description"
        className={[
          "relative flex w-full max-h-[92dvh] flex-col overflow-hidden rounded-t-3xl border bg-pump-dark",
          "sm:max-w-md sm:rounded-3xl",
          accentBorder,
        ].join(" ")}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-5 sm:px-6 sm:pt-6">
          {/* ── Mode + headline ─────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ring-1 ${accentChip}`}
            >
              {view.modeLabel}
            </span>
            <button
              type="button"
              onClick={requestClose}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-gray-400 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              Close
            </button>
          </div>

          <h2
            id="result-modal-title"
            className={`mt-4 text-3xl font-black leading-none tracking-tight sm:text-4xl ${accentText}`}
          >
            {view.headline}
          </h2>

          <p id="result-modal-description" className="mt-2 break-words text-sm text-gray-300">
            {view.marketTitle}
          </p>

          {/* ── Primary number ──────────────────────────────────────── */}
          {view.primaryValue ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/40 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                {view.primaryLabel}
              </p>
              {/* Fluid rather than stepped: a seven-figure Play profit has to
                  stay on one line at 320px without shrinking small values. */}
              <p
                className={`mt-1 break-words text-[clamp(1.75rem,8.5vw,3rem)] font-black leading-none ${primaryToneClass}`}
              >
                {view.primaryValue}
              </p>
            </div>
          ) : null}

          {/* ── Secondary values ────────────────────────────────────── */}
          {view.rows.length ? (
            <dl className="mt-4 divide-y divide-white/5 rounded-2xl border border-white/10 bg-black/20">
              {view.rows.map((row) => (
                <div
                  key={`${row.label}-${row.value}`}
                  className="flex items-start justify-between gap-4 px-4 py-2.5"
                >
                  <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {row.label}
                  </dt>
                  <dd className="min-w-0 break-words text-right text-sm font-semibold text-white">
                    {row.value}
                  </dd>
                </div>
              ))}
              {legacyShares !== null && !view.rows.some((r) => r.label === "Stake") ? (
                <div className="flex items-start justify-between gap-4 px-4 py-2.5">
                  <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Winning shares
                  </dt>
                  <dd className="text-right text-sm font-semibold text-white">{legacyShares}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {view.claimNote ? (
            <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-300">
              {view.claimNote}
            </p>
          ) : null}

          {view.note ? <p className="mt-3 text-[11px] leading-relaxed text-gray-500">{view.note}</p> : null}

          {/* ── Share card preview ──────────────────────────────────── */}
          <section className="mt-5" aria-label="Shareable result card">
            <div
              className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-black/50"
              style={{ aspectRatio: CARD_ASPECT }}
            >
              {share.imageStatus === "ready" && share.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={share.imageUrl}
                  alt={`${view.modeLabel}: ${view.headline} — ${view.marketTitle}`}
                  className="h-full w-full object-contain"
                />
              ) : share.imageStatus === "error" ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <p className="text-xs text-gray-400">
                    {share.imageError || "The result card could not be generated."}
                  </p>
                  <button
                    type="button"
                    onClick={share.retry}
                    className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-bold text-white transition hover:border-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="text-xs text-gray-500">Generating result card…</span>
                </div>
              )}
            </div>

            <p aria-live="polite" className="sr-only">
              {share.statusMessage ?? ""}
            </p>
            {share.statusMessage && share.actionStatus !== "idle" ? (
              <p className="mt-2 text-[11px] text-gray-400">{share.statusMessage}</p>
            ) : null}
          </section>
        </div>

        {/* ── Actions ───────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-white/10 bg-pump-dark/95 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-5">
          <div className="flex flex-col gap-2">
            <button
              ref={primaryActionRef}
              type="button"
              onClick={() => void share.shareResult()}
              disabled={share.actionStatus === "working"}
              className={[
                "w-full rounded-xl px-4 py-3 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
                "disabled:cursor-not-allowed disabled:opacity-60",
                isWin
                  ? "bg-pump-green text-black hover:bg-[#74ffb8]"
                  : "bg-white text-black hover:bg-gray-200",
              ].join(" ")}
            >
              {share.actionStatus === "working" ? "Preparing…" : "Share result"}
            </button>

            <button
              type="button"
              onClick={() => void share.shareOnX()}
              disabled={share.actionStatus === "working"}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/20 px-4 py-3 text-sm font-bold text-white transition hover:border-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Share on X
            </button>

            {showClaimAction ? (
              <Link
                href={claimHref}
                className="w-full rounded-xl border border-pump-green/40 px-4 py-3 text-center text-sm font-bold text-pump-green transition hover:border-pump-green focus:outline-none focus-visible:ring-2 focus-visible:ring-pump-green"
              >
                Claim winnings
              </Link>
            ) : null}

            {onNextMarket ? (
              <button
                type="button"
                onClick={onNextMarket}
                className="w-full rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-gray-200 transition hover:border-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                {isWin || isRefund ? nextMarketLabel : "Try another market"}
              </button>
            ) : null}

            <button
              type="button"
              onClick={requestClose}
              className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-400 transition hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              {onNextMarket ? "Close" : "Continue"}
            </button>

            <div className="flex items-center justify-center gap-4 pt-1">
              <button
                type="button"
                onClick={share.saveCard}
                disabled={share.imageStatus !== "ready"}
                className="text-[11px] font-semibold text-gray-500 underline-offset-2 transition hover:text-gray-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save result card
              </button>
              <button
                type="button"
                onClick={() => void share.copyPostText()}
                className="text-[11px] font-semibold text-gray-500 underline-offset-2 transition hover:text-gray-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                Copy post text
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
