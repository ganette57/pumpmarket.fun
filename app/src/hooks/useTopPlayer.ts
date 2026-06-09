"use client";

import { useEffect, useState } from "react";
import { getLeaderboard, displayNameForRow } from "@/lib/leaderboard";

// Thin wrapper around the shared leaderboard helper. Returns the #1 player's
// display label (profile name, else short wallet), or null while loading /
// when there are no players. All ranking logic lives in lib/leaderboard.ts.
export function useTopPlayer(): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLeaderboard(1)
      .then((rows) => {
        if (cancelled) return;
        setName(rows[0] ? displayNameForRow(rows[0]) : null);
      })
      .catch(() => { if (!cancelled) setName(null); });
    return () => { cancelled = true; };
  }, []);

  return name;
}
