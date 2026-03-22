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

function normalizeImageUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "null" || raw === "undefined") return null;
  if (raw.startsWith("/")) return raw;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw.replace(/^http:\/\//i, "https://");
}

function formatMmSs(totalSec: number | null): string | null {
  if (totalSec == null) return null;
  const safe = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function statusChipLabel(market: FlashMarket): string {
  if (market.kind === "crypto") {
    if (market.status === "active") return "LIVE";
    if (market.status === "finalized") return "RESOLVED";
    if (market.status === "cancelled") return "CANCELLED";
    return "RESOLVING";
  }
  if (market.status === "active") {
    if (market.minute != null && market.minute > 0) return `LIVE \u2022 ${market.minute}'`;
    return "LIVE";
  }
  if (market.status === "locked") return "LOCKED";
  if (market.status === "finalized") return "FINALIZED";
  if (market.status === "cancelled") return "CANCELLED";
  return "RESOLVING";
}

function statusContextLine(market: FlashMarket): string {
  if (market.kind === "crypto") {
    if (market.status === "active") return "Price tracking live";
    if (market.status === "finalized") return "Market resolved";
    if (market.status === "cancelled") return "Market cancelled";
    return "Resolving outcome";
  }
  if (market.status === "active") return "Market live now";
  if (market.status === "locked") return "Goal detected \u2014 resolving";
  if (market.status === "finalized") return "Market resolved";
  if (market.status === "cancelled") return "Market cancelled";
  return "Resolving outcome";
}

function formatCryptoPrice(price: number | null | undefined): string {
  if (price == null || price === 0) return "0";
  if (price < 0.000001) return price.toExponential(3);
  if (price < 0.01) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

function cryptoPctChange(start: number | null | undefined, end: number | null | undefined): string | null {
  if (!start || !end || start === 0) return null;
  const pct = ((end - start) / start) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatProgressPct(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.0%";
  return `${Math.max(0, Math.min(100, n)).toFixed(1)}%`;
}

function graduationStatus(progress: number, didGraduate: boolean): string {
  if (didGraduate) return "Graduated";
  if (progress >= 85) return "Near graduation";
  if (progress >= 55) return "Pushing to graduate";
  return "Falling behind";
}

function formatLoopPhaseLabel(loopPhase: string | null | undefined): string | null {
  const raw = String(loopPhase ?? "").trim();
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized === "first half" || normalized === "1st half" || normalized === "h1") return "1st half";
  if (normalized === "second half" || normalized === "2nd half" || normalized === "h2") return "2nd half";
  return raw;
}

function isTechnicalCompactId(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  if (!v) return false;
  return /^lu\d+$/i.test(v) || /^[a-z]{1,3}\d{4,}$/i.test(v);
}

/** Chip background color per status */
function chipBg(status: FlashMarket["status"]): string {
  switch (status) {
    case "active":
      return "bg-red-600/90";
    case "locked":
      return "bg-yellow-600/90";
    case "finalized":
    case "cancelled":
      return "bg-[#4b5563]";
    default:
      return "bg-sky-600/90";
  }
}

/** Context-line text color per status */
function contextColor(status: FlashMarket["status"]): string {
  switch (status) {
    case "active":
      return "text-emerald-300";
    case "locked":
      return "text-yellow-300";
    case "finalized":
    case "cancelled":
      return "text-white/50";
    default:
      return "text-sky-300";
  }
}

/** Border tone per status */
function borderTone(status: FlashMarket["status"]): string {
  switch (status) {
    case "active":
      return "border-red-500/40";
    case "locked":
      return "border-yellow-500/40";
    case "finalized":
    case "cancelled":
      return "border-white/10";
    default:
      return "border-sky-500/40";
  }
}

export default function FlashMarketCard({ market, variant = "explorer", className = "" }: FlashMarketCardProps) {
  const initialRemainingSec =
    market.status === "active" && market.remainingSec != null
      ? Math.max(0, Math.floor(Number(market.remainingSec) || 0))
      : null;
  const [liveRemainingSec, setLiveRemainingSec] = useState<number | null>(initialRemainingSec);
  const timer = market.status === "active" ? formatMmSs(liveRemainingSec) : null;
  const timerToneClass =
    liveRemainingSec == null
      ? "text-white/70"
      : liveRemainingSec <= 30
      ? "text-red-300"
      : liveRemainingSec <= 60
      ? "text-amber-200"
      : "text-white/70";
  const chipLabel = statusChipLabel(market);
  const contextLine = statusContextLine(market);
  const question = String(market.question || "").trim() || `${market.homeTeam} vs ${market.awayTeam}`;
  const windowLabel = market.loopSequence != null ? `Window #${market.loopSequence}` : null;
  const phaseLabel = formatLoopPhaseLabel(market.loopPhase);
  const leagueLabel = !isTechnicalCompactId(market.league) ? String(market.league || "").trim() : "";
  const [imgIndex, setImgIndex] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);
  const providerThumbUrl = useMemo(
    () => normalizeImageUrl(market.providerImageUrl),
    [market.providerImageUrl],
  );
  const marketImageUrl = useMemo(
    () => normalizeImageUrl(market.marketImageUrl),
    [market.marketImageUrl],
  );
  const heroImageUrl = useMemo(
    () => normalizeImageUrl(market.heroImageUrl),
    [market.heroImageUrl],
  );
  const homeLogoUrl = useMemo(() => normalizeImageUrl(market.homeLogo), [market.homeLogo]);
  const awayLogoUrl = useMemo(() => normalizeImageUrl(market.awayLogo), [market.awayLogo]);

  const imageCandidates = useMemo(() => {
    const rawCandidates = [
      market.marketImageUrl,
      market.heroImageUrl,
      market.providerImageUrl,
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const rawValue of rawCandidates) {
      const normalized = normalizeImageUrl(rawValue);
      if (!normalized) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }, [market.heroImageUrl, market.marketImageUrl, market.providerImageUrl]);

  const providerVisualUrl = useMemo(
    () => marketImageUrl || heroImageUrl || providerThumbUrl || null,
    [heroImageUrl, marketImageUrl, providerThumbUrl],
  );

  const imageUrl = useMemo(() => {
    return imageCandidates[imgIndex] ?? null;
  }, [imageCandidates, imgIndex]);
  const isBadgeLikeImage = useMemo(() => {
    if (!imageUrl) return false;
    return (
      /\/badge\//i.test(imageUrl) ||
      imageUrl === homeLogoUrl ||
      imageUrl === awayLogoUrl
    );
  }, [awayLogoUrl, homeLogoUrl, imageUrl]);

  const hasImage = !!imageUrl && !imgFailed;

  useEffect(() => {
    setImgIndex(0);
    setImgFailed(false);
  }, [market.liveMicroId, imageCandidates.join("|")]);

  useEffect(() => {
    if (imageUrl) return;
    setImgFailed(true);
  }, [imageUrl]);

  const onImageError = () => {
    const nextIndex = imgIndex + 1;
    if (nextIndex < imageCandidates.length) {
      setImgIndex(nextIndex);
      return;
    }
    setImgFailed(true);
  };

  const tone = borderTone(market.status);
  const isResolved = market.status === "finalized" || market.status === "cancelled";

  useEffect(() => {
    setLiveRemainingSec(
      market.status === "active" && market.remainingSec != null
        ? Math.max(0, Math.floor(Number(market.remainingSec) || 0))
        : null,
    );
  }, [market.liveMicroId, market.remainingSec, market.status]);

  useEffect(() => {
    if (market.status !== "active") return;
    const interval = window.setInterval(() => {
      setLiveRemainingSec((prev) => {
        if (prev == null) return null;
        return Math.max(0, prev - 1);
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [market.liveMicroId, market.status]);

  // ── CRYPTO variant ──
  if (market.kind === "crypto") {
    const cryptoMode = market.cryptoMode === "graduation" || market.cryptoType === "flash_crypto_graduation"
      ? "graduation"
      : "price";
    const tokenImg = normalizeImageUrl(market.tokenImageUri);
    const pctStr = cryptoPctChange(market.priceStart, market.priceEnd);
    const tokenSymbol = String(market.tokenSymbol || "").trim() || "TOKEN";
    const ticker = `$${tokenSymbol}`;
    const durationMinutes = Math.max(1, Number(market.durationMinutes) || 3);
    const headerThumb = tokenImg || imageUrl;
    const progressNow = Math.max(
      0,
      Math.min(
        100,
        Number(
          market.progressCurrent ??
          market.progressEnd ??
          market.progressStart ??
          0,
        ) || 0,
      ),
    );
    const didGraduate = market.didGraduateEnd === true || progressNow >= 100;
    const graduationState = graduationStatus(progressNow, didGraduate);

    if (variant === "hero") {
      return (
        <Link
          href={`/trade/${market.marketAddress}`}
          className={`block h-full rounded-2xl border ${tone} bg-[#07090e] overflow-hidden transition hover:border-white/30 ${className}`}
        >
          <div className="relative h-full">
            {hasImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl!}
                alt=""
                className={`absolute inset-0 h-full w-full ${
                  isBadgeLikeImage ? "object-contain p-4 bg-black/35" : "object-cover"
                }`}
                onError={onImageError}
              />
            ) : (
              <div
                className="absolute inset-0"
                style={{
                  background: [
                    "radial-gradient(ellipse 76% 56% at 15% 15%, rgba(16,185,129,0.16), transparent)",
                    "radial-gradient(ellipse 62% 48% at 84% 22%, rgba(59,130,246,0.14), transparent)",
                    "linear-gradient(145deg, #080e1a 0%, #0c1424 45%, #090f1c 100%)",
                  ].join(", "),
                }}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />

            <div className="relative z-10 h-full p-4 sm:p-6 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {headerThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={headerThumb}
                      alt=""
                      className="h-11 w-11 rounded-lg border border-white/20 object-cover bg-black/30"
                      onError={onImageError}
                    />
                  ) : (
                    <div className="h-11 w-11 rounded-lg border border-white/20 bg-gradient-to-br from-emerald-500/30 via-cyan-500/20 to-blue-500/30 flex items-center justify-center text-white font-black text-xs">
                      {tokenSymbol.slice(0, 5).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-2xl sm:text-3xl font-black text-white tracking-wide truncate drop-shadow-lg">
                      {ticker}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className={`inline-flex items-center rounded-full ${chipBg(market.status)} px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white`}>
                    {chipLabel}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${
                    cryptoMode === "graduation"
                      ? "border border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
                      : "border border-sky-400/40 bg-sky-400/15 text-sky-200"
                  }`}>
                    {cryptoMode === "graduation" ? "Moon or Rug" : "Crypto"}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-white/25 bg-black/45 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/90">
                    {durationMinutes === 60 ? "1H Flash" : `${durationMinutes}M Flash`}
                  </span>
                </div>
              </div>

              <div className="flex-1 flex flex-col justify-end">
                <div className="text-base sm:text-lg font-bold text-white leading-snug line-clamp-3 drop-shadow-lg">
                  {question || (cryptoMode === "graduation"
                    ? `Will ${ticker} graduate in ${durationMinutes === 60 ? "1 hour" : `${durationMinutes} minutes`}?`
                    : `Will ${ticker} go UP in ${durationMinutes} minutes?`)}
                </div>
                {cryptoMode === "graduation" ? (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs text-white/80">
                      <span>Bonding progress</span>
                      <span className={didGraduate ? "text-pump-green" : "text-cyan-200"}>
                        {formatProgressPct(progressNow)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-white/20 overflow-hidden">
                      <div
                        className={`h-full ${didGraduate ? "bg-pump-green" : "bg-cyan-300"}`}
                        style={{ width: `${progressNow}%` }}
                      />
                    </div>
                    <div className={`mt-1 text-xs font-semibold ${didGraduate ? "text-pump-green" : "text-cyan-200"}`}>
                      {graduationState}
                    </div>
                  </div>
                ) : (
                  pctStr && (
                    <div className={`mt-2 text-sm font-semibold ${(market.priceEnd ?? 0) > (market.priceStart ?? 0) ? "text-pump-green" : "text-red-300"}`}>
                      {pctStr}
                    </div>
                  )
                )}
              </div>

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/15 pt-3">
                <div className="text-sm font-semibold text-white/80">
                  {timer ? (
                    <span className={`font-mono tabular-nums ${timerToneClass}`}>{timer}</span>
                  ) : (
                    <span>{isResolved ? "Resolved" : "Awaiting update"}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${contextColor(market.status)}`}>
                    {cryptoMode === "graduation" ? graduationState : contextLine}
                  </span>
                  {market.status === "active" ? (
                    <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-emerald-300">
                      Live
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </Link>
      );
    }

    // explorer crypto card
    return (
      <Link
        href={`/trade/${market.marketAddress}`}
        className={`block rounded-2xl border ${tone} bg-[#0b0d12] overflow-hidden min-h-[238px] transition hover:border-white/30 ${className}`}
      >
        <div className="h-full flex flex-col">
          <div className="relative h-28 shrink-0">
            <div
              className="absolute inset-0"
              style={{
                background: [
                  "radial-gradient(ellipse 72% 56% at 12% 18%, rgba(139,92,246,0.16), transparent)",
                  "radial-gradient(ellipse 58% 46% at 88% 25%, rgba(16,185,129,0.14), transparent)",
                  "linear-gradient(155deg, #0a1220 0%, #0d1628 45%, #080d18 100%)",
                ].join(", "),
              }}
            />

            <div className="relative z-10 h-full p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2">
                <div className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white ${chipBg(market.status)}`}>
                  {chipLabel}
                </div>
                <div className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${
                  cryptoMode === "graduation"
                    ? "bg-cyan-500/20 border-cyan-400/40 text-cyan-200"
                    : "bg-purple-500/20 border-purple-500/40 text-purple-300"
                }`}>
                  {cryptoMode === "graduation" ? "GRADUATION" : "CRYPTO"}
                </div>
              </div>

              <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-2 py-1 text-[11px] text-white/85">
                {tokenImg && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tokenImg} alt="" className="h-4 w-4 rounded-full object-cover" />
                )}
                <span className="font-semibold">${market.tokenSymbol || "?"}</span>
                <span className="text-white/50">{market.durationMinutes}m</span>
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col p-4">
            <div className="flex-1">
              <div className="text-[13px] font-bold text-white leading-snug line-clamp-2">
                {question}
              </div>
            </div>

            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="flex items-end justify-between gap-3">
                {cryptoMode === "graduation" ? (
                  <>
                    <div className="text-sm font-semibold text-cyan-200">{formatProgressPct(progressNow)}</div>
                    <span className={`text-xs font-semibold ${didGraduate ? "text-pump-green" : contextColor(market.status)}`}>
                      {graduationState}
                    </span>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-mono text-white/80">
                      {formatCryptoPrice(market.priceStart)}
                    </div>
                    <span className={`text-xs font-semibold ${contextColor(market.status)}`}>{contextLine}</span>
                  </>
                )}
              </div>
              {cryptoMode === "graduation" && (
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full ${didGraduate ? "bg-pump-green" : "bg-cyan-300"}`}
                    style={{ width: `${progressNow}%` }}
                  />
                </div>
              )}
              <div className="mt-1 text-[11px] text-white/60">
                {timer ? (
                  <span>{timer} left</span>
                ) : (
                  <span>{isResolved ? "Resolved" : "Awaiting update"}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  // ── HERO variant (Home carousel full-width slide) ──
  if (variant === "hero") {
    return (
      <Link
        href={`/trade/${market.marketAddress}`}
        className={`block h-full rounded-2xl border ${tone} bg-[#07090e] overflow-hidden transition hover:border-white/30 ${className}`}
      >
        <div className="relative h-full">
          {/* Background: image or gradient fallback */}
          {hasImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl!}
              alt=""
              className={`absolute inset-0 h-full w-full ${
                isBadgeLikeImage ? "object-contain p-4 bg-black/30" : "object-cover"
              }`}
              onError={onImageError}
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background: [
                  "radial-gradient(ellipse 80% 60% at 15% 20%, rgba(16,185,129,0.18), transparent)",
                  "radial-gradient(ellipse 60% 50% at 85% 30%, rgba(59,130,246,0.16), transparent)",
                  "radial-gradient(ellipse 50% 40% at 50% 80%, rgba(139,92,246,0.10), transparent)",
                  "linear-gradient(145deg, #080e1a 0%, #0c1424 40%, #090f1c 100%)",
                ].join(", "),
              }}
            />
          )}

          {/* Overlay */}
          <div
            className={`absolute inset-0 ${
              hasImage
                ? "bg-gradient-to-t from-black/75 via-black/30 to-black/5"
                : "bg-gradient-to-t from-black/60 via-black/20 to-transparent"
            }`}
          />

          {/* Content */}
          <div className={`relative z-10 h-full p-4 sm:p-6 flex flex-col ${hasImage ? "justify-between" : "justify-between"}`}>
            {/* Top row: status chip + league */}
            <div className="flex items-start justify-between gap-3">
              <div className={`inline-flex items-center gap-1.5 rounded-full ${chipBg(market.status)} px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white ${
                market.status === "active" ? "shadow-[0_8px_24px_rgba(220,38,38,0.35)]" : ""
              }`}>
                {chipLabel}
              </div>
              <div className="flex items-center gap-2">
                {providerVisualUrl ? (
                  <div className="h-6 w-10 overflow-hidden rounded border border-white/20 bg-black/50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={providerVisualUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                ) : null}
                {leagueLabel ? (
                  <div className="rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/85">
                    {leagueLabel}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Center: score (prominent, fills the visual gap) */}
            <div className="flex flex-col items-center justify-center text-center">
              <div className="text-6xl sm:text-7xl font-black tabular-nums text-white tracking-wide drop-shadow-lg">
                {market.currentScoreHome}&ndash;{market.currentScoreAway}
              </div>
              <div className="mt-2 flex items-center justify-center gap-2 text-sm sm:text-base font-medium text-white/70 line-clamp-1">
                {homeLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={homeLogoUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : null}
                <span className="truncate">{market.homeTeam}</span>
                <span className="text-white/55">vs</span>
                {awayLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={awayLogoUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : null}
                <span className="truncate">{market.awayTeam}</span>
              </div>
            </div>

            {/* Bottom: question + status + CTA */}
            <div className="space-y-1.5">
              <div className="text-base sm:text-lg font-bold text-white leading-snug line-clamp-2 drop-shadow-lg">
                {question}
              </div>
              {(windowLabel || phaseLabel) && (
                <div className="flex items-center gap-2 text-[11px] sm:text-xs min-h-[20px]">
                  {windowLabel ? (
                    <span className="inline-flex items-center rounded-full border border-[#61ff9a]/40 bg-[#61ff9a]/10 px-2 py-0.5 font-semibold text-[#61ff9a]">
                      {windowLabel}
                    </span>
                  ) : null}
                  {phaseLabel ? (
                    <span className="text-white/60 font-medium">{phaseLabel}</span>
                  ) : null}
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                <span className={`font-semibold ${contextColor(market.status)}`}>{contextLine}</span>
                {timer ? (
                  <span className="text-white/70">{timer} left</span>
                ) : null}
              </div>

              {!isResolved && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3.5 py-1 text-xs font-semibold text-emerald-300">
                    YES
                  </span>
                  <span className="inline-flex items-center rounded-full border border-rose-400/40 bg-rose-400/10 px-3.5 py-1 text-xs font-semibold text-rose-300">
                    NO
                  </span>
                </div>
              )}
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
      className={`block rounded-2xl border ${tone} bg-[#0b0d12] overflow-hidden min-h-[238px] transition hover:border-white/30 ${className}`}
    >
      <div className="h-full flex flex-col">
        <div className="relative h-28 shrink-0">
          {hasImage ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl!}
                alt=""
                className={`absolute inset-0 h-full w-full object-center ${
                  isBadgeLikeImage ? "object-contain p-2 bg-black/30" : "object-cover"
                }`}
                onError={onImageError}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />
            </>
          ) : (
            <div
              className="absolute inset-0"
              style={{
                background: [
                  "radial-gradient(ellipse 72% 56% at 12% 18%, rgba(16,185,129,0.16), transparent)",
                  "radial-gradient(ellipse 58% 46% at 88% 25%, rgba(59,130,246,0.14), transparent)",
                  "linear-gradient(155deg, #0a1220 0%, #0d1628 45%, #080d18 100%)",
                ].join(", "),
              }}
            />
          )}

          <div className="relative z-10 h-full p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2">
              <div className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white ${chipBg(market.status)}`}>
                {chipLabel}
              </div>
              <div className="flex items-center gap-2">
                {providerVisualUrl ? (
                  <div className="h-5 w-8 overflow-hidden rounded border border-white/20 bg-black/50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={providerVisualUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                ) : null}
                {leagueLabel ? (
                  <div className="text-[10px] text-white/75 uppercase tracking-[0.08em] truncate">
                    {leagueLabel}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/20 bg-black/45 px-2 py-1 text-[11px] text-white/85">
              {homeLogoUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={homeLogoUrl} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                </>
              ) : null}
              <span className="truncate">{market.homeTeam}</span>
              <span className="text-white/60">vs</span>
              {awayLogoUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={awayLogoUrl} alt="" className="h-3.5 w-3.5 rounded-full object-cover" />
                </>
              ) : null}
              <span className="truncate">{market.awayTeam}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col p-4">
          <div className="flex-1">
            <div className="text-[13px] font-bold text-white leading-snug line-clamp-2">
              {question}
            </div>
            {(windowLabel || phaseLabel) && (
              <div className="mt-1 flex items-center gap-2 text-[11px] min-h-[20px]">
                {windowLabel ? (
                  <span className="inline-flex items-center rounded-full border border-[#61ff9a]/40 bg-[#61ff9a]/10 px-2 py-0.5 font-semibold text-[#61ff9a]">
                    {windowLabel}
                  </span>
                ) : null}
                {phaseLabel ? (
                  <span className="text-white/60 font-medium">{phaseLabel}</span>
                ) : null}
              </div>
            )}
          </div>

          <div className="mt-3 border-t border-white/10 pt-3">
            <div className="flex items-end justify-between gap-3">
              <div className="text-3xl font-black tabular-nums text-white">
                {market.currentScoreHome}&ndash;{market.currentScoreAway}
              </div>
              <span className={`text-xs font-semibold ${contextColor(market.status)}`}>{contextLine}</span>
            </div>
            <div className="mt-1 text-[11px] text-white/60">
              {timer ? (
                <span>{timer} left</span>
              ) : (
                <span>{market.status === "finalized" ? "Resolved" : "Awaiting update"}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
