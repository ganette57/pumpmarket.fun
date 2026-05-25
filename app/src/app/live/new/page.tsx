// src/app/live/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { createLiveSession } from "@/lib/liveSessions";
import { indexMarket } from "@/lib/markets";
import { useProgram } from "@/hooks/useProgram";
import { sendSignedTx } from "@/lib/solanaSend";

// Same on-chain market defaults as /create.
const DEFAULT_B_SOL = 0.01;
const DEFAULT_MAX_POSITION_BPS = 10_000;
const DEFAULT_MAX_TRADE_SHARES = 5_000_000;
const DEFAULT_COOLDOWN_SECONDS = 0;

const DURATION_OPTIONS = [3, 5, 10, 30] as const;

export default function NewLiveSessionPage() {
  const router = useRouter();
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();

  const [streamUrl, setStreamUrl] = useState("");
  const [marketTitle, setMarketTitle] = useState("");
  const [yesLabel, setYesLabel] = useState("YES");
  const [noLabel, setNoLabel] = useState("NO");
  const [durationMin, setDurationMin] = useState<number>(5);

  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"" | "market" | "session">("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!connected || !publicKey) {
      setError("Please connect your wallet first.");
      return;
    }
    if (!streamUrl.trim()) {
      setError("Stream URL is required.");
      return;
    }
    if (!marketTitle.trim()) {
      setError("Market title is required.");
      return;
    }
    if (!program) {
      setError("Market program not ready — reconnect your wallet.");
      return;
    }
    if (!signTransaction) {
      setError("Wallet cannot sign transactions.");
      return;
    }

    setSubmitting(true);
    try {
      const outcomes = [
        yesLabel.trim().slice(0, 24) || "YES",
        noLabel.trim().slice(0, 24) || "NO",
      ];
      const resolutionTimestamp =
        Math.floor(Date.now() / 1000) + durationMin * 60;
      const bLamportsU64 = Math.floor(DEFAULT_B_SOL * 1_000_000_000);

      // 1. Create the short market on-chain (same flow as /create).
      setStep("market");
      const marketKeypair = Keypair.generate();

      const tx = await (program as any).methods
        .createMarket(
          new BN(resolutionTimestamp),
          outcomes,
          0, // market_type: binary
          new BN(bLamportsU64),
          DEFAULT_MAX_POSITION_BPS,
          new BN(DEFAULT_MAX_TRADE_SHARES),
          new BN(DEFAULT_COOLDOWN_SECONDS)
        )
        .accounts({
          market: marketKeypair.publicKey,
          creator: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      await sendSignedTx({
        connection,
        tx,
        feePayer: publicKey,
        signTx: signTransaction,
        beforeSign: (t) => t.partialSign(marketKeypair),
      });

      const marketAddress = marketKeypair.publicKey.toBase58();

      // Index into Supabase (end_date powers the live HUD countdown).
      await indexMarket({
        market_address: marketAddress,
        question: marketTitle.trim().slice(0, 200),
        category: "other",
        creator: publicKey.toBase58(),
        end_date: new Date(resolutionTimestamp * 1000).toISOString(),
        market_type: 0,
        outcome_names: outcomes,
        outcome_supplies: outcomes.map(() => 0),
        yes_supply: 0,
        no_supply: 0,
        total_volume: 0,
      } as any);

      // 2. Create the live session linked to the new market (always live).
      setStep("session");
      const session = await createLiveSession({
        title: marketTitle.trim(),
        market_address: marketAddress,
        host_wallet: publicKey.toBase58(),
        stream_url: streamUrl.trim(),
        status: "live",
        thumbnail_url: null,
      });

      // 3. Go to the main live feed, focused on the new session.
      router.push(`/live?session=${encodeURIComponent(session.id)}`);
    } catch (err: any) {
      console.error("Go Live error:", err);
      setError(String(err?.message || "Failed to go live"));
    } finally {
      setSubmitting(false);
      setStep("");
    }
  }

  if (!connected || !publicKey) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-white mb-2">Connect Wallet</h1>
          <p className="text-sm text-gray-400">
            You need to connect your wallet to go live.
          </p>
        </div>
      </div>
    );
  }

  const submitLabel = submitting
    ? step === "market"
      ? "Creating market…"
      : step === "session"
      ? "Starting session…"
      : "Working…"
    : "Go Live";

  return (
    <div className="min-h-[70vh] px-4 py-6 max-w-lg mx-auto">
      {/* Back */}
      <Link
        href="/live"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-6 transition"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to live
      </Link>

      <h1 className="text-2xl font-bold text-white mb-1">Go Live</h1>
      <p className="text-sm text-gray-400 mb-6">
        Create a stream and its first flash market in one step.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 1. Stream URL */}
        <div>
          <label className="block text-sm font-semibold text-white mb-1.5">
            Stream URL
          </label>
          <input
            type="url"
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
            placeholder="https://youtube.com/live/... or twitch.tv/..."
            className="input-pump w-full"
          />
          <p className="text-xs text-gray-500 mt-1">YouTube, Twitch, or Kick stream URL</p>
        </div>

        {/* 2. Market title */}
        <div>
          <label className="block text-sm font-semibold text-white mb-1.5">
            Market Title
          </label>
          <input
            type="text"
            value={marketTitle}
            onChange={(e) => setMarketTitle(e.target.value)}
            placeholder="e.g. Will he say Bitcoin in the next 5 minutes?"
            className="input-pump w-full"
            maxLength={200}
          />
        </div>

        {/* 3. Outcomes */}
        <div>
          <label className="block text-sm font-semibold text-white mb-1.5">
            Outcomes
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={yesLabel}
              onChange={(e) => setYesLabel(e.target.value)}
              className="input-pump w-full text-pump-green font-semibold"
              maxLength={24}
            />
            <input
              type="text"
              value={noLabel}
              onChange={(e) => setNoLabel(e.target.value)}
              className="input-pump w-full text-[#ff5c73] font-semibold"
              maxLength={24}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">Two outcomes (defaults to YES / NO).</p>
        </div>

        {/* 4. Duration */}
        <div>
          <label className="block text-sm font-semibold text-white mb-1.5">
            Duration
          </label>
          <div className="grid grid-cols-4 gap-2">
            {DURATION_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDurationMin(d)}
                className={`py-2.5 rounded-lg text-sm font-semibold border transition ${
                  durationMin === d
                    ? "border-pump-green bg-pump-green/10 text-pump-green"
                    : "border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                {d} min
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Market resolves {durationMin} minute{durationMin === 1 ? "" : "s"} after going live.
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            submitting
              ? "bg-gray-700 text-gray-400 cursor-not-allowed"
              : "bg-pump-green text-black hover:bg-[#74ffb8]"
          }`}
        >
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
