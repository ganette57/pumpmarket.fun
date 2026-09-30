"use client";

import { useState } from "react";
import { Curve } from "recharts";
import { currentValues, probabilityDomain, separateLabels, validProbability, type ProbabilityPoint } from "./chartGeometry";

type Props = {
  names: string[];
  current: number[];
  colors: string[];
  points: ProbabilityPoint[];
};

export default function MobileProbabilityChart({ names, current, colors, points }: Props) {
  const [scrub, setScrub] = useState<number | null>(null);
  const visible = points.filter(p => Number.isFinite(p.t));
  const values = currentValues(current, visible, names.length);
  const [low, high] = probabilityDomain([...visible.flatMap(p => p.pct), ...values]);
  const height = Math.max(238, names.length * 44 + 28);
  const top = 20, bottom = height - 20, endX = 226;
  const y = (pct: number) => bottom - (pct - low) / (high - low) * (bottom - top);
  const firstT = visible[0]?.t ?? 0, lastT = visible[visible.length - 1]?.t ?? firstT;
  const x = (t: number) => lastT === firstT ? endX : 4 + (t - firstT) / (lastT - firstT) * (endX - 4);
  const labelYs = separateLabels(values.map(y), top + 4, bottom - 4);
  const sample = scrub == null ? null : visible[scrub];
  const onScrub = (clientX: number, rect: DOMRect) => {
    if (!visible.length) return;
    const target = Math.max(0, Math.min(1, ((clientX - rect.left) / rect.width * 350 - 4) / (endX - 4)));
    const time = firstT + target * (lastT - firstT);
    let nearest = 0;
    visible.forEach((p, i) => { if (Math.abs(p.t - time) < Math.abs(visible[nearest].t - time)) nearest = i; });
    setScrub(nearest);
  };

  return (
    <section aria-label="Probability history" className="min-w-0">
      <svg viewBox={`0 0 350 ${height}`} className="block w-full overflow-visible" role="img"
        aria-label={names.map((name, i) => `${name} ${values[i].toFixed(1)}%`).join(", ")}
        style={{ touchAction: "pan-y" }}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); onScrub(e.clientX, e.currentTarget.getBoundingClientRect()); }}
        onPointerMove={e => { if (e.buttons) onScrub(e.clientX, e.currentTarget.getBoundingClientRect()); }}
        onPointerUp={() => setScrub(null)} onPointerCancel={() => setScrub(null)} onLostPointerCapture={() => setScrub(null)}>
        {names.map((name, index) => {
          const color = colors[index];
          // Connect real observations directly; soften only the stroke joins, not the data.
          const curvePoints = visible.map(p => ({ x: x(p.t), y: validProbability(p.pct[index]) ? y(p.pct[index]) : null }));
          const endY = y(values[index]);
          return <g key={index}>
            {visible.length > 1 && <Curve type="linear" points={curvePoints} connectNulls={false} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
            {visible.length === 1 && validProbability(visible[0].pct[index]) && <circle cx={endX} cy={y(visible[0].pct[index])} r="3" fill={color} />}
            {visible.length < 2 && <line x1="4" x2={endX} y1={endY} y2={endY} stroke={color} strokeWidth="1.5" strokeDasharray="3 5" opacity=".45" />}
            {/* Current quote is marked separately; never append a fabricated history timestamp. */}
            <path d={`M${endX},${endY} L242,${labelYs[index]} L248,${labelYs[index]}`} stroke={color} opacity=".5" fill="none" />
            <circle cx={endX} cy={endY} r="4" fill={color} stroke="black" strokeWidth="1.5" />
            <text x="253" y={labelYs[index] - 7} fill={color} fontSize="10"><title>{name}</title>{name.length > 15 ? `${name.slice(0, 14)}…` : name}</text>
            <text x="253" y={labelYs[index] + 15} fill={color} fontSize="23" fontWeight="700">{(sample && validProbability(sample.pct[index]) ? sample.pct[index] : values[index]).toFixed(1).replace(/\.0$/, "")}%</text>
          </g>;
        })}
        {sample && <line x1={x(sample.t)} x2={x(sample.t)} y1={top} y2={bottom} stroke="#fff" opacity=".3" strokeDasharray="2 4" />}
      </svg>
    </section>
  );
}
