// Shared mobile rendering extracted from the stable /live/[id] view.
// Used in both /live/[id] (detail) and /live (feed) to guarantee identical rendering.
"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";
import { lamportsToSol } from "@/utils/solana";

/* ── Helpers ─────────────────────────────────────────────────────── */

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(Number(n) || 0)));
}

export function formatVol(volLamports: number) {
  const sol = lamportsToSol(Number(volLamports) || 0);
  if (sol >= 1000) return `${(sol / 1000).toFixed(0)}k`;
  if (sol >= 100) return `${sol.toFixed(0)}`;
  return sol.toFixed(2);
}

/* ── StreamPlayer ────────────────────────────────────────────────── */

export function StreamPlayer({ url }: { url: string }) {
  const embedUrl = useMemo(() => {
    const ytMatch = url.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/live\/)([\w-]+)/
    );
    if (ytMatch)
      return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&mute=1`;

    const twitchMatch = url.match(/twitch\.tv\/(\w+)/);
    if (twitchMatch)
      return `https://player.twitch.tv/?channel=${twitchMatch[1]}&parent=${
        typeof window !== "undefined" ? window.location.hostname : "localhost"
      }`;

    const kickMatch = url.match(/kick\.com\/(\w+)/);
    if (kickMatch) return `https://player.kick.com/${kickMatch[1]}`;

    return url;
  }, [url]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <iframe
        src={embedUrl}
        className="absolute inset-0 w-full h-full"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        frameBorder="0"
      />
    </div>
  );
}

/* ── StatusBanner ────────────────────────────────────────────────── */

export function StatusBanner({ status }: { status: string }) {
  if (status === "live") {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600/20 border border-red-600/40">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-sm font-semibold text-red-400">LIVE</span>
      </div>
    );
  }

  const map: Record<
    string,
    { border: string; bg: string; text: string; label: string }
  > = {
    scheduled: {
      border: "border-yellow-600/40",
      bg: "bg-yellow-600/20",
      text: "text-yellow-400",
      label: "Scheduled",
    },
    locked: {
      border: "border-orange-500/40",
      bg: "bg-orange-500/20",
      text: "text-orange-400",
      label: "Trading Locked",
    },
    ended: {
      border: "border-gray-600/40",
      bg: "bg-gray-600/20",
      text: "text-gray-400",
      label: "Stream Ended",
    },
    resolved: {
      border: "border-pump-green/40",
      bg: "bg-pump-green/20",
      text: "text-pump-green",
      label: "Resolved",
    },
    cancelled: {
      border: "border-gray-700/40",
      bg: "bg-gray-700/20",
      text: "text-gray-400",
      label: "Cancelled",
    },
  };
  const s = map[status] || map.ended!;

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 rounded-xl ${s.bg} border ${s.border}`}
    >
      <span className={`text-sm font-semibold ${s.text}`}>{s.label}</span>
    </div>
  );
}

/* ── MobileBuySheet ──────────────────────────────────────────────── */

export function MobileBuySheet({
  open,
  onClose,
  derived,
  connected,
  submitting,
  onTrade,
  sessionLocked,
  defaultOutcomeIndex,
  keepNavbar,
}: {
  open: boolean;
  onClose: () => void;
  derived: { names: string[] };
  connected: boolean;
  submitting: boolean;
  onTrade: (
    s: number,
    idx: number,
    side: "buy" | "sell",
    cost?: number
  ) => void;
  sessionLocked: boolean;
  defaultOutcomeIndex?: number;
  keepNavbar?: boolean;
}) {
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState<number>(0);
  const presets = [0.01, 0.1, 1];

  // Reset on open when defaultOutcomeIndex is provided (feed context)
  useEffect(() => {
    if (!open) return;
    if (defaultOutcomeIndex != null) {
      setSelectedOutcome(
        clampInt(
          defaultOutcomeIndex,
          0,
          Math.max(derived.names.length - 1, 0)
        )
      );
      setAmount(0);
    }
  }, [open, defaultOutcomeIndex, derived.names.length]);

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

  if (!open) return null;

  const bottomClass = keepNavbar ? "bottom-14" : "bottom-0";

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

        {sessionLocked ? (
          <div className="text-center py-4">
            <p className="text-gray-400 text-sm">
              Trading is currently locked for this session.
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
            {/* Amount presets */}
            <p className="text-sm text-gray-400 mb-2">Amount</p>
            <div className="flex gap-2 mb-4">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => setAmount(p)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
                    amount === p
                      ? "border-pump-green bg-pump-green/10 text-pump-green"
                      : "border-gray-700 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  {p} SOL
                </button>
              ))}
            </div>

            {amount === 0 && (
              <div className="mb-4 rounded-lg bg-pump-dark/80 border border-gray-800 p-3 text-center">
                <p className="text-xs text-gray-400">
                  Select an amount to trade.
                </p>
              </div>
            )}

            {/* Outcome selector */}
            {derived.names.length > 0 && (
              <>
                <p className="text-sm text-gray-400 mb-2">Outcome</p>
                <div className="flex gap-2 mb-4">
                  {derived.names.slice(0, 4).map((name, idx) => (
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

            {/* Buy button */}
            <button
              disabled={!connected || amount === 0 || submitting}
              onClick={() => {
                const approxShares = Math.max(1, Math.floor(amount / 0.01));
                onTrade(approxShares, selectedOutcome, "buy", amount);
                onClose();
              }}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
                !connected || amount === 0 || submitting
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : "bg-pump-green text-black hover:bg-[#74ffb8]"
              }`}
            >
              {!connected
                ? "Connect wallet"
                : submitting
                ? "Submitting..."
                : "Buy"}
            </button>

            <button
              onClick={onClose}
              className="w-full mt-2 py-3 rounded-xl bg-gray-800 text-white font-semibold"
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── LiveMobileContent ───────────────────────────────────────────── */

// Renders the exact stable mobile view from /live/[id]:
// StreamPlayer + Title/Host + StatusBanner + Market card with outcomes.
// Truncated before Discussion / Comments / LiveActivity / HostControls.

export type LiveMobileContentMarket = {
  publicKey: string;
  question: string;
  imageUrl?: string;
  category?: string;
  totalVolume: number;
};

export type LiveMobileContentDerived = {
  names: string[];
  percentages: number[];
};

export function LiveMobileContent({
  streamUrl,
  title,
  hostWallet,
  status,
  market,
  derived,
  sessionLocked,
  onOutcomeTap,
  active = true,
  thumbnailUrl,
}: {
  streamUrl: string;
  title: string;
  hostWallet: string;
  status: string;
  market: LiveMobileContentMarket | null;
  derived: LiveMobileContentDerived | null;
  sessionLocked: boolean;
  onOutcomeTap?: (outcomeIndex: number) => void;
  /** When false, show thumbnail instead of stream (perf: only active slide streams) */
  active?: boolean;
  thumbnailUrl?: string;
}) {
  return (
    <>
      {/* Stream player — exact stable rendering */}
      {active && streamUrl ? (
        <StreamPlayer url={streamUrl} />
      ) : (
        <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt={title}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(109,255,164,0.2),transparent_42%),linear-gradient(180deg,#020304_0%,#04070c_100%)]" />
          )}
        </div>
      )}

      {/* Title + status — exact stable layout */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-white leading-tight break-words">
            {title}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Host: {hostWallet.slice(0, 6)}...{hostWallet.slice(-4)}
          </p>
        </div>
        <StatusBanner status={status} />
      </div>

      {/* Market info card — exact stable structure */}
      {market && derived ? (
        <div className="card-pump p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-pump-dark shrink-0">
              {market.imageUrl ? (
                <Image
                  src={market.imageUrl}
                  alt=""
                  width={40}
                  height={40}
                  className="object-cover w-full h-full"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <CategoryImagePlaceholder
                    category={market.category || "other"}
                    className="scale-[0.4]"
                  />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Link
                href={`/trade/${market.publicKey}`}
                className="text-sm font-semibold text-white hover:text-pump-green transition line-clamp-1"
              >
                {market.question}
              </Link>
              <p className="text-[11px] text-gray-500">
                {formatVol(market.totalVolume)} SOL Vol
              </p>
            </div>
          </div>

          {/* Outcome bars */}
          <div className="grid grid-cols-2 gap-2">
            {derived.names.slice(0, 2).map((name, idx) => {
              const pct = (derived.percentages[idx] ?? 0).toFixed(1);
              const isYes = idx === 0;
              return (
                <button
                  key={idx}
                  onClick={() => onOutcomeTap?.(idx)}
                  disabled={sessionLocked}
                  className={`text-left rounded-xl px-4 py-3 border bg-pump-dark/80 transition ${
                    isYes ? "border-pump-green/40" : "border-[#ff5c73]/40"
                  } ${!sessionLocked ? "active:scale-[0.98]" : ""}`}
                >
                  <span
                    className={`text-xs font-semibold uppercase ${
                      isYes ? "text-pump-green" : "text-[#ff5c73]"
                    }`}
                  >
                    {name}
                  </span>
                  <div
                    className={`text-2xl font-bold tabular-nums ${
                      isYes ? "text-pump-green" : "text-[#ff5c73]"
                    }`}
                  >
                    {pct}%
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card-pump p-4">
          <div className="h-12 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center text-xs text-gray-400">
            Loading live outcomes...
          </div>
        </div>
      )}
    </>
  );
}
