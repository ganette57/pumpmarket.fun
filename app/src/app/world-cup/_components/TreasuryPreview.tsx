// app/src/app/world-cup/_components/TreasuryPreview.tsx
"use client";

import { useEffect, useState } from "react";
import { BarChart3, Trophy, TrendingUp, Users } from "lucide-react";
import {
  CHAMPIONSHIP_TREASURY,
  getChampionshipStats,
  getTradedVolume,
  formatSol,
  formatMilestone,
  formatProgressPct,
  type ChampionshipStats,
  type TradedVolume,
} from "@/lib/treasury";
import { formatPoints } from "@/lib/funPoints";

const GREEN = "#00FF87";
const GREEN_SOFT = "#61ff9a";

// Compact Treasury preview for the World Cup hub. Trading volume + progress
// are REAL (same source as Admin Overview / the /treasury page); prize pool
// is a manual constant; Active Players is a real read-only count. Full page
// lives at /treasury.
export default function TreasuryPreview() {
  const [stats, setStats] = useState<ChampionshipStats | null>(null);
  const [volume, setVolume] = useState<TradedVolume | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getChampionshipStats().catch(() => null),
      getTradedVolume().catch(() => null),
    ]).then(([s, v]) => {
      if (cancelled) return;
      setStats(s);
      setVolume(v);
    });
    return () => { cancelled = true; };
  }, []);

  const t = CHAMPIONSHIP_TREASURY;
  const progressBarPct = volume ? Math.round(volume.progressPct) : 0;
  const progressLabel = volume ? formatProgressPct(volume.progressPct) : "—";
  const nextMilestoneLabel = volume ? formatMilestone(volume.nextMilestone) : "—";

  return (
    <div className="rounded-xl border border-gray-800 bg-[#05070b] p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={<BarChart3 className="h-4 w-4 text-pump-green" />} label="Trading Volume" value={volume ? formatSol(volume.sol) : "—"} accent />
        <Stat icon={<Trophy className="h-4 w-4 text-[#EAB54C]" />} label="Prize Pool" value={t.currentPrizePool} />
        <Stat icon={<TrendingUp className="h-4 w-4 text-pump-green" />} label="Next Milestone" value={nextMilestoneLabel} />
        <Stat
          icon={<Users className="h-4 w-4 text-pump-green" />}
          label="Active Players"
          value={stats ? formatPoints(stats.activePlayers) : "—"}
        />
      </div>

      {/* Progress bar — within the current → next milestone band */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400">
          <span>Progress toward {nextMilestoneLabel}</span>
          <span className="text-pump-green">{progressLabel}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progressBarPct}%`,
              background: `linear-gradient(90deg, ${GREEN} 0%, ${GREEN_SOFT} 100%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-pump-gray/40 px-3 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-400">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-base font-extrabold tabular-nums ${accent ? "text-pump-green" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}
