"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Activity as ActivityIcon, BarChart3, Clock, TrendingUp } from "lucide-react";
import { lamportsToSol } from "@/utils/solana";
import { triggerHaptic } from "@/utils/haptics";
import MobileFeedVideoBackground from "@/components/MobileFeedVideoBackground";
import {
  useMarketSnapshot,
  type MarketSnapshot,
} from "@/components/mode/MarketSnapshotProvider";
import {
  LiveActivityDrawer,
  LiveChartDrawer,
} from "@/components/LiveMobileContent";

import { useFeedMultipliers, formatFeedMultiplier } from "@/hooks/useFeedMultipliers";

function FeedMultiplier({ value, mode }: { value: unknown; mode: "play" | "real" }) {
  const text = formatFeedMultiplier(value);
  const ref = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setFits(node.scrollWidth <= node.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [text]);
  if (!text) return null;
  return <span ref={ref}
    title={`Estimated total return including your existing holdings, with a ${mode === "play" ? "$100 stake" : "1 SOL budget"}`}
    className={`block h-3 overflow-hidden whitespace-nowrap text-[10px] leading-3 font-medium tabular-nums opacity-70 md:hidden ${fits ? "" : "invisible"}`}>
    {text}
  </span>;
}

interface HomeFeedItemProps {
  market: {
    publicKey: string;
    question: string;
    description?: string;
    category: string;
    imageUrl?: string | null;
    feedVideoUrl?: string | null;
    feedThumbnailUrl?: string | null;
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
  withActionRail?: boolean;
  footballOutcomeIndices?: [number, number, number] | null;
  /** Called when user taps market title before navigating to full trade page. */
  onTitleTap?: () => void;
  /** Called with the original outcome index, including all three football choices. */
  onOutcomeTap?: (outcomeIndex: number) => void;
}

export default function HomeFeedItem({
  market,
  liveSessionId,
  liveMatch = false,
  finishedMatch = false,
  creatorProfile,
  creatorAddress,
  withActionRail = false,
  footballOutcomeIndices = null,
  onTitleTap,
  onOutcomeTap,
}: HomeFeedItemProps) {
  const [chartOpen, setChartOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const drawerNames = useMemo(
    () =>
      market.outcomeNames && market.outcomeNames.length >= 2
        ? market.outcomeNames
        : ["YES", "NO"],
    [market.outcomeNames],
  );
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

  const safeFeedVideoUrl =
    market.feedVideoUrl &&
    market.feedVideoUrl !== "null" &&
    market.feedVideoUrl !== "undefined" &&
    market.feedVideoUrl.trim() !== ""
      ? market.feedVideoUrl
      : undefined;

  const feedVideoPosterUrl =
    (market.feedThumbnailUrl &&
    market.feedThumbnailUrl !== "null" &&
    market.feedThumbnailUrl !== "undefined" &&
    market.feedThumbnailUrl.trim() !== ""
      ? market.feedThumbnailUrl
      : undefined) || safeImageUrl;

  // Detect badge/logo/crest images that look bad when stretched full-screen
  const isBadgeLikeImage = safeImageUrl
    ? /\/(badge|logo|emblem|crest)\//i.test(safeImageUrl) ||
      /\.(svg|ico)(\?|$)/i.test(safeImageUrl)
    : false;

  // outcomes
  const outcomes =
    market.outcomeNames && market.outcomeNames.length >= 2
      ? market.outcomeNames
      : ["YES", "NO"];
  const visibleOutcomeIndices = footballOutcomeIndices ?? [0, 1];

  // Mode-specific economics come from a snapshot keyed by market AND mode.
  // The Real values the feed already loaded are passed as the fallback and
  // are used ONLY while Real is active — Play never borrows them.
  const realSupplies =
    market.outcomeSupplies && market.outcomeSupplies.length >= 2
      ? market.outcomeSupplies.map(Number)
      : [market.yesSupply || 0, market.noSupply || 0];

  const realFallback = useMemo<MarketSnapshot>(
    () => ({
      mode: "real" as const,
      marketAddress: market.publicKey,
      supplies: realSupplies.map(String),
      probabilities: (() => {
        const t = realSupplies.reduce((a, b) => a + b, 0);
        return t > 0
          ? realSupplies.map((s) => s / t)
          : realSupplies.map(() => 1 / Math.max(realSupplies.length, 1));
      })(),
      volume: String(market.totalVolume ?? 0),
      status: market.resolved ? "resolved" : "open",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [market.publicKey, market.totalVolume, market.resolved, realSupplies.join(",")]
  );

  const { snapshot, mode } = useMarketSnapshot(market.publicKey, realFallback);

  const isPlayMode = mode === "play";
  const multipliers = useFeedMultipliers(market.publicKey, mode,
    `${snapshot?.volume}:${snapshot?.supplies.join(",")}:${snapshot?.updatedAt ?? ""}`,
    isEnded || finishedMatch || !snapshot || snapshot.status !== "open");

  const percents = snapshot
    ? snapshot.probabilities.map((p) => (p * 100).toFixed(0))
    : realSupplies.map(() => "—");

  /**
   * Volume label. Real keeps lamports -> SOL exactly as before. Play shows
   * its own virtual pool in USD; a Real SOL figure must never appear while
   * Play is active.
   */
  const volumeLabel = (() => {
    if (isPlayMode) {
      if (!snapshot) return "—";
      const usd = Number(snapshot.volume) || 0;
      return usd >= 1000
        ? `$${(usd / 1000).toFixed(1)}k`
        : `$${usd.toFixed(usd < 100 ? 2 : 0)}`;
    }
    return `${lamportsToSol(Number(snapshot?.volume ?? market.totalVolume)).toFixed(2)} SOL`;
  })();

  return (
    <div
      className="relative h-[100dvh] w-full snap-start snap-always flex-shrink-0 overflow-hidden bg-black"
      data-feed-market={market.publicKey}
    >
      {/* ── Background media ── */}
      {safeFeedVideoUrl ? (
        <MobileFeedVideoBackground
          videoUrl={safeFeedVideoUrl}
          posterUrl={feedVideoPosterUrl || null}
          alt={market.question}
          /* Full-bleed background for video items so the lower half isn't black.
             Existing overlays (header, action rail, badges, title, YES/NO, ticker, nav)
             sit on top via their own absolute positions and z-indexes — unchanged. */
          wrapperClassName="absolute inset-0 overflow-hidden"
          mediaClassName="absolute inset-0 w-full h-full object-cover object-[center_30%]"
          overlay={
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/40 md:from-black/90 md:via-black/30 md:to-black/50 pointer-events-none" />
          }
          showMuteToggle
        />
      ) : safeImageUrl ? (
        <div className="absolute inset-x-0 top-0 h-[55%] md:h-full overflow-hidden">
          <Image
            src={safeImageUrl}
            alt={market.question}
            fill
            className={
              isBadgeLikeImage
                ? "object-contain p-6"
                : "object-cover object-[center_30%]"
            }
            sizes="100vw"
            priority
          />
          {/* Darken image edges + fade to black at bottom */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-black/40 md:from-black/90 md:via-black/30 md:to-black/50" />
        </div>
      ) : (
        /* gradient fallback when no image */
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a1a10] via-[#0a0a0a] to-[#0d0d1a]" />
      )}

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
      <div
        className={`absolute bottom-0 left-0 right-0 z-10 pb-[7.5rem] md:pb-6 ${
          withActionRail ? "pl-4 pr-24" : "px-4"
        }`}
      >
        {/* Category badge + Chart/Activity quick actions (room here, away
            from the right rail). */}
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-white/10 backdrop-blur-sm text-white/90">
            {safeCategory}
          </span>
          {showEndedBadge && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-black/60 border border-gray-700 text-gray-300">
              Ended
            </span>
          )}
          <button
            type="button"
            aria-label="Open market chart"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              triggerHaptic("light");
              setChartOpen(true);
            }}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/10 text-white/85 backdrop-blur-sm active:scale-95 transition"
          >
            <BarChart3 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="Open market activity"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              triggerHaptic("light");
              setActivityOpen(true);
            }}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/10 text-white/85 backdrop-blur-sm active:scale-95 transition"
          >
            <ActivityIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Title — tapping opens the full trade page */}
        <Link href={`/trade/${market.publicKey}`} onClick={onTitleTap}>
          <h2 className="text-white text-xl font-bold leading-tight line-clamp-3 mb-2 drop-shadow-lg active:opacity-70 transition-opacity">
            {market.question}
          </h2>
        </Link>

        {/* Sub info row */}
        <div className="flex items-center gap-3 text-[12px] text-white/70 mb-3">
          {/* creator */}
          {(creatorProfile?.display_name || creatorAddress) && (() => {
            const inner = (
              <>
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
              </>
            );
            return creatorAddress ? (
              <Link
                href={`/profile/${creatorAddress}`}
                className="flex items-center gap-1 min-w-0 shrink hover:text-white"
              >
                {inner}
              </Link>
            ) : (
              <div className="flex items-center gap-1 min-w-0 shrink">{inner}</div>
            );
          })()}

          {/* volume */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <TrendingUp className="w-3 h-3 text-pump-green" />
            <span className="font-semibold text-white/90">{volumeLabel}</span>
          </div>

          {/* time */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Clock className="w-3 h-3" />
            <span>{showEndedBadge ? "Ended" : `${daysLeft}d left`}</span>
          </div>
        </div>

        {/* ── Quick Trade: outcome buttons ── */}
        <div className={`grid gap-2 ${footballOutcomeIndices ? "grid-cols-3" : "grid-cols-2"}`}>
          {visibleOutcomeIndices.map((index, displayIndex) => (
            <button
              key={index}
              type="button"
              title={outcomes[index]}
              onClick={() => {
                triggerHaptic("light");
                if (onOutcomeTap) onOutcomeTap(index);
              }}
              className={`min-w-0 rounded-xl px-2.5 py-2 text-left active:scale-[0.965] transition-transform duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pump-green ${
                footballOutcomeIndices && displayIndex === 1
                  ? "bg-white/10 text-white"
                  : (footballOutcomeIndices ? displayIndex === 0 : index === 0)
                  ? "bg-[#00FF87] text-black"
                  : "bg-[#ff5c73] text-black"
              }`}
            >
              <span className="block truncate text-[12px] leading-4 uppercase font-bold tracking-wide">
                {outcomes[index]}
              </span>
              <span className="block text-[20px] leading-6 font-bold tabular-nums">
                {percents[index] ?? "—"}%
              </span>
              <FeedMultiplier value={multipliers[index]} mode={mode} />
            </button>
          ))}
        </div>
      </div>

      {/* Chart + Activity drawers — reused from Live mobile. Portal to body
          inside LiveBottomDrawer so they sit above the BREAKING ticker. */}
      <LiveChartDrawer
        open={chartOpen}
        onClose={() => setChartOpen(false)}
        marketAddress={market.publicKey}
        names={drawerNames}
        percentages={null}
        question={market.question}
        playPlaceholder={isPlayMode}
      />
      <LiveActivityDrawer
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        marketAddress={market.publicKey}
        names={drawerNames}
        question={market.question}
        isPlay={isPlayMode}
      />
    </div>
  );
}
