"use client";

// src/components/PlayTradingPanel.tsx
//
// The PLAY variant of the Market Detail TradingPanel.
//
// This is NOT a redesign and NOT a second visual language: it reuses the
// exact card shape, header, outcome selector, amount block, summary box,
// button styles, spacing and drawer/desktop layout classes of
// components/TradingPanel.tsx, so the two modes look the same. The Real
// TradingPanel is left completely untouched — the page renders THIS
// component only when mode === "play", and the Real one otherwise.
//
// Play differences, all functional (never visual):
//   * USD virtual money, presets $5 / $10 / $100 + custom amount
//   * Buy only (no Sell toggle in the MVP)
//   * quote via /api/play/quote, execution via /api/play/trade
//   * one wallet signature the first time a Play session is needed, none after
//   * balance + open Play position for this market
//
// Reuses the existing ModeProvider / PlaySessionProvider / playClient /
// MarketSnapshotProvider. No new session system, no new store.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { useMarketSnapshotActions } from "@/components/mode/MarketSnapshotProvider";
import {
  PlayApiError,
  formatUsd,
  playClient,
  toCents,
  type PlayOpenTrade,
} from "@/lib/playClient";

type PanelLayout = "desktop" | "drawer";

interface PlayTradingPanelProps {
  marketAddress: string;
  outcomeNames: string[];
  layout?: PanelLayout;
  defaultOutcomeIndex?: number;
  onClose?: () => void;
  title?: string;
  /** Play market status; anything but "open" shows a non-trading state. */
  playStatus?: string;
  marketClosed?: boolean;
  marketClosedTitle?: string;
  marketClosedMessage?: string;
}

const PRESETS = [5, 10, 100];
const TERMS_URL = "https://funmarket.gitbook.io/funmarket/terms-of-use";

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default function PlayTradingPanel({
  marketAddress,
  outcomeNames,
  layout = "desktop",
  defaultOutcomeIndex = 0,
  onClose,
  title = "Trade",
  playStatus,
  marketClosed,
  marketClosedTitle = "Trading locked",
  marketClosedMessage = "Trading is temporarily locked. It will resume or close at the scheduled end time.",
}: PlayTradingPanelProps) {
  const play = usePlaySession();
  const { invalidate: invalidateSnapshot } = useMarketSnapshotActions();

  const outcomes = useMemo(() => {
    const names = (outcomeNames || []).map(String).filter(Boolean);
    return names.length >= 2 ? names.slice(0, 10) : ["YES", "NO"];
  }, [outcomeNames]);

  const isBinaryStyle = outcomes.length === 2;

  const [selectedIndex, setSelectedIndex] = useState(
    clampInt(defaultOutcomeIndex, 0, outcomes.length - 1)
  );
  const [amount, setAmount] = useState<number>(0);
  const [custom, setCustom] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [quote, setQuote] = useState<{
    shares: string;
    payout: string;
    multiple: string | null;
    probsAfter: string[];
  } | null>(null);
  const [openTrades, setOpenTrades] = useState<PlayOpenTrade[]>([]);
  const inFlightRef = useRef(false);
  // Stale-quote guard: every fetch captures this; a response is applied only
  // if its epoch is still current. Bumped on every input/outcome change.
  const quoteEpochRef = useRef(0);

  useEffect(() => {
    setSelectedIndex((i) => clampInt(i, 0, outcomes.length - 1));
  }, [outcomes.length]);

  useEffect(() => {
    setSelectedIndex(clampInt(defaultOutcomeIndex, 0, outcomes.length - 1));
  }, [defaultOutcomeIndex, outcomes.length]);

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

  const closed = !!marketClosed || (playStatus != null && playStatus !== "open");

  /** Load balance + this market's open Play position. */
  const refreshState = useCallback(async () => {
    if (!play.authenticated) return;
    try {
      const s = await playClient.state(marketAddress);
      play.applyBalance(s.account.balance_usd);
      setOpenTrades(
        (s.open_trades || []).filter((t) => t.market_address === marketAddress)
      );
    } catch {
      /* leave prior values; never fall back to Real */
    }
  }, [play, marketAddress]);

  useEffect(() => {
    void refreshState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play.authenticated, marketAddress]);

  /* ---- live quote (informational; execution re-prices under a lock) ---- */
  useEffect(() => {
    quoteEpochRef.current += 1;
    const epoch = quoteEpochRef.current;

    if (closed || !play.authenticated || !stakeString) {
      setQuote(null);
      return;
    }
    const t = setTimeout(() => {
      playClient
        .quote({ marketAddress, outcomeIndex: selectedIndex, stakeUsd: stakeString })
        .then((q) => {
          if (epoch !== quoteEpochRef.current) return; // stale — drop
          setQuote({
            shares: q.shares,
            payout: q.estimated_payout_usd,
            multiple: q.estimated_multiple,
            probsAfter: q.implied_probs_after,
          });
        })
        .catch(() => {
          if (epoch === quoteEpochRef.current) setQuote(null);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [play.authenticated, stakeString, selectedIndex, marketAddress, closed]);

  const position = useMemo(() => {
    // Aggregate the user's open Play trades on the selected outcome.
    let stake = 0;
    let shares = 0;
    for (const t of openTrades) {
      if (t.outcome_index !== selectedIndex) continue;
      stake += Number(t.stake_usd) || 0;
      shares += Number(t.shares) || 0;
    }
    return { stake, shares };
  }, [openTrades, selectedIndex]);

  const handleBuy = useCallback(async () => {
    if (closed || !stakeString || submitting || inFlightRef.current) return;
    const outcome = clampInt(selectedIndex, 0, outcomes.length - 1);

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
      await refreshState(); // refresh position + balance
      setSuccess(true);
      setAmount(0);
      setCustom("");
      setTimeout(() => setSuccess(false), 1600);
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
    selectedIndex,
    outcomes.length,
    play,
    marketAddress,
    invalidateSnapshot,
    refreshState,
  ]);

  const needsSession = !play.authenticated;
  const busy = submitting || play.authenticating;
  const ctaDisabled =
    closed || busy || (!needsSession && (!stakeString || insufficient));

  const ctaLabel = (() => {
    if (busy) return play.authenticating ? "Enabling Play…" : "Submitting...";
    if (success) return "Done!";
    if (needsSession && effectiveAmount <= 0) return play.signInLabel;
    if (insufficient) return "Insufficient balance";
    const name = String(outcomes[selectedIndex] || "SHARES").toUpperCase();
    if (effectiveAmount <= 0) return `Buy ${name}`;
    return `Buy ${name} · ${formatUsd(effectiveAmount.toFixed(2), { compact: true })}`;
  })();

  const onCtaClick = () => {
    if (needsSession && effectiveAmount <= 0) return void play.ensureSession();
    return void handleBuy();
  };

  const isRed = isBinaryStyle && selectedIndex === 1;

  // ---- Non-trading state (visual parity with TradingPanel marketClosed) ----
  if (closed) {
    return (
      <div className={layout === "drawer" ? "h-full flex flex-col" : "card-pump"}>
        <div className="text-center py-8 px-4">
          <div className="text-gray-400 text-sm font-semibold">{marketClosedTitle}</div>
          <p className="text-gray-500 text-xs mt-1">
            {playStatus && playStatus !== "open"
              ? "This Play market has settled. Trading is closed."
              : marketClosedMessage}
          </p>
        </div>
      </div>
    );
  }

  const rootClass = layout === "drawer" ? "h-full flex flex-col" : "card-pump";

  return (
    <div className={rootClass}>
      {layout === "drawer" && (
        <div className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-pump-dark/95 backdrop-blur border-b border-gray-800">
          <div className="text-white font-bold text-lg">{title}</div>
          {onClose && (
            <button
              onClick={onClose}
              className="h-9 w-9 rounded-full border border-gray-800 bg-pump-dark/60 text-gray-200"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div className={layout === "drawer" ? "px-4 pb-2 pt-3 flex-1 overflow-y-auto" : ""}>
        {/* Outcome pick — identical structure to TradingPanel */}
        {isBinaryStyle ? (
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[0, 1].map((i) => {
              const selected = selectedIndex === i;
              const red = i === 1;
              const baseClass = red
                ? "bg-[#ff5c73]/10 text-[#ff5c73] border border-[#ff5c73]/40 hover:bg-[#ff5c73]/20"
                : "bg-pump-green/10 text-pump-green border border-pump-green/40 hover:bg-pump-green/20";
              const activeClass = red
                ? "bg-[#ff5c73] text-black shadow-lg"
                : "bg-pump-green text-black shadow-lg";
              const pct = quote
                ? Number(quote.probsAfter[i]) * 100
                : null;
              return (
                <button
                  key={i}
                  onClick={() => setSelectedIndex(i)}
                  className={`flex flex-col items-center justify-center py-3 md:py-4 rounded-xl font-bold transition-all ${
                    selected ? activeClass : baseClass
                  }`}
                >
                  <span className="text-sm mb-1">{outcomes[i]}</span>
                  <span className="text-xl md:text-2xl">
                    {pct != null ? `${pct.toFixed(0)}¢` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mb-4">
            <label className="block text-white font-semibold mb-2">Outcome</label>
            <select
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
              className="input-pump w-full"
            >
              {outcomes.map((o, i) => (
                <option key={`${o}-${i}`} value={i}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Amount — presets + custom, Play balance beside the label */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400 mb-1 block">Amount (USD)</label>
            {play.authenticated && play.balanceUsd !== null && (
              <div className="text-xs text-gray-500">
                Balance{" "}
                <span className="text-gray-300 font-semibold">
                  {formatUsd(play.balanceUsd)}
                </span>
              </div>
            )}
          </div>

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
            placeholder="0"
            className="w-full bg-transparent border-none outline-none text-5xl md:text-6xl font-bold text-white tabular-nums text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />

          <div className="flex gap-2 justify-end mt-3">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setCustom("");
                  setAmount(p);
                }}
                className={`px-4 py-2 rounded-lg font-semibold transition text-sm border ${
                  custom.trim() === "" && amount === p
                    ? "border-pump-green text-pump-green bg-pump-dark"
                    : "bg-pump-dark border-gray-700 text-white hover:border-pump-green"
                }`}
              >
                ${p}
              </button>
            ))}
          </div>
        </div>

        {/* Summary box — mirrors TradingPanel "You pay / To win" */}
        <div className="bg-pump-dark rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-400">You pay</div>
            <div
              className={`text-2xl font-extrabold whitespace-nowrap ${
                isRed ? "text-[#ff5c73]" : "text-pump-green"
              }`}
            >
              {effectiveAmount > 0
                ? formatUsd(effectiveAmount.toFixed(2))
                : "$0.00"}
            </div>
          </div>

          {quote && !insufficient && (
            <div className="mt-3 flex items-center justify-between">
              <div className="text-sm text-gray-400">
                To win
                <span className="ml-1 text-[11px] text-gray-500">
                  (if resolved now)
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <div className="text-xl font-bold text-white whitespace-nowrap">
                  {formatUsd(quote.payout)}
                </div>
                {quote.multiple && (
                  <div
                    className={`text-lg font-extrabold ${
                      isRed ? "text-[#ff5c73]" : "text-pump-green"
                    }`}
                  >
                    {Number(quote.multiple).toFixed(2)}x
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Your Play position on this outcome */}
        {position.shares > 0 && (
          <div className="mt-3 text-center p-3 bg-pump-dark rounded-xl">
            <p className="text-gray-400 text-sm">
              Your position:{" "}
              <span className="text-white font-semibold">
                {position.shares.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                shares
              </span>{" "}
              · {formatUsd(position.stake.toFixed(2))} staked
            </p>
          </div>
        )}

        {error && <p className="mt-3 text-red-400 text-xs text-center">{error}</p>}
        {success && (
          <div className="mt-3 flex justify-center animate-fadeIn">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-pump-green/50 bg-pump-green/10 px-3 py-1 text-xs font-semibold text-pump-green">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Trade placed
            </div>
          </div>
        )}
      </div>

      {/* CTA — sticky in drawer, same shell as TradingPanel */}
      <div
        className={
          layout === "drawer"
            ? "sticky bottom-0 z-20 px-4 pb-4 pt-3 bg-pump-dark/80 backdrop-blur border-t border-gray-800"
            : "mt-4"
        }
      >
        <button
          disabled={ctaDisabled}
          onClick={onCtaClick}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            ctaDisabled
              ? "bg-gray-700 text-gray-300 cursor-not-allowed"
              : isBinaryStyle && selectedIndex === 1
              ? "bg-[#ff5c73] hover:bg-[#ff7c90] text-black shadow-lg"
              : "bg-pump-green hover:bg-[#74ffb8] text-black shadow-lg"
          }`}
        >
          {ctaLabel}
        </button>

        <p className="mt-3 text-center text-xs text-gray-500">
          Play money · no real funds. By trading, you agree to the{" "}
          <a
            href={TERMS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-300 underline underline-offset-4 hover:text-white"
          >
            Terms of Use
          </a>
          .
        </p>
      </div>
    </div>
  );
}
