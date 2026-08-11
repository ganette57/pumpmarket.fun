"use client";

/**
 * CRYPTO DAILY (24H) — hero card.
 *
 * Used by FlashMarketCard's "hero" variant for 24h crypto price markets, so
 * the mobile home feed and the desktop home carousel both render it without a
 * second card system. It reuses the existing Flash Crypto chart (compact
 * variant), the existing feed trade sheet, and the existing chart/activity
 * drawers — nothing here is a parallel implementation.
 *
 * Two layouts, one component:
 *   feed     — full-height immersive card, direct YES/NO trading.
 *   carousel — desktop Top Markets slide: info + outcomes left, big chart right.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity as ActivityIcon, BarChart3 } from "lucide-react";
import FlashCryptoMiniChart from "@/components/FlashCryptoMiniChart";
import {
  LiveActivityDrawer,
  LiveChartDrawer,
} from "@/components/LiveMobileContent";
import {
  useMarketSnapshot,
  useMarketSnapshotActions,
  type MarketSnapshot,
} from "@/components/mode/MarketSnapshotProvider";
import { getMarketByAddress } from "@/lib/markets";
import { triggerHaptic } from "@/utils/haptics";
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
  /** "feed" = immersive mobile card, "carousel" = desktop Top Markets slide. */
  layout?: "feed" | "carousel";
  /** Provided by the mobile feed — enables direct YES/NO trading from the card. */
  onOutcomeTap?: (outcomeIndex: number, target: FlashCryptoTradeTarget) => void;
  /** Feed only: lets the page persist the scroll position before navigating. */
  onNavigate?: () => void;
};

/**
 * The card on screen samples once a second so the market feels live. Cards
 * scrolled off screen stop sampling entirely (see the IntersectionObserver
 * below), so a feed full of crypto cards never fans out into N polls/second.
 */
const LIVE_PRICE_POLL_MS = 1000;

export default function CryptoDailyHeroCard({
  market,
  className = "",
  layout = "feed",
  onOutcomeTap,
  onNavigate,
}: CryptoDailyHeroCardProps) {
  const isCarousel = layout === "carousel";
  const marketAddress = String(market.marketAddress || "").trim();
  const priceToBeat = Number(market.priceStart) || 0;
  const symbol = String(market.majorSymbol || market.tokenSymbol || "").trim().toUpperCase() || "TOKEN";
  const isMajor = market.cryptoSourceType === "major";
  const pairLabel = isMajor ? `${symbol} / USD` : `$${symbol}`;
  const tokenImage = String(market.tokenImageUri || "").trim() || null;
  const isEnded = market.status !== "active";

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [chartOpen, setChartOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  // ── Only the visible card samples the price API ──
  // Starts false on purpose: both surfaces are mounted at once (the desktop
  // carousel is display:none on mobile and vice versa), so a card must prove it
  // is on screen before it starts sampling.
  const [isOnScreen, setIsOnScreen] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setIsOnScreen(entry.isIntersecting && entry.intersectionRatio >= 0.5);
      },
      { threshold: [0, 0.5, 0.9] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Live price (sampled by the chart, mirrored here for the readout) ──
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

  const { snapshot, mode } = useMarketSnapshot(marketAddress, realFallback ?? undefined);
  const isPlayMode = mode === "play";

  const percents = useMemo(() => {
    if (!snapshot || snapshot.probabilities.length < 2) return null;
    return [
      Math.round(snapshot.probabilities[0]! * 100),
      Math.round(snapshot.probabilities[1]! * 100),
    ];
  }, [snapshot]);

  const outcomeNames = row?.outcomeNames && row.outcomeNames.length >= 2 ? row.outcomeNames : ["YES", "NO"];

  /**
   * The sheet trades off the freshest supplies we have. In Real that is the
   * snapshot the provider re-publishes after every buy, so a second trade
   * quotes against post-trade state rather than the row fetched at mount.
   */
  const tradeTarget = useMemo<FlashCryptoTradeTarget | null>(() => {
    if (!row) return null;
    if (mode !== "real" || !snapshot || snapshot.supplies.length < 2) return row;
    const supplies = snapshot.supplies.map((s) => Number(s) || 0);
    return {
      ...row,
      outcomeSupplies: supplies,
      yesSupply: supplies[0] ?? row.yesSupply,
      noSupply: supplies[1] ?? row.noSupply,
    };
  }, [mode, row, snapshot]);

  // ── Presentation ──
  const changeVsTarget = formatFlashCryptoChangeVsTarget(priceToBeat, currentPrice);
  const isUp = currentPrice != null && priceToBeat > 0 && currentPrice > priceToBeat;
  const isDown = currentPrice != null && priceToBeat > 0 && currentPrice < priceToBeat;
  const changeTone = isUp ? "text-pump-green" : isDown ? "text-red-300" : "text-white/70";
  const question =
    String(market.question || "").trim() || `${isMajor ? symbol : `$${symbol}`} UP OR DOWN IN 24H?`;

  const canTrade = !isEnded && !!onOutcomeTap && !!tradeTarget;

  const handleOutcome = (index: number) => {
    if (!onOutcomeTap || !tradeTarget) return;
    triggerHaptic("light");
    onOutcomeTap(index, tradeTarget);
  };

  const chart = marketAddress ? (
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
      pollIntervalMs={LIVE_PRICE_POLL_MS}
      variant="compact"
      className="h-full"
      active={isOnScreen}
      onPriceSample={handlePriceSample}
    />
  ) : null;

  const timer = (
    <div className={isCarousel ? "text-left" : "text-right"}>
      <div className="font-mono text-xl font-black tabular-nums leading-none text-white sm:text-2xl">
        {isEnded ? "--:--:--" : formatFlashCryptoCountdown(remainingSec)}
      </div>
      <div className="mt-1 text-[9px] uppercase tracking-[0.18em] text-white/45">
        {isEnded ? "Ended" : "Time left"}
      </div>
    </div>
  );

  const badges = (
    <div className="flex items-center gap-1.5">
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
  );

  /** Same graph/activity actions every other feed market exposes. */
  const quickActions = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Open market chart"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          triggerHaptic("light");
          setChartOpen(true);
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/85 backdrop-blur-sm transition active:scale-95"
      >
        <BarChart3 className="h-3.5 w-3.5" />
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
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/40 text-white/85 backdrop-blur-sm transition active:scale-95"
      >
        <ActivityIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  /**
   * Outcome buttons use the same solid colours as the standard feed market
   * buttons (HomeFeedItem / MarketCard): #00FF87 and #ff5c73 with black text.
   */
  const outcomeLabel = (index: number) => (index === 0 ? `${outcomeNames[0]} · UP` : `${outcomeNames[1]} · DOWN`);
  const outcomePct = (index: number) => (percents ? `${percents[index]}%` : "—");

  const outcomeButtons = (stacked: boolean) => {
    const base = `flex items-center justify-between gap-2 rounded-xl px-3 py-3 transition-transform duration-150 ease-out active:scale-[0.965] ${
      stacked ? "w-full" : "min-w-0 flex-1"
    }`;
    const label = "min-w-0 truncate text-[12px] font-bold uppercase tracking-wide text-black";
    const pct = "shrink-0 text-[20px] font-bold text-black";

    if (isEnded) {
      return (
        <div className="text-xs font-semibold text-white/55">
          {market.status === "cancelled" ? "Market cancelled" : "Awaiting settlement"}
        </div>
      );
    }

    if (canTrade) {
      return (
        <div className={stacked ? "flex flex-col gap-2" : "flex gap-2"}>
          <button type="button" onClick={() => handleOutcome(0)} className={`${base} bg-[#00FF87]`}>
            <span className={label}>{outcomeLabel(0)}</span>
            <span className={pct}>{outcomePct(0)}</span>
          </button>
          <button type="button" onClick={() => handleOutcome(1)} className={`${base} bg-[#ff5c73]`}>
            <span className={label}>{outcomeLabel(1)}</span>
            <span className={pct}>{outcomePct(1)}</span>
          </button>
        </div>
      );
    }

    // No in-place trading on this surface (desktop carousel): the outcomes stay
    // full-colour and clearly clickable, and open the trade page.
    return (
      <div className={stacked ? "flex flex-col gap-2" : "flex gap-2"}>
        <Link
          href={`/trade/${marketAddress}`}
          onClick={onNavigate}
          className={`${base} bg-[#00FF87]`}
        >
          <span className={label}>{outcomeLabel(0)}</span>
          <span className={pct}>{outcomePct(0)}</span>
        </Link>
        <Link
          href={`/trade/${marketAddress}`}
          onClick={onNavigate}
          className={`${base} bg-[#ff5c73]`}
        >
          <span className={label}>{outcomeLabel(1)}</span>
          <span className={pct}>{outcomePct(1)}</span>
        </Link>
      </div>
    );
  };

  const drawers = (
    <>
      <LiveChartDrawer
        open={chartOpen}
        onClose={() => setChartOpen(false)}
        marketAddress={marketAddress || null}
        names={outcomeNames}
        percentages={percents}
        question={question}
        playPlaceholder={isPlayMode}
      />
      <LiveActivityDrawer
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        marketAddress={marketAddress || null}
        names={outcomeNames}
        question={question}
        isPlay={isPlayMode}
      />
    </>
  );

  const background = (
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
  );

  // ── DESKTOP CAROUSEL: info + outcomes left, large chart right ──
  if (isCarousel) {
    return (
      <div
        ref={rootRef}
        className={`relative h-full overflow-hidden rounded-2xl border ${
          isEnded ? "border-white/10" : "border-sky-500/35"
        } bg-[#07090e] ${className}`}
      >
        {background}

        <div className="relative z-10 flex h-full gap-5 p-5">
          {/* LEFT — identity, prices, timer, outcomes */}
          <div className="flex w-[32%] min-w-[240px] flex-col">
            <Link href={`/trade/${marketAddress}`} onClick={onNavigate} className="flex min-w-0 items-center gap-3">
              {tokenImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tokenImage}
                  alt=""
                  className="h-10 w-10 rounded-full border border-white/20 bg-black/40 object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-xs font-black text-white">
                  {symbol.slice(0, 4)}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-xl font-black tracking-wide text-white">{pairLabel}</div>
                <div className="mt-1">{badges}</div>
              </div>
            </Link>

            <Link
              href={`/trade/${marketAddress}`}
              onClick={onNavigate}
              className="mt-4 block text-lg font-bold leading-snug text-white"
            >
              {question}
            </Link>

            <div className="mt-4 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">Price to beat</span>
                <span className="text-base font-semibold tabular-nums text-white/85">
                  {formatFlashCryptoUsdPrice(priceToBeat)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">Current price</span>
                <span
                  className={`text-2xl font-black tabular-nums ${
                    isUp ? "text-pump-green" : isDown ? "text-red-300" : "text-white"
                  }`}
                >
                  {currentPrice == null ? "—" : formatFlashCryptoUsdPrice(currentPrice)}
                </span>
              </div>
              {changeVsTarget ? (
                <div className={`text-right text-xs font-bold tabular-nums ${changeTone}`}>
                  {changeVsTarget} vs target
                </div>
              ) : null}
            </div>

            <div className="mt-4">{timer}</div>

            <div className="mt-auto pt-4">{outcomeButtons(true)}</div>
          </div>

          {/* RIGHT — the chart is the focus */}
          <div className="min-w-0 flex-1">
            <div className="h-full w-full">{chart}</div>
          </div>
        </div>

        {drawers}
      </div>
    );
  }

  // ── MOBILE FEED ──
  return (
    <div
      ref={rootRef}
      className={`relative h-full overflow-hidden border ${
        isEnded ? "border-white/10" : "border-sky-500/35"
      } rounded-2xl bg-[#07090e] ${className}`}
    >
      {background}

      {/* pt-20 clears the feed's fixed overlay header (mode switch). */}
      <div className="relative z-10 flex h-full flex-col p-4 pb-28 pt-20">
        {/* ── Header: token + badges + minimal timer ── */}
        <div className="flex items-start justify-between gap-3">
          <Link href={`/trade/${marketAddress}`} onClick={onNavigate} className="flex min-w-0 items-center gap-3">
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
              <div className="truncate text-xl font-black tracking-wide text-white">{pairLabel}</div>
              <div className="mt-0.5">{badges}</div>
            </div>
          </Link>

          {timer}
        </div>

        {/* ── Prices ── */}
        <div className="mt-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/45">Current price</div>
            <div
              className={`text-3xl font-black tabular-nums leading-tight ${
                isUp ? "text-pump-green" : isDown ? "text-red-300" : "text-white"
              }`}
            >
              {currentPrice == null ? "—" : formatFlashCryptoUsdPrice(currentPrice)}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-[0.14em] text-white/45">Price to beat</div>
            <div className="text-lg font-semibold tabular-nums text-white/80">
              {formatFlashCryptoUsdPrice(priceToBeat)}
            </div>
            {changeVsTarget ? (
              <div className={`text-xs font-bold tabular-nums ${changeTone}`}>{changeVsTarget} vs target</div>
            ) : null}
          </div>
        </div>

        {/* ── Chart: live series + dashed price-to-beat reference ── */}
        <div className="mt-2 min-h-[150px] flex-1">{chart}</div>

        {/* ── Actions + question + YES/NO ──
            Everything above the buttons keeps clear of the feed's right action
            rail (pr-20, like HomeFeedItem's overlay). The rail stops above the
            outcome row, so the buttons take the full width and read exactly
            like the standard feed outcome buttons. */}
        <div className="mt-2 space-y-2.5">
          <div className="pr-20">{quickActions}</div>

          <Link
            href={`/trade/${marketAddress}`}
            onClick={onNavigate}
            className="block pr-20 text-lg font-bold leading-snug text-white drop-shadow-lg"
          >
            {question}
          </Link>

          {outcomeButtons(false)}
        </div>
      </div>

      {drawers}
    </div>
  );
}
