// app/src/app/world-cup/_components/LeaderboardPreview.tsx
"use client";

import { Crown } from "lucide-react";
import { LEADERBOARD_TOP5, GOLD } from "./mockData";

export default function LeaderboardPreview() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#05070b]">
      <div className="hidden grid-cols-12 gap-2 border-b border-gray-800 bg-pump-gray/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 md:grid">
        <div className="col-span-1">Rank</div>
        <div className="col-span-6">Trader</div>
        <div className="col-span-3 text-right">Volume</div>
        <div className="col-span-2 text-right">ROI</div>
      </div>
      <ul className="divide-y divide-gray-800">
        {LEADERBOARD_TOP5.map((row) => (
          <li
            key={row.rank}
            className="grid grid-cols-12 items-center gap-2 px-4 py-3 transition hover:bg-pump-gray/40"
          >
            <div className="col-span-2 md:col-span-1">
              <RankBadge rank={row.rank} />
            </div>
            <div className="col-span-6 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-700 bg-pump-gray text-xs font-semibold text-gray-300">
                {row.username.slice(1, 3).toUpperCase()}
              </div>
              <span className="truncate text-sm font-semibold text-white">
                {row.username}
              </span>
            </div>
            <div className="col-span-2 text-right text-sm font-bold text-white tabular-nums md:col-span-3">
              {row.volume}
            </div>
            <div className="col-span-2 text-right text-sm font-bold text-pump-green tabular-nums">
              {row.roi}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-black"
        style={{ backgroundColor: GOLD }}
        title="1st"
      >
        <Crown className="h-3.5 w-3.5" />
      </div>
    );
  }
  return (
    <div className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-700 bg-pump-gray text-xs font-bold text-gray-200">
      {rank}
    </div>
  );
}
