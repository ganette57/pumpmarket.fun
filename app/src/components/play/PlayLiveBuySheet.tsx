"use client";

// src/components/play/PlayLiveBuySheet.tsx
//
// The PLAY variant of the Live Quick Trade bottom sheet.
//
// This is NOT a redesign. It reuses the EXACT shell of
// LiveMobileContent's <MobileBuySheet>: the same fixed overlay, backdrop,
// slide-up sheet, drag handle, preset row, outcome selector, primary CTA and
// Close button, the same `keepNavbar` bottom offset and the same body-scroll
// lock. The Real MobileBuySheet is left completely untouched — the Live pages
// render THIS sheet only when mode === "play" and the Real one otherwise.
//
// Play differences, all functional (never visual):
//   * USD virtual money, presets $5 / $10 / $100 + custom amount
//   * Buy only
//   * quote via /api/play/quote, execution via /api/play/trade
//   * one wallet signature the first time a Play session is needed, none after
//   * NO Solana transaction, ever
//   * Play balance + "to win" estimate
//
// Reuses PlaySessionProvider / playClient / MarketSnapshotProvider. No new
// session system, no new store, no Real code path.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { useMarketSnapshotActions } from "@/components/mode/MarketSnapshotProvider";
import { PlayApiError, formatUsd, playClient, toCents } from "@/lib/playClient";

const PRESETS = [5, 10, 100];

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(Number(n) || 0)));
}

export default function PlayLiveBuySheet({
  open,
  onClose,
  marketAddress,
  outcomeNames,
  defaultOutcomeIndex,
  sessionLocked,
  playStatus,
  quoteRevision = "",
  keepNavbar,
  onTraded,
}: {
  open: boolean;
  onClose: () => void;
  marketAddress: string;
  outcomeNames: string[];
  defaultOutcomeIndex?: number;
  /** Real session lock (locked / ended / disabled …). */
  sessionLocked: boolean;
  /** Play market status; anything but "open" blocks trading. */
  playStatus?: string;
  /** Current authoritative market snapshot identity; activity re-quotes. */
  quoteRevision?: string;
  keepNavbar?: boolean;
  /** Fires after a successful Play trade so the page can show its own toast. */
  onTraded?: (info: {
    outcomeName: string;
    shares: number;
    stakeUsd: string;
  }) => void;
}) {
  const play = usePlaySession();
  const { invalidate: invalidateSnapshot } = useMarketSnapshotActions();

  const names = useMemo(() => {
    const list = (outcomeNames || []).map(String).filter(Boolean);
    return list.length >= 2 ? list.slice(0, 4) : ["YES", "NO"];
  }, [outcomeNames]);

  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const [custom, setCustom] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ payout: string; multiple: string | null } | null>(
    null
  );
  const inFlightRef = useRef(false);
  // Stale-quote guard: bumped on every input change; a response is applied
  // only while its epoch is still current.
  const quoteEpochRef = useRef(0);

  const closed =
    sessionLocked || (playStatus != null && playStatus !== "open");

  // Reset all input/quote state on (re)open — mirrors MobileBuySheet, and
  // guarantees a mode switch (which unmounts the Real sheet and mounts this
  // one) starts clean: no carried amount, no stale quote.
  useEffect(() => {
    if (!open) return;
    setSelectedOutcome(
      clampInt(defaultOutcomeIndex ?? 0, 0, Math.max(names.length - 1, 0))
    );
    setAmount(0);
    setCustom("");
    setError(null);
    setQuote(null);
  }, [open, defaultOutcomeIndex, names.length]);

  // Body scroll lock — identical to MobileBuySheet.
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const effectiveAmount = useMemo(() => {
    if (custom.trim() !== "") {
      const n = Number(custom);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    return amount;
  }, [custom, amount]);

  const stakeString = useMemo(() => {
    if (effectiveAmount <= 0) return null;
    const s = effectiveAmount.toFixed(2);
    return /^\d{1,12}(\.\d{1,2})?$/.test(s) ? s : null;
  }, [effectiveAmount]);

  const insufficient = useMemo(() => {
    if (!stakeString || play.balanceUsd === null) return false;
    const need = toCents(stakeString);
    const have = toCents(play.balanceUsd);
    return need !== null && have !== null && need > have;
  }, [stakeString, play.balanceUsd]);

  // Load balance for the connected session so the sheet shows it immediately.
  useEffect(() => {
    if (open && play.authenticated) void play.refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, play.authenticated]);

  /* ---- live quote (informational; execution re-prices under a lock) ---- */
  useEffect(() => {
    quoteEpochRef.current += 1;
    const epoch = quoteEpochRef.current;
    // A changed market revision must never leave the previous multiplier on
    // screen while the replacement request is in flight.
    setQuote(null);

    if (!open || closed || !play.authenticated || !stakeString) {
      return;
    }
    const t = setTimeout(() => {
      playClient
        .quote({
          marketAddress,
          outcomeIndex: selectedOutcome,
          stakeUsd: stakeString,
        })
        .then((q) => {
          if (epoch !== quoteEpochRef.current) return; // stale — drop
          setQuote({
            payout: q.estimated_payout_usd,
            multiple: q.estimated_multiple,
          });
        })
        .catch(() => {
          if (epoch === quoteEpochRef.current) setQuote(null);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [open, play.authenticated, stakeString, selectedOutcome, marketAddress, closed, quoteRevision]);

  const handleBuy = useCallback(async () => {
    if (closed || !stakeString || submitting || inFlightRef.current) return;
    const outcome = clampInt(selectedOutcome, 0, names.length - 1);
    const outcomeName = names[outcome] || `Outcome #${outcome + 1}`;

    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const ok = await play.ensureSession();
      if (!ok) {
        setError(play.error || "Play session required.");
        return;
      }
      const res = await playClient.trade({
        marketAddress,
        outcomeIndex: outcome,
        stakeUsd: stakeString,
        clientTradeId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      play.applyBalance(res.balance_usd);
      invalidateSnapshot("play", marketAddress); // refresh Play odds + volume
      void play.refreshState();
      onTraded?.({
        outcomeName,
        shares: Math.max(0, Number(res.trade?.shares) || 0),
        stakeUsd: res.trade?.stake_usd ?? stakeString,
      });
      onClose();
    } catch (e) {
      if (e instanceof PlayApiError) {
        setError(
          e.needsSession
            ? "Your Play session expired. Tap Buy again to re-enable Play."
            : e.message
        );
        if (e.needsSession) void play.refreshState();
      } else {
        setError("Trade failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    closed,
    stakeString,
    submitting,
    selectedOutcome,
    names,
    play,
    marketAddress,
    invalidateSnapshot,
    onTraded,
    onClose,
  ]);

  if (!open) return null;

  const bottomClass = keepNavbar ? "bottom-14" : "bottom-0";

  const needsSession = !play.authenticated;
  const busy = submitting || play.authenticating;
  const ctaDisabled = closed || busy || (!needsSession && (!stakeString || insufficient));

  const ctaLabel = (() => {
    if (busy) return play.authenticating ? "Enabling Play…" : "Submitting...";
    if (needsSession && effectiveAmount <= 0) return play.signInLabel;
    if (insufficient) return "Insufficient balance";
    const name = String(names[selectedOutcome] || "SHARES").toUpperCase();
    if (effectiveAmount <= 0) return `Buy ${name}`;
    return `Buy ${name} · ${formatUsd(effectiveAmount.toFixed(2), { compact: true })}`;
  })();

  const onCta = () => {
    if (needsSession && effectiveAmount <= 0) return void play.ensureSession();
    return void handleBuy();
  };

  const isRed = names.length === 2 && selectedOutcome === 1;

  return (
    <div className="fixed inset-0 z-[200]">
      {/* Backdrop */}
      <button
        className={`absolute inset-x-0 top-0 ${bottomClass} bg-black/60`}
        onClick={onClose}
        aria-label="Close"
      />

      {/* Sheet */}
      <div
        className={`absolute ${bottomClass} inset-x-0 bg-pump-dark border-t border-gray-800 rounded-t-2xl p-5 pb-8 animate-slideUp`}
      >
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full bg-gray-600 mx-auto mb-4" />

        {closed ? (
          <div className="text-center py-4">
            <p className="text-gray-400 text-sm">
              {playStatus && playStatus !== "open"
                ? "This Play market has settled. Trading is closed."
                : "Trading is currently locked for this session."}
            </p>
            <button
              onClick={onClose}
              className="mt-4 w-full py-3 rounded-xl bg-gray-700 text-white font-semibold"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* Amount presets — Play balance beside the label */}
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-400">Amount</p>
              {play.authenticated && play.balanceUsd !== null && (
                <p className="text-xs text-gray-500">
                  Balance{" "}
                  <span className="text-gray-300 font-semibold">
                    {formatUsd(play.balanceUsd)}
                  </span>
                </p>
              )}
            </div>
            <div className="flex gap-2 mb-3">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setCustom("");
                    setAmount(p);
                  }}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
                    custom.trim() === "" && amount === p
                      ? "border-pump-green bg-pump-green/10 text-pump-green"
                      : "border-gray-700 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  ${p}
                </button>
              ))}
            </div>

            {/* Custom amount */}
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={custom || (amount > 0 ? String(amount) : "")}
              onChange={(e) => {
                setCustom(e.target.value);
                setAmount(0);
              }}
              placeholder="Custom amount (USD)"
              className="w-full mb-4 rounded-xl bg-pump-dark border border-gray-700 px-3 py-2.5 text-white text-sm outline-none focus:border-pump-green [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />

            {effectiveAmount === 0 && (
              <div className="mb-4 rounded-lg bg-pump-dark/80 border border-gray-800 p-3 text-center">
                <p className="text-xs text-gray-400">Select an amount to trade.</p>
              </div>
            )}

            {/* Outcome selector — identical structure to MobileBuySheet */}
            {names.length > 0 && (
              <>
                <p className="text-sm text-gray-400 mb-2">Outcome</p>
                <div className="flex gap-2 mb-4">
                  {names.map((name, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedOutcome(idx)}
                      className={`flex-1 py-3 rounded-xl text-sm font-semibold border transition text-center ${
                        selectedOutcome === idx
                          ? idx === 0
                            ? "border-pump-green bg-pump-green/10 text-pump-green"
                            : "border-[#ff5c73] bg-[#ff5c73]/10 text-[#ff5c73]"
                          : "border-gray-700 text-gray-300 hover:border-gray-600"
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* To win — Play "if resolved now" estimate */}
            {quote && !insufficient && effectiveAmount > 0 && (
              <div className="mb-4 flex items-center justify-between rounded-xl bg-pump-dark/80 border border-gray-800 px-4 py-3">
                <span className="text-sm text-gray-400">
                  To win{" "}
                  <span className="text-[11px] text-gray-500">(if resolved now)</span>
                </span>
                <span className="flex items-baseline gap-2">
                  <span className="text-base font-bold text-white tabular-nums">
                    {formatUsd(quote.payout)}
                  </span>
                  {quote.multiple && (
                    <span
                      className={`text-sm font-extrabold ${
                        isRed ? "text-[#ff5c73]" : "text-pump-green"
                      }`}
                    >
                      {Number(quote.multiple).toFixed(2)}x
                    </span>
                  )}
                </span>
              </div>
            )}

            {error && <p className="mb-3 text-red-400 text-xs text-center">{error}</p>}

            {/* Primary CTA */}
            <button
              disabled={ctaDisabled}
              onClick={onCta}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                ctaDisabled
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : isRed
                  ? "bg-[#ff5c73] text-black hover:bg-[#ff7c90]"
                  : "bg-pump-green text-black hover:bg-[#74ffb8]"
              }`}
            >
              {ctaLabel}
            </button>

            <button
              onClick={onClose}
              className="w-full mt-2 py-3 rounded-xl bg-gray-800 text-white font-semibold"
            >
              Close
            </button>

            <p className="mt-3 text-center text-[11px] text-gray-500">
              Play money · no real funds.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
