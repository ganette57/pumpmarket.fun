"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { usePrivyIdentity } from "@/components/privy/PrivyIdentityProvider";
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
import { useMarketSnapshotActions } from "@/components/mode/MarketSnapshotProvider";

import { useRealQuotes } from "@/hooks/useRealQuotes";

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
  /**
   * Called after a successful REAL buy. `costSol` is the authoritative
   * volume delta — the same SOL amount recorded to markets.total_volume via
   * applyTradeToMarketInSupabase — so the feed can reconcile Real volume.
   * The Play path never calls this (it refreshes via its own snapshot).
   */
  onBuySuccess?: (
    outcomeIndex: number,
    deltaShares: number,
    costSol: number
  ) => void;
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
  const { connected, publicKey, signTransaction } = useFunMarketWallet();
  const { connection } = useConnection();
  const program = useProgram();

  const { isPlay } = useTradingMode();
  const play = usePlaySession();
  // Sign-in for the Real path when logged out. Read only — this sheet does
  // not own auth, it just routes into the canonical entry point.
  const privy = usePrivyIdentity();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const { invalidate: invalidateSnapshot } = useMarketSnapshotActions();

  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [playQuoteResult, setPlayQuote] = useState<{
    key: string;
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

  // Match the unchanged execution share count, rather than treating its amount as a budget.
  const realQuotes = useRealQuotes(market?.publicKey ?? "", open && !isPlay,
    JSON.stringify(market?.outcomeSupplies), { shares: effectiveAmount > 0 ? Math.max(1, Math.floor(effectiveAmount / 0.01)) : 0 });
  const realQuote = realQuotes[selectedOutcome];

  /** Play stakes are USD with at most 2 decimals — matches the server rule. */
  const playStakeString = useMemo(() => {
    if (!isPlay || effectiveAmount <= 0) return null;
    const s = effectiveAmount.toFixed(2);
    return /^\d{1,12}(\.\d{1,2})?$/.test(s) ? s : null;
  }, [isPlay, effectiveAmount]);

  const playQuoteKey = JSON.stringify([open, isPlay, market?.publicKey, selectedOutcome, playStakeString, play.authenticated, play.quoteIdentity, play.balanceUsd]);
  const playQuote = playQuoteResult?.key === playQuoteKey ? playQuoteResult : null;

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
  }, [open, market?.publicKey, defaultOutcomeIndex, outcomeNames.length]);

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
    setPlayQuote(null);
    if (!open || !isPlay || !market || !play.authenticated || !play.quoteIdentity || !playStakeString) {
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
              key: playQuoteKey,
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
    playQuoteKey,
    open,
    isPlay,
    market,
    play.authenticated,
    play.quoteIdentity,
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

      // Refresh ONLY the Play book for this market. The Real snapshot is
      // untouched — a Play trade must not move Real supplies or volume.
      invalidateSnapshot("play", market.publicKey);

      setSuccess(true);
      triggerHaptic("success");
      // Intentionally NOT calling onBuySuccess: that optimistically mutates
      // the Real feed state. Play refreshes through its own snapshot above.
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
    onClose,
    invalidateSnapshot,
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
      // effectiveAmount is the SOL spent — the authoritative total_volume
      // delta the feed reconciles against.
      onBuySuccess?.(safeOutcome, approxShares, effectiveAmount);
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
  // Play spends virtual money: it needs an identity, which a Google user
  // has without any wallet at all. Real spends SOL: it needs a wallet.
  // Gating Play on `connected` is what used to make a browser extension a
  // precondition for playing.
  const needsWallet = !isPlay && !connected;
  const needsPlaySession = isPlay && !play.authenticated;
  const busy = submitting || play.authenticating;

  // needsWallet is NOT a disable reason any more: in that state the button
  // is the sign-in action (see onCtaClick), and a disabled sign-in button
  // is the dead end this fixes.
  const ctaDisabled =
    busy ||
    (!needsPlaySession && effectiveAmount <= 0) ||
    (isPlay && !needsPlaySession && (!playStakeString || insufficientPlayBalance));

  const ctaLabel = (() => {
    if (needsWallet) return privy.configured ? "Continue with Google" : "Connect wallet";
    if (busy) return play.authenticating ? "Enabling Play…" : "Submitting...";
    if (success) return "Done!";
    if (needsPlaySession && effectiveAmount <= 0) return play.signInLabel;
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
    // Real, logged out: this used to be a DISABLED button reading "Connect
    // Wallet" — a dead end that told the user what they needed without
    // offering any way to get it, and implied a browser extension was
    // required to trade Real from the feed. Send them through the same
    // Privy login every other surface uses; the embedded wallet it creates
    // can sign Real transactions.
    if (!isPlay && needsWallet) {
      if (privy.configured) return privy.loginWithGoogle();
      return setWalletModalVisible(true);
    }
    if (!isPlay) return void handleBuy();
    if (needsPlaySession && effectiveAmount <= 0) return void play.ensureSession();
    return void handlePlayBuy();
  }, [
    isPlay,
    needsWallet,
    privy,
    setWalletModalVisible,
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

          {!isPlay && realQuote?.multiplier != null && realQuote.payout != null && (
            <p className="text-xs text-gray-400">
              Estimated total if win <span className="font-semibold text-white">{(realQuote.payout / 1e9).toFixed(2)} SOL · {realQuote.multiplier.toFixed(2)}x</span>
              <span className="block">{realQuote.shares} shares · estimated spend {(realQuote.totalPay / 1e9).toFixed(4)} SOL</span>
            </p>
          )}

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
