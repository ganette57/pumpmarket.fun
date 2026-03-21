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

export default function FlashCryptoMiniChart({
  tokenMint,
  priceStart,
  windowEnd,
  isEnded,
  pollIntervalMs = 4000,
  className = "",
}: FlashCryptoMiniChartProps) {
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        // Keep last 200 points
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

    // Initial fetch
    fetchPrice();

    intervalRef.current = setInterval(fetchPrice, pollIntervalMs);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [fetchPrice, isEnded, pollIntervalMs]);

  // SVG chart
  const svgWidth = 280;
  const svgHeight = 80;
  const padding = { top: 4, right: 4, bottom: 4, left: 4 };
  const chartW = svgWidth - padding.left - padding.right;
  const chartH = svgHeight - padding.top - padding.bottom;

  const allPrices = points.map((p) => p.price);
  if (priceStart > 0) allPrices.push(priceStart);
  const minPrice = allPrices.length ? Math.min(...allPrices) : 0;
  const maxPrice = allPrices.length ? Math.max(...allPrices) : 1;
  const priceRange = maxPrice - minPrice || 1;

  const minTime = points.length ? points[0].time : Date.now();
  const maxTime = points.length ? points[points.length - 1].time : Date.now() + 1;
  const timeRange = maxTime - minTime || 1;

  const pathPoints = points.map((p, i) => {
    const x = padding.left + ((p.time - minTime) / timeRange) * chartW;
    const y = padding.top + chartH - ((p.price - minPrice) / priceRange) * chartH;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathD = pathPoints.join(" ");

  // Start price horizontal line
  const startY = padding.top + chartH - ((priceStart - minPrice) / priceRange) * chartH;

  const isUp = currentPrice != null && currentPrice > priceStart;
  const lineColor = currentPrice == null ? "#6b7280" : isUp ? "#61ff9a" : "#f87171";

  return (
    <div className={`${className}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-gray-400">
          Start: <span className="text-white font-mono">{formatPrice(priceStart)}</span>
        </div>
        <div className="text-xs text-gray-400">
          {currentPrice != null ? (
            <>
              Now:{" "}
              <span className={`font-mono font-semibold ${isUp ? "text-pump-green" : "text-red-400"}`}>
                {formatPrice(currentPrice)}
              </span>
              <span className={`ml-1 ${isUp ? "text-pump-green" : "text-red-400"}`}>
                ({pctStr(priceStart, currentPrice)})
              </span>
            </>
          ) : (
            <span className="text-gray-500">Loading...</span>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-pump-dark-lighter border border-white/10 p-2">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          width="100%"
          height={svgHeight}
          className="block"
          preserveAspectRatio="none"
        >
          {/* Start price dashed line */}
          <line
            x1={padding.left}
            y1={startY}
            x2={svgWidth - padding.right}
            y2={startY}
            stroke="#ffffff20"
            strokeWidth={0.5}
            strokeDasharray="3,3"
          />

          {/* Price line */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke={lineColor}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Current price dot */}
          {points.length > 0 && (
            <circle
              cx={padding.left + ((points[points.length - 1].time - minTime) / timeRange) * chartW}
              cy={padding.top + chartH - ((points[points.length - 1].price - minPrice) / priceRange) * chartH}
              r={3}
              fill={lineColor}
            />
          )}
        </svg>
      </div>

      {error && <div className="text-[10px] text-red-400 mt-1">{error}</div>}
    </div>
  );
}
