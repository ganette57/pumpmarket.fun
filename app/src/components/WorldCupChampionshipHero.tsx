// app/src/components/WorldCupChampionshipHero.tsx
"use client";

import Link from "next/link";
import { Trophy } from "lucide-react";

/**
 * World Cup Championship hero card.
 *
 * Used in the desktop home carousel (h-[400px] slot) and as the first card in
 * the mobile home feed. FunMarket palette: white headline, neon-green accents,
 * dark-glass stats card. Responsive: stacks on mobile, grid on md+.
 * Mock data only — no API calls, no backend.
 */

const GREEN = "#00FF87";
const GREEN_SOFT = "#61ff9a";

const STATS = {
  prizePool: "$150,000",
  volume: "$27,358,492",
  nextMilestone: "$50,000,000",
  yourRank: "#842",
  topTrader: "@MaxTrader",
  // % progress toward next milestone (mock)
  progressPct: 54,
};

export default function WorldCupChampionshipHero() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-pump-green/25 bg-pump-gray">
      {/* Center visual */}
      <img
        src="/world-cup/championship-hero.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover opacity-60"
      />
      {/* Dark gradients so left/right copy stays readable over the image */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.55) 32%, rgba(10,10,10,0.35) 50%, rgba(10,10,10,0.65) 72%, rgba(10,10,10,0.92) 100%)",
        }}
      />
      {/* Subtle green vignette */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,255,135,0.08) 0%, rgba(0,255,135,0) 55%)",
        }}
      />

      {/* Content grid: left copy / spacer / right stats */}
      <div className="relative z-10 flex h-full flex-col justify-center gap-4 overflow-y-auto p-5 md:grid md:grid-cols-12 md:gap-6 md:overflow-visible md:p-8">
        {/* LEFT */}
        <div className="flex flex-col justify-center md:col-span-5 md:h-full">
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-pump-green/40 bg-black/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white md:text-[11px]">
            <Trophy className="h-3.5 w-3.5 text-pump-green" />
            FunMarket Championship
          </div>

          <h1 className="mt-4 text-3xl font-extrabold leading-tight tracking-tight text-white md:text-4xl">
            WORLD CUP
            <br />
            CHAMPIONSHIP
          </h1>

          <p className="mt-2 text-lg font-semibold text-white">
            Road To <span className="text-pump-green">$1,000,000</span>
          </p>

          <p className="mt-3 max-w-md text-sm leading-relaxed text-gray-300">
            Trade the World Cup.
            <br />
            Climb the leaderboard.
            <br />
            Share up to{" "}
            <span className="font-semibold text-pump-green">$1,000,000</span>.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/world-cup"
              className="inline-flex h-10 items-center justify-center rounded-full bg-pump-green px-5 text-sm font-bold text-black transition hover:bg-pump-green/90"
            >
              Join Championship
            </Link>
            <Link
              href="/world-cup/leaderboard"
              className="inline-flex h-10 items-center justify-center rounded-full border border-pump-green/60 bg-black/30 px-5 text-sm font-semibold text-pump-green transition hover:bg-black/50"
            >
              View Leaderboard
            </Link>
          </div>
        </div>

        {/* SPACER for the trophy image (desktop only) */}
        <div className="hidden md:col-span-3 md:block" aria-hidden="true" />

        {/* RIGHT — dark glass stats card with subtle green glow */}
        <div className="flex items-center justify-start md:col-span-4 md:h-full md:justify-end">
          <div className="w-full rounded-2xl border border-pump-green/20 bg-black/55 p-4 backdrop-blur-sm shadow-[0_0_40px_rgba(0,255,135,0.10)] md:max-w-xs">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-pump-green">
              Championship Stats
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatBlock label="Prize Pool" value={STATS.prizePool} accent />
              <StatBlock label="Volume" value={STATS.volume} />
              <StatBlock label="Next Milestone" value={STATS.nextMilestone} />
              <StatBlock label="Your Rank" value={STATS.yourRank} />
            </div>

            <div className="mt-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-400">
                Top Trader
              </div>
              <div className="mt-0.5 text-sm font-semibold text-white">
                {STATS.topTrader}
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400">
                <span>Progress</span>
                <span className="text-pump-green">{STATS.progressPct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${STATS.progressPct}%`,
                    background: `linear-gradient(90deg, ${GREEN} 0%, ${GREEN_SOFT} 100%)`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-bold ${accent ? "text-pump-green" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}
