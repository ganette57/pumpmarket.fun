"use client";

import Link from "next/link";
import Image from "next/image";
import { Clock, TrendingUp } from "lucide-react";
import { lamportsToSol } from "@/utils/solana";

interface HomeFeedItemProps {
  market: {
    publicKey: string;
    question: string;
    description?: string;
    category: string;
    imageUrl?: string | null;
    yesSupply: number;
    noSupply: number;
    outcomeNames?: string[];
    outcomeSupplies?: number[];
    resolutionTime: number;
    totalVolume: number;
    resolved: boolean;
  };
  liveSessionId?: string | null;
  liveMatch?: boolean;
  finishedMatch?: boolean;
  creatorProfile?: {
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
  creatorAddress?: string | null;
  /** Called when user taps an outcome button (index 0 or 1). If not provided, falls back to Link. */
  onOutcomeTap?: (outcomeIndex: number) => void;
}

export default function HomeFeedItem({
  market,
  liveSessionId,
  liveMatch = false,
  finishedMatch = false,
  creatorProfile,
  creatorAddress,
  onOutcomeTap,
}: HomeFeedItemProps) {
  const now = Date.now() / 1000;
  const daysLeft = Math.max(0, Math.floor((market.resolutionTime - now) / 86400));
  const isEnded = market.resolved || now >= market.resolutionTime;
  const providerLive = liveMatch || !!liveSessionId;
  const showLiveBadge = providerLive;
  const showEndedBadge = !showLiveBadge && (finishedMatch || isEnded);

  const safeCategory = (market.category ?? "other").toString().trim() || "other";

  const safeImageUrl =
    market.imageUrl &&
    market.imageUrl !== "null" &&
    market.imageUrl !== "undefined" &&
    market.imageUrl.trim() !== ""
      ? market.imageUrl
      : undefined;

  // outcomes
  const outcomes =
    market.outcomeNames && market.outcomeNames.length >= 2
      ? market.outcomeNames
      : ["YES", "NO"];

  const supplies =
    market.outcomeSupplies && market.outcomeSupplies.length >= 2
      ? market.outcomeSupplies.map(Number)
      : [market.yesSupply || 0, market.noSupply || 0];

  const totalSupply = supplies.reduce((a, b) => a + b, 0);
  const percents = supplies.map((s) =>
    totalSupply > 0 ? ((s / totalSupply) * 100).toFixed(0) : "50"
  );

  const volSol = lamportsToSol(market.totalVolume);

  return (
    <div className="relative h-[100dvh] w-full snap-start snap-always flex-shrink-0 overflow-hidden bg-black">
      {/* ── Background image ── */}
      {safeImageUrl ? (
        <Image
          src={safeImageUrl}
          alt={market.question}
          fill
          className="object-cover"
          sizes="100vw"
          priority
        />
      ) : (
        /* gradient fallback when no image */
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a1a10] via-[#0a0a0a] to-[#0d0d1a]" />
      )}

      {/* ── Vignette / gradient overlays for readability ── */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-black/60" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-transparent h-32" />

      {/* ── LIVE badge ── */}
      {showLiveBadge && (
        <div className="absolute top-20 left-4 z-10">
          {liveSessionId ? (
            <Link href={`/live/${liveSessionId}`}>
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-red-600 text-white shadow-lg">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                LIVE
              </span>
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-red-600 text-white shadow-lg">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
          )}
        </div>
      )}

      {/* ── Bottom overlay: market info + quick trade ── */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pb-28 md:pb-6">
        {/* Category badge */}
        <div className="mb-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-white/15 backdrop-blur-sm border border-white/10 text-white/90">
            {safeCategory}
          </span>
          {showEndedBadge && (
            <span className="ml-2 inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-black/60 border border-gray-700 text-gray-300">
              Ended
            </span>
          )}
        </div>

        {/* Title — tapping opens the full trade page */}
        <Link href={`/trade/${market.publicKey}`}>
          <h2 className="text-white text-xl font-bold leading-tight line-clamp-3 mb-2 drop-shadow-lg active:opacity-70 transition-opacity">
            {market.question}
          </h2>
        </Link>

        {/* Sub info row */}
        <div className="flex items-center gap-3 text-[12px] text-white/70 mb-3">
          {/* creator */}
          {(creatorProfile?.display_name || creatorAddress) && (
            <div className="flex items-center gap-1 min-w-0 shrink">
              {creatorProfile?.avatar_url ? (
                <img
                  src={creatorProfile.avatar_url}
                  alt=""
                  className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-4 h-4 rounded-full bg-white/20 flex-shrink-0" />
              )}
              <span className="truncate max-w-[100px]">
                {creatorProfile?.display_name
                  ? creatorProfile.display_name
                  : creatorAddress
                  ? `${creatorAddress.slice(0, 4)}…${creatorAddress.slice(-4)}`
                  : ""}
              </span>
            </div>
          )}

          {/* volume */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <TrendingUp className="w-3 h-3 text-pump-green" />
            <span className="font-semibold text-white/90">
              {volSol.toFixed(2)} SOL
            </span>
          </div>

          {/* time */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Clock className="w-3 h-3" />
            <span>{showEndedBadge ? "Ended" : `${daysLeft}d left`}</span>
          </div>
        </div>

        {/* ── Quick Trade: outcome buttons ── */}
        <div className="flex gap-2">
          {/* Outcome 1 (GREEN) — same color as MarketCard */}
          <button
            type="button"
            onClick={() => onOutcomeTap ? onOutcomeTap(0) : undefined}
            className="flex-1 bg-[#00FF87] rounded-xl py-3 px-3 flex items-center justify-between active:scale-[0.97] transition-transform"
          >
            <span className="text-[12px] uppercase text-black font-bold tracking-wide truncate max-w-[60%]">
              {outcomes[0].length > 12
                ? outcomes[0].slice(0, 10) + "…"
                : outcomes[0]}
            </span>
            <span className="text-[20px] font-bold text-black">
              {percents[0]}%
            </span>
          </button>

          {/* Outcome 2 (RED) — same color as MarketCard */}
          <button
            type="button"
            onClick={() => onOutcomeTap ? onOutcomeTap(1) : undefined}
            className="flex-1 bg-[#ff5c73] rounded-xl py-3 px-3 flex items-center justify-between active:scale-[0.97] transition-transform"
          >
            <span className="text-[12px] uppercase text-black font-bold tracking-wide truncate max-w-[60%]">
              {outcomes[1].length > 12
                ? outcomes[1].slice(0, 10) + "…"
                : outcomes[1]}
            </span>
            <span className="text-[20px] font-bold text-black">
              {percents[1]}%
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
