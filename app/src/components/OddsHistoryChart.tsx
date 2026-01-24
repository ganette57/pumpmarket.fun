"use client";

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

export default function OddsHistoryChart({ points, outcomeNames, height = 200 }: Props) {
  if (!points.length) {
    return (
      <div className="h-[170px] flex items-center justify-center text-xs text-gray-500">
        No trading history yet
      </div>
    );
  }

  // Transforme les points en data Recharts
  const data = points.map((p) => {
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