"use client";

import { useEffect, useState } from "react";
import {
  getTradedVolume,
  formatMilestone,
  formatSol,
  formatProgressPct,
} from "@/lib/treasury";

// Thin wrapper around the shared treasury helper. Surfaces the same live
// figures the /treasury page and hub preview use — real traded volume,
// the current milestone, and progress within the milestone band. All math
// lives in lib/treasury.ts; this only handles the fetch wiring so heroes
// don't duplicate it.
export type TreasurySummary = {
  // Real traded volume, formatted e.g. "30.71 SOL". null while loading.
  volumeSol: string | null;
  // Live next milestone label e.g. "$10,000" / "Max". null while loading.
  nextLabel: string | null;
  // Rounded progress for the bar width (0 while loading).
  progressPct: number;
  // Progress label e.g. "46%" / "<1%". "—" while loading.
  progressLabel: string;
};

export function useTreasuryMilestone(): TreasurySummary {
  const [summary, setSummary] = useState<TreasurySummary>({
    volumeSol: null,
    nextLabel: null,
    progressPct: 0,
    progressLabel: "—",
  });

  useEffect(() => {
    let cancelled = false;
    getTradedVolume()
      .then((v) => {
        if (cancelled) return;
        setSummary({
          volumeSol: formatSol(v.sol),
          nextLabel: formatMilestone(v.nextMilestone),
          progressPct: Math.round(v.progressPct),
          progressLabel: formatProgressPct(v.progressPct),
        });
      })
      .catch(() => { /* keep loading defaults */ });
    return () => { cancelled = true; };
  }, []);

  return summary;
}
