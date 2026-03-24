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
};

function formatPrice(price: number): string {
  if (price === 0) return "0";
  if (price < 0.000001) return price.toExponential(3);
  if (price < 0.01) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

function pctStr(start: number, current: number): string {
  if (start === 0) return "N/A";
  const pct = ((current - start) / start) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function formatCountdownMmSs(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

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
}: FlashCryptoMiniChartProps) {
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

  const windowEndMs = Date.parse(String(windowEnd || ""));
  const hasCountdown = !isEnded && Number.isFinite(windowEndMs);
  const remainingSec = hasCountdown ? Math.max(0, Math.ceil((windowEndMs - countdownNowMs) / 1000)) : 0;
  const pollTier = !hasCountdown ? "default" : remainingSec <= 10 ? "end-10" : remainingSec <= 30 ? "end-30" : "base";
  const adaptivePollMs =
    pollTier === "end-10" ? 1000 : pollTier === "end-30" ? 1500 : pollTier === "base" ? 2000 : pollIntervalMs;
  const isMemeSource = sourceType !== "major";

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
      setPoints((prev) => {
        const prevLast = prev.length ? prev[prev.length - 1].price : null;
        if (prevLast != null && Math.abs(prevLast - price) < 1e-12) {
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

    intervalRef.current = setInterval(fetchPrice, adaptivePollMs);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [adaptivePollMs, fetchPrice, isEnded]);

  useEffect(() => {
    if (priceStart > 0) {
      setPoints([{ time: Date.now(), price: priceStart }]);
    } else {
      setPoints([]);
    }
    setCurrentPrice(null);
    setError(null);
  }, [tokenMint, priceStart]);

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

    const chart = createChart(container, {
      width: Math.max(1, container.clientWidth),
      height: 170,
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
      chart.applyOptions({ width, height: 170 });
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

  return (
    <div
      className={`rounded-2xl border border-white/12 bg-[radial-gradient(circle_at_18%_0%,rgba(34,197,94,0.12),transparent_38%),linear-gradient(145deg,rgba(2,6,10,0.98),rgba(6,11,15,0.98))] p-4 sm:p-5 ${className}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {tokenImageUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tokenImageUri} alt="" className="h-10 w-10 rounded-full border border-white/20 object-cover shadow-lg" />
            ) : (
              <div className="h-10 w-10 rounded-full border border-white/15 bg-white/5" />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg sm:text-xl font-black text-white tracking-wide truncate">${symbolText}</span>
                <span className="rounded-full border border-sky-400/35 bg-sky-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-sky-200">
                  Crypto
                </span>
                {durationMinutes ? (
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-200">
                    {durationMinutes}m flash
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-gray-400 truncate">{nameText}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-xl border border-white/12 bg-black/25 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Start</div>
              <div className="mt-1 text-sm font-mono font-semibold text-white">{formatPrice(priceStart)}</div>
            </div>
            <div className="rounded-xl border border-white/12 bg-black/25 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500">{isEnded ? "Final" : "Current"}</div>
              <div className={`mt-1 text-sm font-mono font-semibold ${trend === "up" ? "text-pump-green" : trend === "down" ? "text-red-300" : "text-white"}`}>
                {nowPriceForDisplay == null ? "Loading..." : formatPrice(nowPriceForDisplay)}
              </div>
            </div>
            <div className="rounded-xl border border-white/12 bg-black/25 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500">Change</div>
              <div className={`mt-1 text-sm font-semibold ${trend === "up" ? "text-pump-green" : trend === "down" ? "text-red-300" : "text-gray-200"}`}>
                {changeText}
              </div>
            </div>
            <div className={`rounded-xl border px-3 py-2.5 ${trendTone}`}>
              <div className="text-[10px] uppercase tracking-[0.12em] text-white/65">{isEnded ? "Final signal" : "Signal"}</div>
              <div className="mt-1 text-sm font-bold">{trendLabel}</div>
            </div>
          </div>
        </div>

        <div className={`rounded-2xl border px-4 py-3 sm:min-w-[150px] text-center ${countdownTone}`}>
          <div className="text-[10px] uppercase tracking-[0.18em] text-white/70">Time Left</div>
          <div className="mt-1 text-3xl font-black tabular-nums leading-none">{countdownLabel}</div>
          <div className="mt-1 text-[11px] text-white/80">
            {isEnded ? "Window ended" : countdownCritical ? "Final seconds" : countdownUrgent ? "Closing fast" : "Window active"}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3">
        <div ref={chartContainerRef} className="h-[170px] w-full overflow-hidden" />
      </div>

      <div className="mt-3 text-[11px]">
        <div className="text-gray-500">
          Rule: <span className="text-gray-300">YES wins if final price &gt; start price.</span>
        </div>
      </div>

      {error && <div className="mt-2 text-[10px] text-red-400">{error}</div>}
    </div>
  );
}
