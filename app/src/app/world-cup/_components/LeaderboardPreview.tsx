// app/src/app/world-cup/_components/LeaderboardPreview.tsx
"use client";

import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { GOLD } from "./mockData";
import {
  displayNameForRow,
  getLeaderboard,
  shortWallet,
  type LeaderboardRow,
} from "@/lib/leaderboard";
import { formatPoints } from "@/lib/funPoints";

// Compact, real top-5 preview for the World Cup hub. Reads the same
// global Fun Points leaderboard; full table lives at /leaderboard.
export default function LeaderboardPreview() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLeaderboard(5)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#05070b]">
      <div className="hidden grid-cols-12 gap-2 border-b border-gray-800 bg-pump-gray/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400 md:grid">
        <div className="col-span-1">Rank</div>
        <div className="col-span-7">Player</div>
        <div className="col-span-4 text-right">Lifetime Points</div>
      </div>

      {rows === null ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">
          No leaderboard entries yet. Start earning Fun Points to appear here.
        </div>
      ) : (
        <ul className="divide-y divide-gray-800">
          {rows.map((row) => (
            <li
              key={row.wallet}
              className="grid grid-cols-12 items-center gap-2 px-4 py-3 transition hover:bg-pump-gray/40"
            >
              <div className="col-span-2 md:col-span-1">
                <RankBadge rank={row.rank} />
              </div>
              <div className="col-span-6 flex items-center gap-2 md:col-span-7">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-700 bg-pump-gray text-xs font-semibold text-gray-300">
                  {(row.displayName?.trim() || row.wallet).slice(0, 2).toUpperCase()}
                </div>
                <span className="truncate text-sm font-semibold text-white">
                  {row.displayName?.trim() ? displayNameForRow(row) : shortWallet(row.wallet)}
                </span>
              </div>
              <div className="col-span-4 text-right text-sm font-bold text-pump-green tabular-nums">
                {formatPoints(row.lifetimePoints)}
              </div>
            </li>
          ))}
        </ul>
      )}
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
