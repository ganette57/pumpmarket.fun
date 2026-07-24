"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { CheckCircle2 } from "lucide-react";
import { useProgram } from "@/hooks/useProgram";
import { getUserPositionPDA, PLATFORM_WALLET, solToLamports } from "@/utils/solana";
import { sendSignedTx } from "@/lib/solanaSend";
import { recordTransaction, applyTradeToMarketInSupabase } from "@/lib/markets";
import { triggerHaptic } from "@/utils/haptics";
import { useTradingMode } from "@/components/mode/ModeProvider";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { PlayApiError, formatUsd, playClient, toCents } from "@/lib/playClient";

interface FeedTradeSheetProps {
  open: boolean;
  onClose: () => void;
  market: {
    publicKey: string;
    dbId?: string;
    question: string;
    creator?: string | null;
    marketType?: number;
    outcomeNames?: string[];
    outcomeSupplies?: number[];
    yesSupply?: number;
    noSupply?: number;
  } | null;
  defaultOutcomeIndex?: number;
  /** Called after a successful buy with the outcome index and number of shares bought */
  onBuySuccess?: (outcomeIndex: number, deltaShares: number) => void;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(Number(n) || 0)));
}

/** Presets per mode. Real is unchanged; Play is the approved $5/$10/$100. */
const REAL_PRESETS = [0.01, 0.1, 1];
const PLAY_PRESETS = [5, 10, 100];

export default function FeedTradeSheet({
  open,
  onClose,
  market,
  defaultOutcomeIndex = 0,
  onBuySuccess,
}: FeedTradeSheetProps) {
  const { connected, publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();

  const { isPlay } = useTradingMode();
  const play = usePlaySession();

  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [playQuote, setPlayQuote] = useState<{
    payout: string;
    multiple: string | null;
  } | null>(null);
  const inFlightRef = useRef(false);

  const presets = isPlay ? PLAY_PRESETS : REAL_PRESETS;

  const outcomeNames =
    market?.outcomeNames && market.outcomeNames.length >= 2
      ? market.outcomeNames
      : ["YES", "NO"];

  /** The amount actually traded: a chosen preset, or the custom input. */
  const effectiveAmount = useMemo(() => {
    if (customAmount.trim() !== "") {
      const n = Number(customAmount);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    return amount;
  }, [customAmount, amount]);

  /** Play stakes are USD with at most 2 decimals — matches the server rule. */
  const playStakeString = useMemo(() => {
    if (!isPlay || effectiveAmount <= 0) return null;
    const s = effectiveAmount.toFixed(2);
    return /^\d{1,12}(\.\d{1,2})?$/.test(s) ? s : null;
  }, [isPlay, effectiveAmount]);

  const insufficientPlayBalance = useMemo(() => {
    if (!isPlay || !playStakeString || play.balanceUsd === null) return false;
    const need = toCents(playStakeString);
    const have = toCents(play.balanceUsd);
    return need !== null && have !== null && need > have;
  }, [isPlay, playStakeString, play.balanceUsd]);

  const formatAmount = useCallback(
    (v: number) => (isPlay ? formatUsd(v.toFixed(2), { compact: true }) : `${v} SOL`),
    [isPlay]
  );

  // Reset state on open
  useEffect(() => {
    if (!open) return;
    triggerHaptic("light");
    setSelectedOutcome(
      clampInt(defaultOutcomeIndex, 0, Math.max(outcomeNames.length - 1, 0))
    );
    setAmount(0);
    setCustomAmount("");
    setError(null);
    setSuccess(false);
    setPlayQuote(null);
  }, [open, defaultOutcomeIndex, outcomeNames.length]);

  // Switching mode while the sheet is open invalidates the amount (units differ).
  useEffect(() => {
    setAmount(0);
    setCustomAmount("");
    setPlayQuote(null);
    setError(null);
  }, [isPlay]);

  // Lock body scroll when open
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

  /* ---------------------------------------------------------------------- */
  /*  PLAY: live quote (informational — the server re-prices on execute)     */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    if (!open || !isPlay || !market || !play.authenticated || !playStakeString) {
      setPlayQuote(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      playClient
        .quote({
          marketAddress: market.publicKey,
          outcomeIndex: selectedOutcome,
          stakeUsd: playStakeString,
        })
        .then((q) => {
          if (!cancelled) {
            setPlayQuote({
              payout: q.estimated_payout_usd,
              multiple: q.estimated_multiple,
            });
          }
        })
        .catch(() => {
          if (!cancelled) setPlayQuote(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    open,
    isPlay,
    market,
    play.authenticated,
    playStakeString,
    selectedOutcome,
  ]);

  /* ---------------------------------------------------------------------- */
  /*  PLAY execution — never touches Solana                                  */
  /* ---------------------------------------------------------------------- */
  const handlePlayBuy = useCallback(async () => {
    if (!market || !playStakeString || submitting) return;
    if (inFlightRef.current) return;

    const safeOutcome = clampInt(selectedOutcome, 0, outcomeNames.length - 1);

    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      // One signature, once. Afterwards the cookie carries the session.
      const ok = await play.ensureSession();
      if (!ok) {
        setError(play.error || "Play session required.");
        return;
      }

      triggerHaptic("medium");

      const res = await playClient.trade({
        marketAddress: market.publicKey,
        outcomeIndex: safeOutcome,
        stakeUsd: playStakeString,
        // Idempotency key: a retry or double-tap returns the original trade.
        clientTradeId:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });

      play.applyBalance(res.balance_usd);
      setSuccess(true);
      triggerHaptic("success");
      onBuySuccess?.(safeOutcome, Number(res.trade.shares) || 0);
      setTimeout(() => onClose(), 800);
    } catch (e) {
      if (e instanceof PlayApiError) {
        // An expired session must re-prompt, never fall through to Real.
        setError(
          e.needsSession
            ? "Your Play session expired. Tap again to re-enable Play."
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
    market,
    playStakeString,
    submitting,
    selectedOutcome,
    outcomeNames.length,
    play,
    onBuySuccess,
    onClose,
  ]);

  /* ---------------------------------------------------------------------- */
  /*  REAL execution — unchanged from before Play existed                     */
  /* ---------------------------------------------------------------------- */
  const handleBuy = useCallback(async () => {
    if (
      !connected ||
      !publicKey ||
      !signTransaction ||
      !program ||
      !market ||
      effectiveAmount === 0 ||
      submitting
    )
      return;
    triggerHaptic("medium");
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);

    const safeOutcome = clampInt(
      selectedOutcome,
      0,
      outcomeNames.length - 1
    );
    const name = outcomeNames[safeOutcome] || `Outcome #${safeOutcome + 1}`;
    const approxShares = Math.max(1, Math.floor(effectiveAmount / 0.01));

    try {
      const marketPubkey = new PublicKey(market.publicKey);
      const [positionPDA] = getUserPositionPDA(marketPubkey, publicKey);
      const creatorPubkey = new PublicKey(market.creator || publicKey.toBase58());
      const amountBn = new BN(approxShares);

      const buyAccounts = {
        market: marketPubkey,
        userPosition: positionPDA,
        platformWallet: PLATFORM_WALLET,
        creator: creatorPubkey,
        trader: publicKey,
        systemProgram: SystemProgram.programId,
      };

      const tx = await (program as any).methods
        .buyShares(amountBn, safeOutcome)
        .accounts(buyAccounts)
        .transaction();

      const txSig = await sendSignedTx({
        connection,
        tx,
        signTx: signTransaction,
        feePayer: publicKey,
      });

      // Record transaction in Supabase
      try {
        if (market.dbId) {
          await recordTransaction({
            market_id: market.dbId,
            market_address: market.publicKey,
            user_address: publicKey.toBase58(),
            tx_signature: txSig,
            is_buy: true,
            is_yes: outcomeNames.length === 2 ? safeOutcome === 0 : null,
            amount: approxShares,
            shares: approxShares,
            cost: effectiveAmount,
            outcome_index: safeOutcome,
            outcome_name: name,
          } as any);
        }
      } catch (e) {
        console.error("recordTransaction error:", e);
      }

      // Update market in Supabase
      try {
        await applyTradeToMarketInSupabase({
          market_address: market.publicKey,
          market_type: (market.marketType ?? 0) as 0 | 1,
          outcome_index: safeOutcome,
          delta_shares: approxShares,
          delta_volume_lamports: solToLamports(effectiveAmount),
        });
      } catch (e) {
        console.error("applyTrade error:", e);
      }

      setSuccess(true);
      triggerHaptic("success");
      onBuySuccess?.(safeOutcome, approxShares);
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err: any) {
      console.error("FeedTradeSheet buy error:", err);
      const msg =
        err?.message?.includes("User rejected")
          ? "Transaction cancelled"
          : "Transaction failed";
      setError(msg);
    } finally {
      setSubmitting(false);
      inFlightRef.current = false;
    }
  }, [
    connected,
    publicKey,
    signTransaction,
    program,
    market,
    effectiveAmount,
    submitting,
    selectedOutcome,
    outcomeNames,
    connection,
    onClose,
    onBuySuccess,
  ]);

  /* ---------------------------------------------------------------------- */
  /*  CTA state                                                              */
  /* ---------------------------------------------------------------------- */
  const needsWallet = !connected;
  const needsPlaySession = isPlay && connected && !play.authenticated;
  const busy = submitting || play.authenticating;

  const ctaDisabled =
    needsWallet ||
    busy ||
    (!needsPlaySession && effectiveAmount <= 0) ||
    (isPlay && !needsPlaySession && (!playStakeString || insufficientPlayBalance));

  const ctaLabel = (() => {
    if (needsWallet) return "Connect Wallet";
    if (busy) return play.authenticating ? "Enabling Play…" : "Submitting...";
    if (success) return "Done!";
    if (needsPlaySession && effectiveAmount <= 0) return "Enable Play";
    if (insufficientPlayBalance) return "Insufficient balance";
    const label = outcomeNames[selectedOutcome] || "";
    if (effectiveAmount <= 0) return `Buy ${label}`.trim();
    return `Buy ${label} · ${formatAmount(effectiveAmount)}`.trim();
  })();

  /**
   * "Enable Play" (no session yet, no amount chosen) performs the sign-in
   * handshake on its own. With an amount chosen, handlePlayBuy runs
   * ensureSession() first and then trades, so one tap does both.
   */
  const onCtaClick = useCallback(() => {
    if (!isPlay) return void handleBuy();
    if (needsPlaySession && effectiveAmount <= 0) return void play.ensureSession();
    return void handlePlayBuy();
  }, [
    isPlay,
    handleBuy,
    needsPlaySession,
    effectiveAmount,
    play,
    handlePlayBuy,
  ]);

  if (!open || !market) return null;

  return (
    <div className="fixed inset-0 z-[200]">
      {/* Backdrop */}
      <button
        className="absolute inset-x-0 top-0 bottom-14 bg-black/60"
        onClick={() => {
          triggerHaptic("light");
          onClose();
        }}
        aria-label="Close"
      />

      {/* Sheet */}
      <div className="absolute bottom-14 inset-x-0 bg-[#0a0a0a] border-t border-gray-800 rounded-t-2xl p-5 pb-8 animate-slideUp">
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full bg-gray-600 mx-auto mb-3" />

        {/* Market title */}
        <p className="text-white font-semibold text-sm line-clamp-2 mb-4">
          {market.question}
        </p>

        {/* Outcome selector */}
        <p className="text-sm text-gray-400 mb-2">Outcome</p>
        <div className="flex gap-2 mb-4">
          {outcomeNames.slice(0, 4).map((name, idx) => (
            <button
              key={idx}
              onClick={() => {
                triggerHaptic("light");
                setSelectedOutcome(idx);
              }}
              className={`flex-1 py-3 rounded-xl text-sm font-semibold border transition text-center ${
                selectedOutcome === idx
                  ? idx === 0
                    ? "border-[#00FF87] bg-[#00FF87]/10 text-[#00FF87]"
                    : "border-[#ff5c73] bg-[#ff5c73]/10 text-[#ff5c73]"
                  : "border-gray-700 text-gray-300 hover:border-gray-600"
              }`}
            >
              {name.length > 10 ? name.slice(0, 8) + "…" : name}
            </button>
          ))}
        </div>

        {/* Amount presets */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-gray-400">Amount</p>
          {isPlay && play.authenticated && play.balanceUsd !== null && (
            <p className="text-xs text-gray-500">
              Balance{" "}
              <span className="text-gray-300 font-semibold">
                {formatUsd(play.balanceUsd)}
              </span>
            </p>
          )}
        </div>
        <div className="flex gap-2 mb-3">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => {
                triggerHaptic("light");
                setCustomAmount("");
                setAmount(p);
              }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
                customAmount.trim() === "" && amount === p
                  ? "border-[#00FF87] bg-[#00FF87]/10 text-[#00FF87]"
                  : "border-gray-700 text-gray-300 hover:border-gray-600"
              }`}
            >
              {isPlay ? `$${p}` : `${p} SOL`}
            </button>
          ))}
        </div>

        {/* Custom amount */}
        <div className="mb-4">
          <div
            className={`flex items-center rounded-xl border px-3 transition ${
              customAmount.trim() !== ""
                ? "border-[#00FF87]/60"
                : "border-gray-700"
            }`}
          >
            <span className="text-sm text-gray-500 mr-2">
              {isPlay ? "$" : "◎"}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={isPlay ? "0.01" : "0.001"}
              value={customAmount}
              onChange={(e) => {
                setCustomAmount(e.target.value);
                setAmount(0);
              }}
              placeholder="Custom amount"
              className="w-full bg-transparent py-2.5 text-sm text-white placeholder:text-gray-600 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-xs text-gray-500 ml-2">
              {isPlay ? "USD" : "SOL"}
            </span>
          </div>

          {/* Play: estimated payout at the current book */}
          {isPlay && playQuote && !insufficientPlayBalance && (
            <p className="mt-2 text-xs text-gray-500">
              Estimated payout if resolved now{" "}
              <span className="text-gray-300 font-semibold">
                {formatUsd(playQuote.payout)}
              </span>
              {playQuote.multiple ? (
                <span className="text-gray-500">
                  {" "}
                  ({Number(playQuote.multiple).toFixed(2)}x)
                </span>
              ) : null}
            </p>
          )}
        </div>

        {/* Error / success */}
        {error && (
          <p className="text-red-400 text-xs text-center mb-2">{error}</p>
        )}
        {success && (
          <div className="mb-2 flex justify-center animate-fadeIn">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#00FF87]/50 bg-[#00FF87]/10 px-3 py-1 text-xs font-semibold text-[#00FF87]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Trade placed
            </div>
          </div>
        )}

        {/* Buy button */}
        <button
          disabled={ctaDisabled}
          onClick={onCtaClick}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            ctaDisabled
              ? "bg-gray-700 text-gray-400 cursor-not-allowed"
              : success
              ? "bg-[#00FF87] text-black scale-[0.99]"
              : "bg-[#00FF87] text-black hover:bg-[#74ffb8] active:scale-[0.98]"
          }`}
        >
          {ctaLabel}
        </button>

        <button
          onClick={() => {
            triggerHaptic("light");
            onClose();
          }}
          className="w-full mt-2 py-3 rounded-xl bg-gray-800 text-white font-semibold transition-transform duration-150 ease-out active:scale-[0.98]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
