// app/src/app/world-cup/_components/WorldCupMatchMarketCard.tsx
"use client";

import Link from "next/link";
import { Clock, TrendingUp } from "lucide-react";
import { lamportsToSol } from "@/utils/solana";
import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";
import type { WorldCupMarket } from "../_lib/marketQueries";

/**
 * Official World Cup match-market card.
 * Same visual shell as the homepage MarketCard, but renders the full
 * 3-way outcome layout (Home / Draw / Away) plus the match day + kickoff.
 * Display-only — links to the trade page.
 */
export default function WorldCupMatchMarketCard({
  market,
}: {
  market: WorldCupMarket;
}) {
  const outcomes =
    market.outcomeNames && market.outcomeNames.length >= 2
      ? market.outcomeNames
      : ["YES", "NO"];

  const supplies =
    market.outcomeSupplies && market.outcomeSupplies.length >= 2
      ? market.outcomeSupplies.map(Number)
      : [market.yesSupply || 0, market.noSupply || 0];

  const total = supplies.reduce((a, b) => a + (Number(b) || 0), 0);
  const percents = supplies.map((s) =>
    total > 0 ? Math.round((Number(s) / total) * 100) : Math.round(100 / supplies.length),
  );

  const volSol = lamportsToSol(market.totalVolume);
  const kickoff = market.kickoffIso ? formatKickoff(market.kickoffIso) : null;
  const image =
    market.imageUrl && market.imageUrl !== "null" ? market.imageUrl : undefined;

  // Show up to 3 outcomes (Home / Draw / Away).
  const shown = outcomes.slice(0, 3).map((label, i) => ({
    label,
    pct: percents[i] ?? 0,
  }));

  return (
    <Link href={`/trade/${market.publicKey}`} className="block group h-full">
      <article className="relative h-full overflow-hidden rounded-xl border border-gray-800 bg-[#05070b] transition-all hover:border-pump-green hover:shadow-xl">
        {/* Image */}
        <div className="relative h-36 w-full overflow-hidden bg-black">
          {image ? (
            <img
              src={image}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover opacity-80 transition group-hover:opacity-95"
            />
          ) : (
            <div className="flex h-full w-full scale-[0.6] items-center justify-center opacity-60">
              <CategoryImagePlaceholder category="soccer" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#05070b] via-transparent" />
          <div className="absolute left-3 top-3">
            <span className="inline-flex items-center rounded-full border border-gray-700 bg-black/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-200">
              Soccer
            </span>
          </div>
          {market.ended && (
            <div className="absolute right-3 top-3">
              <span className="inline-flex items-center rounded-full border border-gray-700 bg-black/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-200">
                Ended
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-col gap-2 p-4">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-tight text-white transition group-hover:text-pump-green">
            {market.question}
          </h3>

          {kickoff && (
            <div className="inline-flex items-center gap-1 text-[11px] text-gray-400">
              <Clock className="h-3 w-3" />
              {kickoff}
            </div>
          )}

          {/* Outcomes: Home (green) / Draw (slate) / Away (pink) */}
          <div className="flex gap-2">
            {shown.map((o, i) => (
              <div
                key={`${o.label}-${i}`}
                className={`flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg p-2 text-center ${outcomeColor(
                  i,
                  shown.length,
                )}`}
              >
                <span className="max-w-full truncate text-[10px] font-bold uppercase tracking-wide">
                  {abbrev(o.label)}
                </span>
                <span className="text-[16px] font-bold md:text-[18px]">
                  {o.pct}%
                </span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-1 flex items-center justify-between border-t border-gray-800 pt-2 text-[11px] text-gray-400">
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-pump-green" />
              <span className="font-semibold text-white">
                {volSol.toFixed(2)} SOL
              </span>
            </span>
            <span className="font-semibold text-pump-green">Trade →</span>
          </div>
        </div>
      </article>
    </Link>
  );
}

function outcomeColor(i: number, count: number): string {
  if (i === 0) return "bg-[#00FF87] text-black";
  if (i === count - 1) return "bg-[#ff5c73] text-black";
  return "bg-gray-700 text-white";
}

function abbrev(label: string): string {
  const s = String(label || "").trim();
  if (s.length <= 9) return s;
  return s.slice(0, 8) + "…";
}

/** ISO → "Jun 13 · 19:00" in UTC (stable across SSR/CSR). */
function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const month = d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day} · ${hh}:${mm}`;
}
