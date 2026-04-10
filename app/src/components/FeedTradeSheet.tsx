"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { CheckCircle2 } from "lucide-react";
import { useProgram } from "@/hooks/useProgram";
import { getUserPositionPDA, PLATFORM_WALLET, solToLamports } from "@/utils/solana";
import { sendSignedTx } from "@/lib/solanaSend";
import { recordTransaction, applyTradeToMarketInSupabase } from "@/lib/markets";
import { triggerHaptic } from "@/utils/haptics";

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

  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inFlightRef = useRef(false);

  const presets = [0.01, 0.1, 1];

  const outcomeNames =
    market?.outcomeNames && market.outcomeNames.length >= 2
      ? market.outcomeNames
      : ["YES", "NO"];

  // Reset state on open
  useEffect(() => {
    if (!open) return;
    triggerHaptic("light");
    setSelectedOutcome(
      clampInt(defaultOutcomeIndex, 0, Math.max(outcomeNames.length - 1, 0))
    );
    setAmount(0);
    setError(null);
    setSuccess(false);
  }, [open, defaultOutcomeIndex, outcomeNames.length]);

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

  const handleBuy = useCallback(async () => {
    if (
      !connected ||
      !publicKey ||
      !signTransaction ||
      !program ||
      !market ||
      amount === 0 ||
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
    const approxShares = Math.max(1, Math.floor(amount / 0.01));

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
            cost: amount,
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
          delta_volume_lamports: solToLamports(amount),
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
    amount,
    submitting,
    selectedOutcome,
    outcomeNames,
    connection,
    onClose,
    onBuySuccess,
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
        <p className="text-sm text-gray-400 mb-2">Amount</p>
        <div className="flex gap-2 mb-4">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => {
                triggerHaptic("light");
                setAmount(p);
              }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
                amount === p
                  ? "border-[#00FF87] bg-[#00FF87]/10 text-[#00FF87]"
                  : "border-gray-700 text-gray-300 hover:border-gray-600"
              }`}
            >
              {p} SOL
            </button>
          ))}
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
          disabled={!connected || amount === 0 || submitting}
          onClick={handleBuy}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            !connected || amount === 0 || submitting
              ? "bg-gray-700 text-gray-400 cursor-not-allowed"
              : success
              ? "bg-[#00FF87] text-black scale-[0.99]"
              : "bg-[#00FF87] text-black hover:bg-[#74ffb8] active:scale-[0.98]"
          }`}
        >
          {!connected
            ? "Connect wallet"
            : submitting
            ? "Submitting..."
            : success
            ? "Done!"
            : `Buy ${outcomeNames[selectedOutcome] || ""}`.trim()}
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
