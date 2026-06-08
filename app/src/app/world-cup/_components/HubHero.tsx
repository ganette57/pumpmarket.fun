// app/src/app/world-cup/_components/HubHero.tsx
"use client";

import Link from "next/link";
import { Trophy } from "lucide-react";
import { CHAMPIONSHIP_STATS } from "./mockData";

const GREEN = "#00FF87";
const GREEN_SOFT = "#61ff9a";

/**
 * Hub-page Championship hero. Larger than the carousel slot variant —
 * full-width banner with image, copy + stats panel. FunMarket palette:
 * white headline, neon-green accents/CTAs, dark-glass stats card.
 */
export default function HubHero() {
  return (
    <section className="pt-6 pb-4">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl border border-pump-green/25 bg-pump-gray">
          {/* Center visual */}
          <img
            src="/world-cup/championship-hero.png"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-55"
          />
          {/* Side gradients so the copy stays readable */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, rgba(10,10,10,0.94) 0%, rgba(10,10,10,0.55) 32%, rgba(10,10,10,0.35) 50%, rgba(10,10,10,0.65) 72%, rgba(10,10,10,0.94) 100%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(0,255,135,0.08) 0%, rgba(0,255,135,0) 55%)",
            }}
          />

          {/* Content */}
          <div className="relative z-10 grid min-h-[360px] grid-cols-1 gap-6 p-6 md:min-h-[440px] md:grid-cols-12 md:gap-8 md:p-10">
            {/* LEFT copy */}
            <div className="flex flex-col justify-center md:col-span-5">
              <div className="inline-flex items-center gap-2 self-start rounded-full border border-pump-green/40 bg-black/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                <Trophy className="h-3.5 w-3.5 text-pump-green" />
                FunMarket Championship
              </div>

              <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight text-white md:text-5xl">
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
                  href="/rewards"
                  className="inline-flex h-10 items-center justify-center rounded-full bg-pump-green px-5 text-sm font-bold text-black transition hover:bg-pump-green/90"
                >
                  Earn Fun Points
                </Link>
                <Link
                  href="/world-cup/leaderboard"
                  className="inline-flex h-10 items-center justify-center rounded-full border border-pump-green/60 bg-black/30 px-5 text-sm font-semibold text-pump-green transition hover:bg-black/50"
                >
                  View Leaderboard
                </Link>
              </div>
            </div>

            {/* Spacer for the trophy image (desktop only) */}
            <div className="hidden md:block md:col-span-3" aria-hidden="true" />

            {/* RIGHT stats panel — dark glass with subtle green glow */}
            <div className="flex md:col-span-4">
              <div className="w-full self-center rounded-2xl border border-pump-green/20 bg-black/55 p-4 backdrop-blur-sm shadow-[0_0_40px_rgba(0,255,135,0.10)]">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-pump-green">
                  Championship Stats
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <StatBlock label="Prize Pool" value={CHAMPIONSHIP_STATS.prizePool} accent />
                  <StatBlock label="Volume" value={CHAMPIONSHIP_STATS.volume} />
                  <StatBlock label="Next Milestone" value={CHAMPIONSHIP_STATS.nextMilestone} />
                  <StatBlock label="Your Rank" value={CHAMPIONSHIP_STATS.yourRank} />
                </div>

                <div className="mt-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400">
                    Top Trader
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-white">
                    {CHAMPIONSHIP_STATS.topTrader}
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400">
                    <span>Progress</span>
                    <span className="text-pump-green">
                      {CHAMPIONSHIP_STATS.progressPct}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${CHAMPIONSHIP_STATS.progressPct}%`,
                        background: `linear-gradient(90deg, ${GREEN} 0%, ${GREEN_SOFT} 100%)`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
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
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mt-0.5 text-sm font-bold ${accent ? "text-pump-green" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}
