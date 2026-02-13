"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export type OddsPoint = {
  t: number;      // timestamp ms
  pct: number[];  // pourcentages par outcome
};

interface Props {
  points: OddsPoint[];
  outcomeNames: string[];
  height?: number;
  livePct?: number[]; // current percentages [0..100] for each outcome
  liveEnabled?: boolean;
  liveMaxPoints?: number;
  liveMinIntervalMs?: number;
}

const PALETTE = [
  "#22c55e", // outcome 0 → vert pump
  "#f97373", // outcome 1 → rouge doux
  "#a855f7", // outcomes suivants → violet
  "#38bdf8",
  "#e5e7eb",
];

function formatTimeLabel(t: number) {
  const d = new Date(t);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizePct(arr: number[]): number[] {
  return arr.map((v) => {
    const n = Number(v);
    const safe = Number.isFinite(n) ? n : 0;
    const clamped = Math.max(0, Math.min(100, safe));
    return Number(clamped.toFixed(2));
  });
}

function approxEqualArr(a: number[], b: number[], eps = 0.15): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > eps) return false;
  }
  return true;
}

export default function OddsHistoryChart({
  points,
  outcomeNames,
  height = 200,
  livePct,
  liveEnabled = true,
  liveMaxPoints = 60,
  liveMinIntervalMs = 1500,
}: Props) {
  const [livePoints, setLivePoints] = useState<OddsPoint[]>([]);
  const lastPushRef = useRef<number>(0);
  const lastPctRef = useRef<number[] | null>(null);

  useEffect(() => {
    if (!liveEnabled) return;
    if (!livePct || livePct.length !== outcomeNames.length) return;

    const now = Date.now();
    if (now - lastPushRef.current < liveMinIntervalMs) return;

    const curr = normalizePct(livePct);
    if (lastPctRef.current && approxEqualArr(lastPctRef.current, curr)) return;

    setLivePoints((prev) => {
      const next = [...prev, { t: now, pct: curr }];
      return next.length > liveMaxPoints ? next.slice(next.length - liveMaxPoints) : next;
    });

    lastPushRef.current = now;
    lastPctRef.current = curr;
  }, [liveEnabled, livePct, outcomeNames.length, liveMinIntervalMs, liveMaxPoints]);

  const mergedPoints = useMemo(() => {
    const merged = [...points, ...livePoints];
    return merged.length > 600 ? merged.slice(merged.length - 600) : merged;
  }, [points, livePoints]);

  if (!mergedPoints.length) {
    return (
      <div className="h-[170px] flex items-center justify-center text-xs text-gray-500">
        No trading history yet
      </div>
    );
  }

  // Transforme les points en data Recharts
  const data = mergedPoints.map((p) => {
    const row: any = { time: formatTimeLabel(p.t) };
    outcomeNames.forEach((name, idx) => {
      row[name] = Number.isFinite(p.pct[idx]) ? Number(p.pct[idx].toFixed(2)) : null;
    });
    return row;
  });

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          {/* Grid très light, pas de frame */}
          <CartesianGrid
            stroke="#111827"
            vertical={false}
          />

          {/* Axes sans bordures ni ticks agressifs */}
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            minTickGap={30}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
          />

          {/* Tooltip sobre dark */}
          <Tooltip
  contentStyle={{
    backgroundColor: "#020617",
    borderRadius: 8,
    border: "1px solid #1f2937",
    fontSize: 11,
  }}
  labelStyle={{ color: "#9ca3af" }}
  formatter={(value: any, name: any) => [
    `${Number(value).toFixed(2)}%`,
    name,
  ]}
/>

          {/* Légende mini, en haut à droite */}
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            wrapperStyle={{
              paddingBottom: 8,
              fontSize: 11,
              color: "#9ca3af",
            }}
          />

          {/* Courbes : vert / rouge / autres couleurs, pas de dots */}
          {outcomeNames.map((name, idx) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={PALETTE[idx % PALETTE.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
