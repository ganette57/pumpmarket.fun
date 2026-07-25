"use client";

// src/components/play/PlayOddsChart.tsx
//
// Play probability history chart. Reuses the exact visual language of the Real
// OddsHistoryChart (same Recharts component, same palette) but is fed ONLY by
// authoritative Play history from usePlayOddsHistory — never Real transactions,
// never Real odds. The Real chart component and its Real data path are left
// completely untouched.
//
// The internal client-side "live append" of OddsHistoryChart is disabled here
// (liveEnabled={false}): Play points come from the backend and refresh on the
// authoritative version signal, so the series stays server-authoritative and no
// synthetic points are ever invented.

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { usePlayOddsHistory } from "@/components/play/usePlayOddsHistory";

const OddsHistoryChart = dynamic(
  () => import("@/components/OddsHistoryChart"),
  { ssr: false }
);

export default function PlayOddsChart({
  marketAddress,
  outcomeNames,
  height = 280,
  enabled = true,
  maxPoints,
}: {
  marketAddress: string | null | undefined;
  outcomeNames: string[];
  height?: number;
  /** Only fetch/render while true (e.g. the drawer is open). */
  enabled?: boolean;
  maxPoints?: number;
}) {
  const { points, loading, error, loaded } = usePlayOddsHistory(marketAddress, {
    enabled,
    maxPoints,
  });

  const names = useMemo(
    () => (outcomeNames || []).filter(Boolean),
    [outcomeNames]
  );

  const skeletonH = Math.max(170, height - 40);

  // First load, nothing yet.
  if (loading && !loaded) {
    return (
      <div
        style={{ width: "100%", height: skeletonH }}
        className="flex items-center justify-center"
      >
        <span className="w-6 h-6 rounded-full border-2 border-pump-green/40 border-t-pump-green animate-spin" />
      </div>
    );
  }

  // Error — compact, never crashes the page, never falls back to Real.
  if (error && points.length < 2) {
    return (
      <div
        style={{ width: "100%", height: skeletonH }}
        className="flex items-center justify-center text-xs text-gray-500 text-center px-4"
      >
        Couldn&apos;t load Play chart. It&apos;ll retry on the next update.
      </div>
    );
  }

  // A single opening point is not yet a series to draw — the current odds are
  // already shown elsewhere. Never borrow Real history here.
  if (points.length < 2) {
    return (
      <div
        style={{ width: "100%", height: skeletonH }}
        className="flex items-center justify-center text-xs text-gray-500 text-center px-4"
      >
        No Play trading history yet
      </div>
    );
  }

  return (
    <OddsHistoryChart
      points={points}
      outcomeNames={names}
      height={height}
      liveEnabled={false}
    />
  );
}
