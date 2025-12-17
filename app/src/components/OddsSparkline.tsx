"use client";

import { useMemo } from "react";

export type OddsPoint = { t: number; pct: number[] };

export default function OddsSparkline({
  points,
  seriesIndex = 0,
  height = 48,
}: {
  points: OddsPoint[];
  seriesIndex?: number; // 0 => outcome 0 (ex: YES / top outcome)
  height?: number;
}) {
  const d = useMemo(() => {
    const pts = (points || []).filter((p) => Number.isFinite(p?.t) && Array.isArray(p?.pct));
    if (pts.length < 2) return "";

    const W = 1200;
    const H = 120;
    const pad = 6;

    const xMin = pts[0].t;
    const xMax = pts[pts.length - 1].t || xMin + 1;

    const xScale = (t: number) => {
      if (xMax === xMin) return pad;
      return pad + ((t - xMin) / (xMax - xMin)) * (W - pad * 2);
    };
    const yScale = (pct: number) => {
      const v = Math.max(0, Math.min(100, pct));
      return pad + (1 - v / 100) * (H - pad * 2);
    };

    let path = "";
    for (let i = 0; i < pts.length; i++) {
      const x = xScale(pts[i].t);
      const y = yScale(Number(pts[i].pct?.[seriesIndex] ?? 0) || 0);
      path += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    return path;
  }, [points, seriesIndex]);

  if (!d) {
    return <div className="w-full rounded-lg bg-black/20 border border-white/10" style={{ height }} />;
  }

  return (
    <div className="w-full rounded-lg bg-black/20 border border-white/10 overflow-hidden" style={{ height }}>
      <svg className="w-full h-full" viewBox="0 0 1200 120" preserveAspectRatio="none">
        <path d={d} fill="none" stroke="rgba(34,197,94,0.95)" strokeWidth="6" />
      </svg>
    </div>
  );
}