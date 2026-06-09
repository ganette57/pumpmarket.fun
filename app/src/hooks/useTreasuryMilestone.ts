"use client";

import { useEffect, useState } from "react";
import { getTradedVolume, formatMilestone } from "@/lib/treasury";

// Thin wrapper around the shared treasury helper. Returns the live next
// milestone label (e.g. "$10,000", or "Max" once all are reached), or null
// while loading. All milestone math lives in lib/treasury.ts — this only
// handles the fetch wiring so heroes don't duplicate it.
export function useTreasuryMilestone(): { nextLabel: string | null } {
  const [nextLabel, setNextLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTradedVolume()
      .then((v) => { if (!cancelled) setNextLabel(formatMilestone(v.nextMilestone)); })
      .catch(() => { if (!cancelled) setNextLabel(null); });
    return () => { cancelled = true; };
  }, []);

  return { nextLabel };
}
