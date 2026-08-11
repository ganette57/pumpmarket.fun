"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  LineType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  formatFlashCryptoCountdown,
  isFlashCryptoDailyDuration,
} from "@/lib/flashCrypto/daily";

type PricePoint = {
  time: number; // ms epoch
  price: number;
};

type FlashCryptoMiniChartProps = {
  tokenMint: string;
  sourceType?: "pump_fun" | "major" | null;
  majorSymbol?: string | null;
  majorPair?: string | null;
  priceStart: number;
  windowEnd: string | null;
  isEnded: boolean;
  finalPrice?: number | null;
  percentChange?: number | null;
  tokenSymbol?: string;
  tokenName?: string;
  tokenImageUri?: string | null;
  durationMinutes?: number | null;
  pollIntervalMs?: number;
  className?: string;
  /**
   * "compact" strips the header/rule chrome and shrinks the plot so the same
   * chart can sit inside a feed card. The price-to-beat reference line and the
   * live series are identical in both variants.
   */
  variant?: "full" | "compact";
  /** Chart height in px. Defaults to the responsive 280/340 of the full card. */
  height?: number;
  /** Called on every accepted price sample, so a host card can show the price. */
  onPriceSample?: (price: number) => void;
};

function formatPrice(price: number): string {
  if (price === 0) return "0";
  if (price < 0.000001) return price.toExponential(3);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  return price.toFixed(2);
}

function pctStr(start: number, current: number): string {
  if (start === 0) return "N/A";
  const pct = ((current - start) / start) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/** Shared with the feed cards: HH:MM:SS past an hour (24h markets), MM:SS below. */
const formatCountdownMmSs = formatFlashCryptoCountdown;

type SeriesPoint = { time: UTCTimestamp; value: number };

function buildSeriesData(points: PricePoint[]): SeriesPoint[] {
  const data: SeriesPoint[] = [];
  let lastTs = 0;

  for (const point of points) {
    const price = Number(point.price);
    if (!Number.isFinite(price) || price <= 0) continue;

    let ts = Math.floor(Number(point.time) / 1000);
    if (!Number.isFinite(ts) || ts <= 0) {
      ts = Math.floor(Date.now() / 1000);
    }
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;

    data.push({ time: ts as UTCTimestamp, value: price });
  }

  if (data.length === 1) {
    const first = data[0];
    data.push({ time: (Number(first.time) + 1) as UTCTimestamp, value: first.value });
  }

  return data;
}

export default function FlashCryptoMiniChart({
  tokenMint,
  sourceType = null,
  majorSymbol = null,
  majorPair = null,
  priceStart,
  windowEnd,
  isEnded,
  finalPrice = null,
  percentChange = null,
  tokenSymbol,
  tokenName,
  tokenImageUri,
  durationMinutes,
  pollIntervalMs = 2000,
  className = "",
  variant = "full",
  height,
  onPriceSample,
}: FlashCryptoMiniChartProps) {
  const isCompact = variant === "compact";
  const isDailyWindow = isFlashCryptoDailyDuration(durationMinutes);
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());
  const [chartReady, setChartReady] = useState(false);

  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const startPriceLineRef = useRef<IPriceLine | null>(null);
  // Kept in a ref so a host card can pass an inline callback without
  // re-creating the polling effect on every render.
  const onPriceSampleRef = useRef(onPriceSample);
  useEffect(() => {
    onPriceSampleRef.current = onPriceSample;
  }, [onPriceSample]);

  const windowEndMs = Date.parse(String(windowEnd || ""));
  const hasCountdown = !isEnded && Number.isFinite(windowEndMs);
  const remainingSec = hasCountdown ? Math.max(0, Math.ceil((windowEndMs - countdownNowMs) / 1000)) : 0;
  const pollTier = !hasCountdown ? "default" : remainingSec <= 10 ? "end-10" : remainingSec <= 30 ? "end-30" : "base";
  const isMemeSource = sourceType !== "major";
  // A 24h market spends nearly all its life far from the deadline, so the
  // caller's pollIntervalMs governs there (the feed passes a slow cadence).
  // The last-minute tiers are untouched, so short legacy windows behave as before.
  const isFarFromDeadline = hasCountdown && remainingSec > 300;
  const adaptivePollMs = isFarFromDeadline
    ? Math.max(1000, pollIntervalMs)
    : isMemeSource
    ? pollTier === "end-10"
      ? 700
      : pollTier === "end-30"
      ? 800
      : 1000
    : pollTier === "end-10"
    ? 1000
    : pollTier === "end-30"
    ? 1500
    : pollTier === "base"
    ? 2000
    : pollIntervalMs;

  const resolvedFinalPrice =
    Number.isFinite(Number(finalPrice)) && Number(finalPrice) > 0
      ? Number(finalPrice)
      : Number.isFinite(Number(percentChange)) && priceStart > 0
      ? priceStart * (1 + Number(percentChange) / 100)
      : null;

  const fetchPrice = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const params = new URLSearchParams();
      params.set("mint", tokenMint);
      if (sourceType) params.set("source_type", sourceType);
      if (majorSymbol) params.set("major_symbol", majorSymbol);
      if (majorPair) params.set("pair", majorPair);
      const res = await fetch(`/api/flash-crypto/price?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!mountedRef.current) return;
      const price = Number(data.price);
      if (!Number.isFinite(price) || price <= 0) return;

      if (isMemeSource) {
        console.log("[flash-meme] trade polling update = ...", {
          tokenMint,
          sourceType: String(data.source_type || sourceType || "pump_fun"),
          provider: String(data.provider || ""),
          source: String(data.source || ""),
          price,
        });
      }

      setCurrentPrice(price);
      setError(null);
      onPriceSampleRef.current?.(price);
      setPoints((prev) => {
        const prevLast = prev.length ? prev[prev.length - 1].price : null;
        // Keep majors unchanged: avoid duplicate points when price is identical.
        // For meme markets, append every real sample to keep time progression visually alive.
        if (!isMemeSource && prevLast != null && Math.abs(prevLast - price) < 1e-12) {
          return prev;
        }
        const next = [...prev, { time: Date.now(), price }];
        if (isMemeSource) {
          console.log("[flash-meme] chart append = ...", {
            tokenMint,
            prev: prevLast,
            next: price,
            points: next.length,
          });
        }
        if (next.length > 200) return next.slice(-200);
        return next;
      });
    } catch {
      if (mountedRef.current) setError("Price fetch failed");
    }
  }, [isMemeSource, majorPair, majorSymbol, sourceType, tokenMint]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isEnded) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    fetchPrice();

    if (isMemeSource) {
      console.log("[flash-meme] live poll interval = ...", {
        tokenMint,
        pollTier,
        remainingSec,
        intervalMs: adaptivePollMs,
      });
    }

    intervalRef.current = setInterval(fetchPrice, adaptivePollMs);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [adaptivePollMs, fetchPrice, isEnded, isMemeSource, pollTier, tokenMint]);

  useEffect(() => {
    // Short flash windows seed the series with the start price so the very
    // first frame has a line. A 24h market would render that seed as a fake
    // cliff (start price stamped at "now"), so it starts from live samples and
    // relies on the dashed price-to-beat reference instead.
    if (priceStart > 0 && !isDailyWindow) {
      setPoints([{ time: Date.now(), price: priceStart }]);
    } else {
      setPoints([]);
    }
    setCurrentPrice(null);
    setError(null);
  }, [tokenMint, priceStart, isDailyWindow]);

  useEffect(() => {
    if (!isEnded) return;
    if (!(priceStart > 0) || resolvedFinalPrice == null) return;

    setPoints((prev) => {
      if (prev.length > 1) return prev;
      const startPoint = prev.length === 1 ? prev[0] : { time: Date.now(), price: priceStart };
      const endPoint = { time: startPoint.time + 1, price: resolvedFinalPrice };
      return [startPoint, endPoint];
    });
    setCurrentPrice((prev) => (prev != null ? prev : resolvedFinalPrice));
    setError(null);
  }, [isEnded, priceStart, resolvedFinalPrice]);

  useEffect(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (isEnded) return;

    setCountdownNowMs(Date.now());
    countdownIntervalRef.current = setInterval(() => setCountdownNowMs(Date.now()), 1000);
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [isEnded]);

  const nowPriceForDisplay =
    currentPrice != null
      ? currentPrice
      : points.length
      ? points[points.length - 1].price
      : isEnded && resolvedFinalPrice != null
      ? resolvedFinalPrice
      : null;

  const trend =
    nowPriceForDisplay == null || !Number.isFinite(nowPriceForDisplay)
      ? "flat"
      : nowPriceForDisplay > priceStart
      ? "up"
      : nowPriceForDisplay < priceStart
      ? "down"
      : "flat";

  const trendLabel = trend === "up" ? "Above start" : trend === "down" ? "Below start" : "Flat";
  const trendTone =
    trend === "up"
      ? "text-pump-green border-pump-green/35 bg-pump-green/10"
      : trend === "down"
      ? "text-red-300 border-red-500/35 bg-red-500/10"
      : "text-gray-300 border-white/15 bg-white/5";

  const lineColor = trend === "up" ? "#61ff9a" : trend === "down" ? "#f87171" : "#94a3b8";
  const areaTopColor = trend === "up" ? "rgba(97,255,154,0.24)" : trend === "down" ? "rgba(248,113,113,0.24)" : "rgba(148,163,184,0.2)";
  const areaBottomColor = trend === "up" ? "rgba(97,255,154,0.02)" : trend === "down" ? "rgba(248,113,113,0.02)" : "rgba(148,163,184,0.02)";
  const changeText = nowPriceForDisplay == null ? "—" : pctStr(priceStart, nowPriceForDisplay);

  const countdownCritical = hasCountdown && remainingSec <= 10;
  const countdownUrgent = hasCountdown && !countdownCritical && remainingSec <= 30;
  const countdownTone = countdownCritical
    ? "text-red-300 border-red-500/50 bg-red-500/15 animate-pulse"
    : countdownUrgent
    ? "text-amber-200 border-amber-400/45 bg-amber-400/12"
    : "text-pump-green border-pump-green/35 bg-pump-green/10";
  const countdownLabel = hasCountdown ? formatCountdownMmSs(remainingSec) : "00:00";
  const symbolText = String(tokenSymbol || "").trim() || tokenMint.slice(0, 6);
  const nameText = String(tokenName || "").trim() || "Flash token";

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const resolveHeight = (width: number) => {
      if (Number.isFinite(Number(height)) && Number(height) > 0) return Math.floor(Number(height));
      // Compact fills whatever box the host card gives it, so a responsive
      // container class (feed vs carousel) is enough to resize the plot.
      if (isCompact) return Math.max(64, Math.floor(container.clientHeight || 120));
      return width >= 640 ? 340 : 280;
    };
    const chartHeight = resolveHeight(container.clientWidth);
    const chart = createChart(container, {
      width: Math.max(1, container.clientWidth),
      height: chartHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8da2b7",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)", style: LineStyle.Solid },
        horzLines: { color: "rgba(255,255,255,0.06)", style: LineStyle.Solid },
      },
      leftPriceScale: { visible: false, borderVisible: false },
      rightPriceScale: { visible: false, borderVisible: false },
      timeScale: {
        visible: false,
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: false,
      handleScale: false,
      crosshair: { mode: CrosshairMode.Hidden },
    });

    const areaSeries = chart.addSeries(AreaSeries, {
      topColor: areaTopColor,
      bottomColor: areaBottomColor,
      lineColor,
      lineWidth: 2,
      lineType: LineType.Curved,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    areaSeriesRef.current = areaSeries;
    setChartReady(true);

    const resizeChart = () => {
      const width = Math.max(1, container.clientWidth);
      chart.applyOptions({ width, height: resolveHeight(width) });
    };

    resizeChart();

    let cleanupResize: (() => void) | null = null;
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => resizeChart());
      observer.observe(container);
      cleanupResize = () => observer.disconnect();
    } else {
      window.addEventListener("resize", resizeChart);
      cleanupResize = () => window.removeEventListener("resize", resizeChart);
    }

    return () => {
      if (cleanupResize) cleanupResize();
      if (startPriceLineRef.current && areaSeriesRef.current) {
        areaSeriesRef.current.removePriceLine(startPriceLineRef.current);
        startPriceLineRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      areaSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const areaSeries = areaSeriesRef.current;
    if (!areaSeries) return;

    areaSeries.applyOptions({
      lineColor,
      topColor: areaTopColor,
      bottomColor: areaBottomColor,
    });
  }, [lineColor, areaTopColor, areaBottomColor]);

  useEffect(() => {
    if (!chartReady) return;

    const areaSeries = areaSeriesRef.current;
    const chart = chartRef.current;
    if (!areaSeries || !chart) return;

    const seriesData = buildSeriesData(points);
    areaSeries.setData(seriesData);

    // Keep the price-to-beat inside the visible range, with a little headroom.
    // Without this the reference line can sit off-screen whenever the live
    // price drifts away from it — exactly when the trader needs to see it.
    areaSeries.applyOptions({
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const base = original();
        if (!(priceStart > 0)) return base;
        if (!base) {
          const pad = priceStart * 0.001;
          return { priceRange: { minValue: priceStart - pad, maxValue: priceStart + pad } };
        }
        const minValue = Math.min(base.priceRange.minValue, priceStart);
        const maxValue = Math.max(base.priceRange.maxValue, priceStart);
        const pad = Math.max((maxValue - minValue) * 0.12, priceStart * 0.0002);
        return { priceRange: { minValue: minValue - pad, maxValue: maxValue + pad } };
      },
    });

    if (startPriceLineRef.current) {
      areaSeries.removePriceLine(startPriceLineRef.current);
      startPriceLineRef.current = null;
    }

    if (priceStart > 0) {
      startPriceLineRef.current = areaSeries.createPriceLine({
        price: priceStart,
        color: "rgba(255,255,255,0.26)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lineVisible: true,
        axisLabelVisible: false,
        title: "",
      });
    }

    chart.timeScale().fitContent();
  }, [chartReady, points, priceStart]);

  // Compact: chart only. The host card owns the prices, the timer and the copy.
  if (isCompact) {
    return (
      <div
        ref={chartContainerRef}
        className={`w-full overflow-hidden ${className}`}
        style={Number(height) > 0 ? { height: `${Math.floor(Number(height))}px` } : undefined}
      />
    );
  }

  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-[linear-gradient(145deg,rgba(2,6,10,0.96),rgba(6,11,15,0.96))] ${className}`}
    >
      {/* ── Prices + timer row ── */}
      <div className="px-4 pt-3 sm:px-5 sm:pt-4">
        <div className="flex items-end justify-between gap-3">
          {/* Prices: start + current */}
          <div className="flex items-baseline gap-6 min-w-0">
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Price to beat</div>
              <div className="text-xl sm:text-2xl font-semibold text-gray-300 tabular-nums">
                {formatPrice(priceStart)}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                  {isEnded ? "Final" : "Now"}
                </span>
                <span className={`text-xs font-semibold tabular-nums ${trend === "up" ? "text-pump-green" : trend === "down" ? "text-red-300" : "text-gray-400"}`}>
                  {changeText}
                </span>
              </div>
              <div className={`text-3xl sm:text-4xl font-bold tabular-nums leading-tight ${trend === "up" ? "text-pump-green" : trend === "down" ? "text-red-300" : "text-white"}`}>
                {nowPriceForDisplay == null ? "..." : formatPrice(nowPriceForDisplay)}
              </div>
            </div>
          </div>

          {/* Timer pill — hidden on mobile (shown in card header instead) */}
          <div className={`shrink-0 rounded-xl border px-3 py-1.5 text-center hidden sm:block ${countdownTone}`}>
            <div className="text-xl sm:text-2xl font-black tabular-nums leading-none">{countdownLabel}</div>
            <div className="mt-0.5 text-[8px] uppercase tracking-[0.1em] text-white/45">
              {isEnded ? "Ended" : countdownCritical ? "Final" : countdownUrgent ? "Closing" : "Left"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Chart — full-width, dominant ── */}
      <div className="mt-1">
        <div ref={chartContainerRef} className="h-[280px] sm:h-[340px] w-full overflow-hidden" />
      </div>

      {/* ── Rule ── */}
      <div className="px-4 pb-2 sm:px-5 sm:pb-3 text-[10px] text-gray-600">
        Rule: <span className="text-gray-400">YES wins if the final price is above the price to beat.</span>
      </div>

      {error && <div className="px-4 pb-3 text-[10px] text-red-400">{error}</div>}
    </div>
  );
}
