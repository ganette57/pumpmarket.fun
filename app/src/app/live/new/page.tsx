// src/app/live/new/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { supabase } from "@/lib/supabaseClient";
import { createLiveSession } from "@/lib/liveSessions";

type MarketOption = {
  market_address: string;
  question: string;
};

export default function NewLiveSessionPage() {
  const router = useRouter();
  const { publicKey, connected } = useWallet();

  const [title, setTitle] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [marketAddress, setMarketAddress] = useState("");
  const [status, setStatus] = useState<"live" | "scheduled">("live");

  const [markets, setMarkets] = useState<MarketOption[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Load user's markets
  useEffect(() => {
    if (!publicKey) return;
    setLoadingMarkets(true);

    (async () => {
      try {
        const { data, error } = await supabase
          .from("markets")
          .select("market_address,question")
          .eq("creator", publicKey.toBase58())
          .eq("resolved", false)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;
        setMarkets(data || []);
      } catch (e) {
        console.error("Failed to load markets:", e);
      } finally {
        setLoadingMarkets(false);
      }
    })();
  }, [publicKey]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!connected || !publicKey) {
      setError("Please connect your wallet first.");
      return;
    }
    if (!title.trim()) { setError("Title is required."); return; }
    if (!streamUrl.trim()) { setError("Stream URL is required."); return; }
    if (!marketAddress.trim()) { setError("Please select or enter a market address."); return; }

    setSubmitting(true);
    try {
      const session = await createLiveSession({
        title: title.trim(),
        market_address: marketAddress.trim(),
        host_wallet: publicKey.toBase58(),
        stream_url: streamUrl.trim(),
        status,
        thumbnail_url: thumbnailUrl.trim() || null,
      });

      router.push(`/live/${session.id}`);
    } catch (err: any) {
      console.error("Create session error:", err);
      setError(String(err?.message || "Failed to create session"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!connected || !publicKey) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-white mb-2">Connect Wallet</h1>
          <p className="text-sm text-gray-400">You need to connect your wallet to create a live session.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] px-4 py-6 max-w-lg mx-auto">
      {/* Back */}
      <Link href="/live" className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-6 transition">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to live
      </Link>

      <h1 className="text-2xl font-bold text-white mb-6">Go Live</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-semibold text-white mb-1.5">Session Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Market Analysis Stream"
            className="input-pump w-full"
            maxLength={120}
          />
        </div>

        {/* Stream URL */}
        <div>
          <label className="block text-sm font-semibold text-white mb-1.5">Stream URL</label>
          <input
            type="url"
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
            placeholder="https://youtube.com/live/... or twitch.tv/..."
            className="input-pump w-full"
          />
          <p className="text-xs text-gray-500 mt-1">YouTube, Twitch, or Kick stream URL</p>
        </div>

        {/* Thumbnail URL (optional) */}
        <div>
          <label className="block text-sm font-semibold text-white mb-1.5">
            Thumbnail URL <span className="text-gray-500 font-normal">(optional)</span>
          </label>
          <input
            type="url"
            value={thumbnailUrl}
            onChange={(e) => setThumbnailUrl(e.target.value)}
            placeholder="https://..."
            className="input-pump w-full"
          />
        </div>

        {/* Market */}
        <div>
          <label className="block text-sm font-semibold text-white mb-1.5">Linked Market</label>

          {loadingMarkets ? (
            <div className="text-sm text-gray-500">Loading your markets...</div>
          ) : markets.length > 0 ? (
            <select
              value={marketAddress}
              onChange={(e) => setMarketAddress(e.target.value)}
              className="input-pump w-full"
            >
              <option value="">Select a market...</option>
              {markets.map((m) => (
                <option key={m.market_address} value={m.market_address}>
                  {m.question?.slice(0, 60) || m.market_address.slice(0, 12) + "..."}
                </option>
              ))}
            </select>
          ) : null}

          <div className="mt-2">
            <label className="block text-xs text-gray-500 mb-1">Or paste market address directly:</label>
            <input
              type="text"
              value={marketAddress}
              onChange={(e) => setMarketAddress(e.target.value)}
              placeholder="Market public key..."
              className="input-pump w-full text-sm"
            />
          </div>
        </div>

        {/* Status */}
        <div>
          <label className="block text-sm font-semibold text-white mb-1.5">Initial Status</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStatus("live")}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border transition ${
                status === "live"
                  ? "border-pump-green bg-pump-green/10 text-pump-green"
                  : "border-gray-700 text-gray-400 hover:border-gray-600"
              }`}
            >
              Go Live Now
            </button>
            <button
              type="button"
              onClick={() => setStatus("scheduled")}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border transition ${
                status === "scheduled"
                  ? "border-yellow-500 bg-yellow-500/10 text-yellow-400"
                  : "border-gray-700 text-gray-400 hover:border-gray-600"
              }`}
            >
              Schedule
            </button>
          </div>
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
          {submitting ? "Creating..." : status === "live" ? "Start Live Session" : "Schedule Session"}
        </button>
      </form>
    </div>
  );
}
