"use client";

/**
 * CRYPTO DAILY (24H) — immersive hero card.
 *
 * Used by FlashMarketCard's "hero" variant for 24h crypto price markets, so
 * the mobile home feed and the desktop home carousel both render it without a
 * second card system. It reuses the existing Flash Crypto chart (compact
 * variant) and the existing feed trade sheet — tapping YES/NO trades in place.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FlashCryptoMiniChart from "@/components/FlashCryptoMiniChart";
import {
  useMarketSnapshot,
  useMarketSnapshotActions,
  type MarketSnapshot,
} from "@/components/mode/MarketSnapshotProvider";
import { getMarketByAddress } from "@/lib/markets";
import {
  formatFlashCryptoChangeVsTarget,
  formatFlashCryptoCountdown,
  formatFlashCryptoUsdPrice,
} from "@/lib/flashCrypto/daily";
import type { FlashMarket } from "@/lib/flashMarkets/types";

/** The shape FeedTradeSheet needs — built from the market row we fetch here. */
export type FlashCryptoTradeTarget = {
  publicKey: string;
  dbId?: string;
  question: string;
  creator?: string | null;
  marketType?: number;
  outcomeNames?: string[];
  outcomeSupplies?: number[];
  yesSupply?: number;
  noSupply?: number;
};

type CryptoDailyHeroCardProps = {
  market: FlashMarket;
  className?: string;
  /** Provided by the mobile feed — enables direct YES/NO trading from the card. */
  onOutcomeTap?: (outcomeIndex: number, target: FlashCryptoTradeTarget) => void;
  /** Feed only: lets the page persist the scroll position before navigating. */
  onNavigate?: () => void;
};

/** Feed cadence: a 24h market does not need a 2s tick. */
const FEED_PRICE_POLL_MS = 6000;

export default function CryptoDailyHeroCard({
  market,
  className = "",
  onOutcomeTap,
  onNavigate,
}: CryptoDailyHeroCardProps) {
  const marketAddress = String(market.marketAddress || "").trim();
  const priceToBeat = Number(market.priceStart) || 0;
  const symbol = String(market.majorSymbol || market.tokenSymbol || "").trim().toUpperCase() || "TOKEN";
  const isMajor = market.cryptoSourceType === "major";
  const pairLabel = isMajor ? `${symbol} / USD` : `$${symbol}`;
  const tokenImage = String(market.tokenImageUri || "").trim() || null;
  const isEnded = market.status !== "active";

  // ── Live price (also fed by the chart's own sampling) ──
  const [currentPrice, setCurrentPrice] = useState<number | null>(
    Number(market.priceEnd) > 0 ? Number(market.priceEnd) : null,
  );
  const handlePriceSample = useCallback((price: number) => {
    setCurrentPrice(price);
  }, []);

  // ── Countdown from the market's end_date, never a local timer ──
  const windowEndMs = Date.parse(String(market.windowEnd || ""));
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (isEnded || !Number.isFinite(windowEndMs)) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isEnded, windowEndMs]);
  const remainingSec = Number.isFinite(windowEndMs)
    ? Math.max(0, Math.ceil((windowEndMs - nowMs) / 1000))
    : null;

  // ── Market economics: one row fetch, then the shared mode-aware snapshot ──
  const [row, setRow] = useState<FlashCryptoTradeTarget | null>(null);
  const [realFallback, setRealFallback] = useState<MarketSnapshot | null>(null);
  const { publishRealSnapshots, watchPlayMarket } = useMarketSnapshotActions();
  const fetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    // One fetch per address for the lifetime of the card. No cancel flag on
    // cleanup: React 18 dev remounts effects, and cancelling the only in-flight
    // request would leave the card without economics for good.
    if (!marketAddress || fetchedForRef.current === marketAddress) return;
    fetchedForRef.current = marketAddress;

    void (async () => {
      try {
        const dbRow = await getMarketByAddress(marketAddress);
        if (!dbRow) {
          fetchedForRef.current = null;
          return;
        }

        const outcomeNames = Array.isArray((dbRow as any).outcome_names)
          ? (dbRow as any).outcome_names.map((x: any) => String(x)).filter(Boolean)
          : ["YES", "NO"];
        const outcomeSupplies = Array.isArray((dbRow as any).outcome_supplies)
          ? (dbRow as any).outcome_supplies.map((x: any) => Number(x) || 0)
          : [Number((dbRow as any).yes_supply || 0), Number((dbRow as any).no_supply || 0)];

        setRow({
          publicKey: marketAddress,
          dbId: (dbRow as any).id,
          question: String((dbRow as any).question || market.question || ""),
          creator: (dbRow as any).creator ?? null,
          marketType: Number((dbRow as any).market_type || 0),
          outcomeNames,
          outcomeSupplies,
          yesSupply: Number((dbRow as any).yes_supply || 0),
          noSupply: Number((dbRow as any).no_supply || 0),
        });

        const total = outcomeSupplies.reduce((a: number, b: number) => a + b, 0);
        setRealFallback({
          mode: "real",
          marketAddress,
          supplies: outcomeSupplies.map(String),
          probabilities:
            total > 0
              ? outcomeSupplies.map((s: number) => s / total)
              : outcomeSupplies.map(() => 1 / Math.max(outcomeSupplies.length, 1)),
          volume: String((dbRow as any).total_volume ?? 0),
          status: (dbRow as any).resolved ? "resolved" : "open",
        });
      } catch {
        // No economics yet — the card still renders price/chart/timer, and a
        // later remount may retry.
        fetchedForRef.current = null;
      }
    })();
  }, [market.question, marketAddress]);

  // Registering the address is what lets the provider load its Play book.
  useEffect(() => {
    if (!realFallback) return;
    publishRealSnapshots([realFallback]);
  }, [publishRealSnapshots, realFallback]);

  useEffect(() => {
    if (!marketAddress) return;
    return watchPlayMarket(marketAddress);
  }, [marketAddress, watchPlayMarket]);

  const { snapshot } = useMarketSnapshot(marketAddress, realFallback ?? undefined);

  const percents = useMemo(() => {
    if (!snapshot || snapshot.probabilities.length < 2) return null;
    return [
      Math.round(snapshot.probabilities[0]! * 100),
      Math.round(snapshot.probabilities[1]! * 100),
    ];
  }, [snapshot]);

  // ── Presentation ──
  const changeVsTarget = formatFlashCryptoChangeVsTarget(priceToBeat, currentPrice);
  const isUp = currentPrice != null && priceToBeat > 0 && currentPrice > priceToBeat;
  const isDown = currentPrice != null && priceToBeat > 0 && currentPrice < priceToBeat;
  const changeTone = isUp ? "text-pump-green" : isDown ? "text-red-300" : "text-white/70";
  const question =
    String(market.question || "").trim() || `${isMajor ? symbol : `$${symbol}`} UP OR DOWN IN 24H?`;

  const canTrade = !isEnded && !!onOutcomeTap && !!row;

  const handleOutcome = (index: number) => {
    if (!onOutcomeTap || !row) return;
    onOutcomeTap(index, row);
  };

  return (
    <div
      className={`relative h-full overflow-hidden bg-[#07090e] border ${
        isEnded ? "border-white/10" : "border-sky-500/35"
      } rounded-2xl ${className}`}
    >
      <div
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(ellipse 78% 56% at 14% 12%, rgba(56,189,248,0.16), transparent)",
            "radial-gradient(ellipse 62% 48% at 86% 24%, rgba(16,185,129,0.14), transparent)",
            "linear-gradient(150deg, #070d18 0%, #0a1322 48%, #070c16 100%)",
          ].join(", "),
        }}
      />

      {/* pt-20 on mobile clears the feed's fixed overlay header (mode switch). */}
      <div className="relative z-10 flex h-full flex-col p-4 pb-28 pt-20 sm:p-6 sm:pb-6 sm:pt-6">
        {/* ── Header: token + badges + timer ── */}
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/trade/${marketAddress}`}
            onClick={onNavigate}
            className="flex min-w-0 items-center gap-3"
          >
            {tokenImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tokenImage}
                alt=""
                className="h-11 w-11 rounded-full border border-white/20 bg-black/40 object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/5 text-xs font-black text-white">
                {symbol.slice(0, 4)}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-xl font-black tracking-wide text-white sm:text-2xl">
                {pairLabel}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="inline-flex items-center rounded-full border border-sky-400/40 bg-sky-400/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-sky-200">
                  24H Crypto
                </span>
                {!isEnded ? (
                  <span className="inline-flex items-center rounded-full bg-red-600/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white">
                    Live
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-[#4b5563] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white">
                    {market.status === "cancelled" ? "Cancelled" : market.status === "finalized" ? "Resolved" : "Resolving"}
                  </span>
                )}
              </div>
            </div>
          </Link>

          <div className="shrink-0 rounded-xl border border-white/15 bg-black/40 px-3 py-1.5 text-center">
            <div className="font-mono text-lg font-black tabular-nums leading-none text-white sm:text-xl">
              {isEnded ? "--:--:--" : formatFlashCryptoCountdown(remainingSec)}
            </div>
            <div className="mt-1 text-[8px] uppercase tracking-[0.14em] text-white/45">
              {isEnded ? "Ended" : "Time left"}
            </div>
          </div>
        </div>

        {/* ── Prices ── */}
        <div className="mt-5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/45">Current price</div>
            <div
              className={`text-3xl font-black tabular-nums leading-tight sm:text-4xl ${
                isUp ? "text-pump-green" : isDown ? "text-red-300" : "text-white"
              }`}
            >
              {currentPrice == null ? "—" : formatFlashCryptoUsdPrice(currentPrice)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/45">Price to beat</div>
            <div className="text-lg font-semibold tabular-nums text-white/80 sm:text-xl">
              {formatFlashCryptoUsdPrice(priceToBeat)}
            </div>
            {changeVsTarget ? (
              <div className={`text-xs font-bold tabular-nums ${changeTone}`}>
                {changeVsTarget} vs target
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Chart: live series + dashed price-to-beat reference ──
            Fills the free height in the feed; fixed and compact in the desktop
            carousel slide, which is only 400px tall. */}
        <div className="mt-3 min-h-[120px] flex-1 sm:h-[96px] sm:flex-none md:h-[104px]">
          {marketAddress ? (
            <FlashCryptoMiniChart
              tokenMint={String(market.majorPair || market.tokenMint || "")}
              sourceType={market.cryptoSourceType ?? null}
              majorSymbol={market.majorSymbol ?? null}
              majorPair={market.majorPair ?? null}
              priceStart={priceToBeat}
              windowEnd={market.windowEnd}
              isEnded={isEnded}
              finalPrice={market.priceEnd ?? null}
              tokenSymbol={symbol}
              tokenName={market.tokenName || symbol}
              durationMinutes={market.durationMinutes ?? null}
              pollIntervalMs={FEED_PRICE_POLL_MS}
              variant="compact"
              className="h-full"
              onPriceSample={handlePriceSample}
            />
          ) : null}
        </div>

        {/* ── Question + YES/NO ── */}
        <div className="mt-3 space-y-3">
          <Link
            href={`/trade/${marketAddress}`}
            onClick={onNavigate}
            className="block text-base font-bold leading-snug text-white drop-shadow-lg sm:text-lg"
          >
            {question}
          </Link>

          {isEnded ? (
            <div className="text-xs font-semibold text-white/55">
              {market.status === "cancelled" ? "Market cancelled" : "Awaiting settlement"}
            </div>
          ) : canTrade ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleOutcome(0)}
                className="flex-1 rounded-xl border border-emerald-400/45 bg-emerald-400/15 px-3 py-3 text-left transition active:scale-[0.99]"
              >
                <div className="text-sm font-black uppercase tracking-wide text-emerald-300">Yes · Up</div>
                <div className="text-xs font-semibold text-emerald-200/80">
                  {percents ? `${percents[0]}%` : "—"}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleOutcome(1)}
                className="flex-1 rounded-xl border border-rose-400/45 bg-rose-400/15 px-3 py-3 text-left transition active:scale-[0.99]"
              >
                <div className="text-sm font-black uppercase tracking-wide text-rose-300">No · Down</div>
                <div className="text-xs font-semibold text-rose-200/80">
                  {percents ? `${percents[1]}%` : "—"}
                </div>
              </button>
            </div>
          ) : (
            <Link href={`/trade/${marketAddress}`} onClick={onNavigate} className="flex gap-2">
              <span className="flex-1 rounded-xl border border-emerald-400/45 bg-emerald-400/15 px-3 py-3 text-left">
                <span className="block text-sm font-black uppercase tracking-wide text-emerald-300">Yes · Up</span>
                <span className="block text-xs font-semibold text-emerald-200/80">
                  {percents ? `${percents[0]}%` : "—"}
                </span>
              </span>
              <span className="flex-1 rounded-xl border border-rose-400/45 bg-rose-400/15 px-3 py-3 text-left">
                <span className="block text-sm font-black uppercase tracking-wide text-rose-300">No · Down</span>
                <span className="block text-xs font-semibold text-rose-200/80">
                  {percents ? `${percents[1]}%` : "—"}
                </span>
              </span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
