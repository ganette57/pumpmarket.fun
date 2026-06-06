// app/src/app/world-cup/_components/MarketsBlocks.tsx
"use client";

import { Zap, Layers } from "lucide-react";
import type { FlashMarketRow, SideMarketRow } from "./mockData";

export function FlashMarketRowCard({ m }: { m: FlashMarketRow }) {
  return (
    <article className="rounded-xl border border-gray-800 bg-[#05070b] p-4 transition hover:border-pump-green">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-full bg-pump-green/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pump-green">
          <Zap className="h-3 w-3" />
          Flash
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          {m.match} · {m.minute}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-white">{m.question}</h3>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <OutcomeChip label="YES" pct={m.yes} positive />
        <OutcomeChip label="NO" pct={m.no} />
      </div>
    </article>
  );
}

export function SideMarketRowCard({ m }: { m: SideMarketRow }) {
  return (
    <article className="rounded-xl border border-gray-800 bg-[#05070b] p-4 transition hover:border-pump-green">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-300">
          <Layers className="h-3 w-3" />
          Side market
        </span>
      </div>
      <h3 className="text-sm font-semibold text-white">{m.question}</h3>
      <div
        className={`mt-3 grid gap-2 ${
          m.outcomes.length === 2 ? "grid-cols-2" : "grid-cols-3"
        }`}
      >
        {m.outcomes.map((o) => (
          <OutcomeChip
            key={o.label}
            label={o.label}
            pct={o.pct}
            positive={o.pct >= 50}
          />
        ))}
      </div>
    </article>
  );
}

function OutcomeChip({
  label,
  pct,
  positive = false,
}: {
  label: string;
  pct: number;
  positive?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
        positive
          ? "border-pump-green/40 bg-pump-green/10"
          : "border-gray-700 bg-black/40"
      }`}
    >
      <span className={positive ? "font-semibold text-pump-green" : "font-semibold text-gray-200"}>
        {label}
      </span>
      <span className={positive ? "font-bold text-pump-green" : "font-bold text-white"}>
        {pct}%
      </span>
    </div>
  );
}
