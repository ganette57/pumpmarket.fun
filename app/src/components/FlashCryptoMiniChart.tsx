"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PricePoint = {
  time: number; // ms epoch
  price: number;
};

type FlashCryptoMiniChartProps = {
  tokenMint: string;
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

type ChartCoord = { x: number; y: number };

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

function smoothPathFromCoords(coords: ChartCoord[]): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  if (coords.length === 2) {
    return `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)} L${coords[1].x.toFixed(1)},${coords[1].y.toFixed(1)}`;
  }

  let path = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = i > 0 ? coords[i - 1] : coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = i + 2 < coords.length ? coords[i + 2] : p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return path;
}

export default function FlashCryptoMiniChart({
  tokenMint,
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
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const windowEndMs = Date.parse(String(windowEnd || ""));
  const hasCountdown = !isEnded && Number.isFinite(windowEndMs);
  const remainingSec =
    hasCountdown
      ? Math.max(0, Math.ceil((windowEndMs - countdownNowMs) / 1000))
      : 0;
  const pollTier = !hasCountdown ? "default" : remainingSec <= 10 ? "end-10" : remainingSec <= 30 ? "end-30" : "base";
  const adaptivePollMs =
    pollTier === "end-10"
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
      const res = await fetch(`/api/flash-crypto/price?mint=${encodeURIComponent(tokenMint)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!mountedRef.current) return;
      const price = Number(data.price);
      if (!Number.isFinite(price) || price <= 0) return;

      setCurrentPrice(price);
      setError(null);
      setPoints((prev) => {
        const next = [...prev, { time: Date.now(), price }];
        if (next.length > 200) return next.slice(-200);
        return next;
      });
    } catch {
      if (mountedRef.current) setError("Price fetch failed");
    }
  }, [tokenMint]);

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

  const svgWidth = 360;
  const svgHeight = 170;
  const padding = { top: 10, right: 10, bottom: 8, left: 10 };
  const chartW = svgWidth - padding.left - padding.right;
  const chartH = svgHeight - padding.top - padding.bottom;

  const allPrices = points.map((p) => p.price);
  if (currentPrice != null && Number.isFinite(currentPrice)) allPrices.push(currentPrice);
  if (priceStart > 0) allPrices.push(priceStart);
  const rawMin = allPrices.length ? Math.min(...allPrices) : 0;
  const rawMax = allPrices.length ? Math.max(...allPrices) : 1;
  const sameValue = Math.abs(rawMax - rawMin) < Number.EPSILON;
  const dynamicPad = sameValue ? Math.max(Math.abs(rawMax || 1) * 0.004, 1e-10) : 0;
  const minPrice = rawMin - dynamicPad;
  const maxPrice = rawMax + dynamicPad;
  const priceRange = maxPrice - minPrice || 1;

  const minTime = points.length ? points[0].time : Date.now();
  const maxTime = points.length ? points[points.length - 1].time : Date.now() + 1;
  const timeRange = maxTime - minTime || 1;

  const coords: ChartCoord[] = points.map((p) => {
    const x = padding.left + ((p.time - minTime) / timeRange) * chartW;
    const y = padding.top + chartH - ((p.price - minPrice) / priceRange) * chartH;
    return { x, y };
  });
  const pathD = smoothPathFromCoords(coords);
  const baselineY = padding.top + chartH;
  const areaD =
    coords.length > 1
      ? `${pathD} L${coords[coords.length - 1].x.toFixed(1)},${baselineY.toFixed(1)} L${coords[0].x.toFixed(1)},${baselineY.toFixed(1)} Z`
      : "";

  const startY = padding.top + chartH - ((priceStart - minPrice) / priceRange) * chartH;
  const lastCoord = coords.length ? coords[coords.length - 1] : null;

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
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          width="100%"
          height={170}
          className="block"
          preserveAspectRatio="none"
        >
          <line
            x1={padding.left}
            y1={startY}
            x2={svgWidth - padding.right}
            y2={startY}
            stroke="#ffffff2e"
            strokeWidth={1}
            strokeDasharray="5,5"
          />

          {areaD && (
            <path
              d={areaD}
              fill={lineColor}
              fillOpacity={0.08}
            />
          )}

          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke={lineColor}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {lastCoord ? (
            trend === "up" ? (
              <text
                x={lastCoord.x}
                y={lastCoord.y - 8}
                textAnchor="middle"
                fontSize="15"
                className="flash-marker-up"
              >
                🚀
              </text>
            ) : trend === "down" ? (
              <text
                x={lastCoord.x}
                y={lastCoord.y - 8}
                textAnchor="middle"
                fontSize="15"
                className="flash-marker-down"
              >
                🔥
              </text>
            ) : (
              <>
                <circle cx={lastCoord.x} cy={lastCoord.y} r={6} fill={`${lineColor}33`} />
                <circle cx={lastCoord.x} cy={lastCoord.y} r={3.4} fill={lineColor} />
              </>
            )
          ) : null}
        </svg>
      </div>

      <div className="mt-3 text-[11px]">
        <div className="text-gray-500">
          Rule: <span className="text-gray-300">YES wins if final price &gt; start price.</span>
        </div>
      </div>

      {error && <div className="mt-2 text-[10px] text-red-400">{error}</div>}

      <style jsx>{`
        :global(.flash-marker-up) {
          animation: flashRocketSpin 2.2s ease-in-out infinite;
          transform-origin: center;
          filter: drop-shadow(0 0 8px rgba(97, 255, 154, 0.45));
        }
        :global(.flash-marker-down) {
          animation: flashFireFlicker 1.25s ease-in-out infinite;
          transform-origin: center;
          filter: drop-shadow(0 0 8px rgba(248, 113, 113, 0.4));
        }
        @keyframes flashRocketSpin {
          0%, 100% {
            transform: rotate(-4deg) translateY(0px);
          }
          50% {
            transform: rotate(6deg) translateY(-1px);
          }
        }
        @keyframes flashFireFlicker {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.06);
            opacity: 0.9;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          :global(.flash-marker-up),
          :global(.flash-marker-down) {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
