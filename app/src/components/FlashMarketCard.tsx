"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FlashMarket } from "@/lib/flashMarkets/types";

type FlashMarketCardVariant = "explorer" | "hero";

type FlashMarketCardProps = {
  market: FlashMarket;
  variant?: FlashMarketCardVariant;
  className?: string;
};

function formatMmSs(totalSec: number | null): string | null {
  if (totalSec == null) return null;
  const safe = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function statusChipLabel(market: FlashMarket): string {
  if (market.status === "active") {
    if (market.minute != null && market.minute > 0) return `LIVE • ${market.minute}'`;
    return "LIVE";
  }
  if (market.status === "locked") return "LOCKED";
  if (market.status === "finalized") return "FINALIZED";
  if (market.status === "cancelled") return "CANCELLED";
  return "RESOLVING";
}

/** Contextual one-liner shown below the score */
function statusContextLine(market: FlashMarket): string {
  if (market.status === "active") return "Market live now";
  if (market.status === "locked") return "Goal detected — resolving";
  if (market.status === "finalized") return "Market resolved";
  if (market.status === "cancelled") return "Market cancelled";
  return "Resolving outcome";
}

export default function FlashMarketCard({ market, variant = "explorer", className = "" }: FlashMarketCardProps) {
  const timer = market.status === "active" ? formatMmSs(market.remainingSec) : null;
  const chipLabel = statusChipLabel(market);
  const contextLine = statusContextLine(market);
  const [imgIndex, setImgIndex] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);

  const imageCandidates = useMemo(() => {
    const rawCandidates = [
      market.heroImageUrl,
      market.marketImageUrl,
      market.providerImageUrl,
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const rawValue of rawCandidates) {
      const raw = String(rawValue || "").trim();
      if (!raw || raw === "null" || raw === "undefined") continue;
      if (!/^https?:\/\//i.test(raw)) continue;
      const normalized = raw.replace(/^http:\/\//i, "https://");
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }, [market.heroImageUrl, market.marketImageUrl, market.providerImageUrl]);

  const imageUrl = useMemo(() => {
    return imageCandidates[imgIndex] ?? null;
  }, [imageCandidates, imgIndex]);

  const hasImage = !!imageUrl && !imgFailed;

  // Reset on market change
  useEffect(() => {
    setImgIndex(0);
    setImgFailed(false);
  }, [market.liveMicroId, imageCandidates.join("|")]);

  // Mark failed if no candidates at all
  useEffect(() => {
    if (imageUrl) return;
    setImgFailed(true);
  }, [imageUrl]);

  // DEV debug logs
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const renderMode = hasImage ? "img" : "fallback";
    const sourceUsed = hasImage
      ? (imageUrl === market.heroImageUrl
          ? "heroImageUrl"
          : imageUrl === market.providerImageUrl
          ? "providerImageUrl"
          : imageUrl === market.marketImageUrl
          ? "marketImageUrl"
          : `candidateIndex:${imgIndex}`)
      : "none";
    console.debug("[home-live-carousel-image-debug]", {
      liveMicroId: market.liveMicroId,
      marketAddress: market.marketAddress,
      selectedImage: imageUrl,
      candidateImages: imageCandidates,
      sourceUsed,
      renderMode,
      heroImageUrlRaw: market.heroImageUrl,
      providerImageUrlRaw: market.providerImageUrl,
      marketImageUrlRaw: market.marketImageUrl,
      imgIndex,
      imgFailed,
    });
    if (renderMode === "fallback") {
      console.warn("[home-live-carousel-image-fallback]", {
        liveMicroId: market.liveMicroId,
        reason: imageCandidates.length === 0
          ? "no valid image candidates found"
          : imgFailed
          ? `all ${imageCandidates.length} candidates failed to load`
          : "unknown",
      });
    }
  }, [market, imageCandidates, imgIndex, imageUrl, hasImage, imgFailed]);

  const onImageError = () => {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[home-live-carousel-image-error]", {
        liveMicroId: market.liveMicroId,
        attemptedSrc: imageUrl,
        candidateIndex: imgIndex,
        candidateCount: imageCandidates.length,
        nextCandidate: imageCandidates[imgIndex + 1] ?? "none (will fallback to gradient)",
      });
    }
    const nextIndex = imgIndex + 1;
    if (nextIndex < imageCandidates.length) {
      setImgIndex(nextIndex);
      return;
    }
    setImgFailed(true);
  };

  const tone =
    market.status === "active"
      ? "border-red-500/40"
      : market.status === "locked"
      ? "border-yellow-500/40"
      : market.status === "finalized" || market.status === "cancelled"
      ? "border-gray-500/40"
      : "border-sky-500/40";

  // ── HERO variant (Home carousel full-width slide) ──
  if (variant === "hero") {
    return (
      <Link
        href={`/trade/${market.marketAddress}`}
        className={`block h-full rounded-2xl border ${tone} bg-[#07090e] overflow-hidden transition hover:border-white/40 ${className}`}
      >
        <div className="relative h-full">
          {/* Background: image or gradient fallback */}
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl!}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={onImageError}
            />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(34,197,94,0.22),transparent_42%),radial-gradient(circle_at_80%_15%,rgba(59,130,246,0.24),transparent_48%),linear-gradient(140deg,#07111f,#0a1628,#050a13)]" />
          )}

          {/* Overlay — lighter when image present so it stays visible */}
          <div
            className={`absolute inset-0 ${
              hasImage
                ? "bg-gradient-to-t from-black/75 via-black/30 to-black/5"
                : "bg-gradient-to-t from-black/90 via-black/50 to-black/15"
            }`}
          />

          {/* Content */}
          <div className="relative z-10 h-full p-4 sm:p-6 flex flex-col">
            {/* Top row: LIVE chip + league tag */}
            <div className="flex items-start justify-between gap-3">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-red-600/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_8px_24px_rgba(220,38,38,0.35)]">
                {chipLabel}
              </div>
              <div className="rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/85">
                {market.league || market.sport || "Sports"}
              </div>
            </div>

            {/* Bottom content — no border box, content sits directly on overlay */}
            <div className="mt-auto space-y-1">
              {/* Question = primary headline */}
              <div className="text-lg sm:text-xl font-bold text-white leading-snug line-clamp-2 drop-shadow-lg">
                Will there be a goal in the next 5 minutes?
              </div>

              {/* Match name */}
              <div className="text-sm sm:text-base font-medium text-white/80 line-clamp-1">
                {market.homeTeam} vs {market.awayTeam}
              </div>

              {/* Score */}
              <div className="text-4xl sm:text-5xl font-black tabular-nums text-white tracking-wide drop-shadow-lg">
                {market.currentScoreHome}–{market.currentScoreAway}
              </div>

              {/* Status line + timer */}
              <div className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-emerald-300">{contextLine}</span>
                {timer ? (
                  <span className="text-white/70">{timer} left</span>
                ) : null}
              </div>

              {/* YES / NO CTAs */}
              <div className="flex items-center gap-2 pt-2">
                <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3.5 py-1 text-xs font-semibold text-emerald-300">
                  YES
                </span>
                <span className="inline-flex items-center rounded-full border border-rose-400/40 bg-rose-400/10 px-3.5 py-1 text-xs font-semibold text-rose-300">
                  NO
                </span>
              </div>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // ── EXPLORER variant (card in grid/scroll) ──
  return (
    <Link
      href={`/trade/${market.marketAddress}`}
      className={`block rounded-2xl border ${tone} bg-[#0b0d12] overflow-hidden min-h-[230px] transition hover:border-white/40 ${className}`}
    >
      <div className="relative h-full flex flex-col">
        {/* Background image or gradient */}
        {hasImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl!}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={onImageError}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />
          </>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_10%,rgba(34,197,94,0.18),transparent_50%),linear-gradient(160deg,#0b1120,#0a0e18)]" />
        )}

        {/* Card content */}
        <div className="relative z-10 flex flex-col h-full p-4">
          {/* Top: status chip + league */}
          <div className="flex items-center justify-between gap-2">
            <div className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white ${
              market.status === "active"
                ? "bg-red-600/90"
                : market.status === "locked"
                ? "bg-yellow-600/90"
                : market.status === "finalized" || market.status === "cancelled"
                ? "bg-gray-600/90"
                : "bg-sky-600/90"
            }`}>
              {chipLabel}
            </div>
            <div className="text-[10px] text-white/55 uppercase tracking-[0.08em] truncate">
              {market.league || market.sport || "Sports"}
            </div>
          </div>

          {/* Middle: question + match */}
          <div className="mt-3 flex-1">
            <div className="text-[13px] font-bold text-white leading-snug line-clamp-2">
              Will there be a goal in the next 5 min?
            </div>
            <div className="mt-1 text-xs text-white/65 line-clamp-1">
              {market.homeTeam} vs {market.awayTeam}
            </div>
          </div>

          {/* Bottom: score + status */}
          <div className="mt-auto pt-2">
            <div className="text-3xl font-black tabular-nums text-white">
              {market.currentScoreHome}–{market.currentScoreAway}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs font-semibold text-emerald-300">{contextLine}</span>
              {timer ? (
                <span className="text-[11px] text-white/60">{timer}</span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
