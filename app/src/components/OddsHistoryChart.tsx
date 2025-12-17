// app/src/components/OddsHistoryChart.tsx
"use client";

import { useMemo, useRef, useState } from "react";

export type OddsPoint = { t: number; pct: number[] };

export default function OddsHistoryChart({
  points,
  outcomeNames,
  height = 260,
}: {
  points: OddsPoint[];
  outcomeNames: string[];
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const safeNames = useMemo(() => (outcomeNames || []).slice(0, 10), [outcomeNames]);

  const cleaned = useMemo(() => {
    const pts = (points || []).filter((p) => Number.isFinite(p.t) && Array.isArray(p.pct));
    if (!pts.length) return [];

    // ensure pct length matches outcomes
    return pts.map((p) => ({
      t: Number(p.t),
      pct: safeNames.map((_, i) => {
        const v = Number(p.pct?.[i] ?? 0);
        if (!Number.isFinite(v)) return 0;
        return Math.max(0, Math.min(100, v));
      }),
    }));
  }, [points, safeNames]);

  const { viewBoxW, viewBoxH, pad, xMin, xMax, paths, xTicks } = useMemo(() => {
    const viewBoxW = 1000;
    const viewBoxH = 300;
    const pad = { l: 56, r: 16, t: 16, b: 38 };

    const xMin = cleaned.length ? cleaned[0].t : 0;
    const xMax = cleaned.length ? cleaned[cleaned.length - 1].t : xMin + 1;

    const innerW = Math.max(1, viewBoxW - pad.l - pad.r);
    const innerH = Math.max(1, viewBoxH - pad.t - pad.b);

    const xScale = (t: number) => {
      if (xMax === xMin) return pad.l;
      const r = (t - xMin) / (xMax - xMin);
      return pad.l + r * innerW;
    };

    const yScale = (pct: number) => {
      const r = pct / 100;
      return pad.t + (1 - r) * innerH;
    };

    const paths = safeNames.map((_, seriesIdx) => {
      if (!cleaned.length) return "";
      let d = "";
      for (let i = 0; i < cleaned.length; i++) {
        const x = xScale(cleaned[i].t);
        const y = yScale(cleaned[i].pct[seriesIdx] ?? 0);
        d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      return d;
    });

    // simple x ticks (4)
    const tickCount = 4;
    const xTicks = Array.from({ length: tickCount }, (_, k) => {
      const r = tickCount === 1 ? 0 : k / (tickCount - 1);
      const t = xMin + r * (xMax - xMin);
      return { t, x: xScale(t) };
    });

    return { viewBoxW, viewBoxH, pad, xMin, xMax, paths, xTicks };
  }, [cleaned, safeNames]);

  const palette = useMemo(() => {
    // binary: blue / red like your UI
    if (safeNames.length === 2) return ["#3B82F6", "#EF4444"];
    // multi: rotate a small palette
    return ["#22C55E", "#3B82F6", "#A855F7", "#F59E0B", "#EF4444", "#14B8A6", "#E11D48", "#6366F1", "#84CC16", "#06B6D4"];
  }, [safeNames.length]);

  const hover = useMemo(() => {
    if (hoverIdx == null) return null;
    const i = Math.max(0, Math.min(cleaned.length - 1, hoverIdx));
    const p = cleaned[i];
    if (!p) return null;
    return { i, p };
  }, [hoverIdx, cleaned]);

  function findNearestIndexByClientX(clientX: number) {
    const el = wrapRef.current;
    if (!el || cleaned.length < 2) return 0;

    const rect = el.getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));

    const t = xMin + rel * (xMax - xMin);

    // binary search nearest
    let lo = 0;
    let hi = cleaned.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (cleaned[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    const idx = lo;
    const prev = Math.max(0, idx - 1);
    if (Math.abs(cleaned[prev].t - t) <= Math.abs(cleaned[idx].t - t)) return prev;
    return idx;
  }

  if (!cleaned.length) {
    return (
      <div className="bg-pump-dark/40 border border-gray-800 rounded-xl p-4 text-sm text-gray-400">
        No chart data yet.
      </div>
    );
  }

  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div
      ref={wrapRef}
      className="relative w-full rounded-xl border border-gray-800 bg-pump-dark/30 overflow-hidden"
      style={{ height }}
      onMouseLeave={() => setHoverIdx(null)}
      onMouseMove={(e) => setHoverIdx(findNearestIndexByClientX(e.clientX))}
    >
      {/* Legend */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-2 z-10">
        {safeNames.map((n, i) => (
          <div
            key={`${n}-${i}`}
            className="px-2 py-1 rounded-lg text-xs bg-black/40 border border-white/10 text-gray-200 flex items-center gap-2"
          >
            <span className="inline-block w-3 h-[2px]" style={{ background: palette[i % palette.length] }} />
            <span className="truncate max-w-[180px]">{n}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {hover && (
        <div className="absolute top-12 right-3 z-20 rounded-xl bg-black/70 border border-white/10 px-3 py-2 text-xs text-gray-200 backdrop-blur">
          <div className="text-gray-400 mb-1">
            {new Date(hover.p.t).toLocaleString()}
          </div>
          <div className="space-y-1">
            {safeNames.map((n, i) => (
              <div key={i} className="flex items-center justify-between gap-6">
                <span className="truncate max-w-[180px]" style={{ color: palette[i % palette.length] }}>
                  {n}
                </span>
                <span className="text-white tabular-nums">
                  {(hover.p.pct[i] ?? 0).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <svg className="w-full h-full" viewBox={`0 0 ${viewBoxW} ${viewBoxH}`} preserveAspectRatio="none">
        {/* grid + axes */}
        {yTicks.map((v) => {
          const y = (1 - v / 100) * (viewBoxH - pad.t - pad.b) + pad.t;
          return (
            <g key={v}>
              <line x1={pad.l} x2={viewBoxW - pad.r} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <text x={pad.l - 10} y={y + 4} textAnchor="end" fontSize="12" fill="rgba(255,255,255,0.45)">
                {v}%
              </text>
            </g>
          );
        })}

        {/* x ticks */}
        {xTicks.map((tk, i) => (
          <g key={i}>
            <line x1={tk.x} x2={tk.x} y1={pad.t} y2={viewBoxH - pad.b} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text
              x={tk.x}
              y={viewBoxH - 12}
              textAnchor="middle"
              fontSize="12"
              fill="rgba(255,255,255,0.45)"
            >
              {new Date(tk.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </text>
          </g>
        ))}

        {/* lines */}
        {paths.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={palette[i % palette.length]}
            strokeWidth="2.2"
            opacity="0.95"
          />
        ))}

        {/* hover vertical line */}
        {hover && cleaned.length > 1 && (
          (() => {
            const t = hover.p.t;
            const x =
              pad.l + ((t - xMin) / Math.max(1, xMax - xMin)) * (viewBoxW - pad.l - pad.r);
            return (
              <line
                x1={x}
                x2={x}
                y1={pad.t}
                y2={viewBoxH - pad.b}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="1"
              />
            );
          })()
        )}
      </svg>
    </div>
  );
}