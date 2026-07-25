"use client";

// src/components/play/usePlayOddsHistory.ts
//
// Authoritative Play probability history for one market's chart, built on the
// public /api/play/markets/history endpoint and the existing
// MarketSnapshotProvider — no second store, no second polling loop.
//
// LIVE UPDATES WITHOUT A NEW POLL
// -------------------------------
// The provider already polls the authoritative Play book for watched Live
// markets (and refetches on a user's own trade via invalidate on Market
// Detail). This hook piggybacks on that: it reads the current Play snapshot's
// change signal (updated_at + status) and refetches the FULL history only when
// that signal advances — i.e. once per new trade / settlement — not on every
// 1.5s poll tick. So a trade on any client appears as a new chart point within
// one poll interval, without a dedicated high-frequency history loop.
//
// REAL SAFETY / MODE ISOLATION
// ----------------------------
// It fetches only while Play mode is active and `enabled` is true. Every fetch
// captures an epoch that bumps on mode change / signal change, so a late Play
// response can never paint after the user has switched to Real (or moved on).
// It never reads Real data.

import { useEffect, useRef, useState } from "react";
import { useMarketSnapshot } from "@/components/mode/MarketSnapshotProvider";
import { playClient } from "@/lib/playClient";

export type PlayOddsPoint = { t: number; pct: number[] };

export type PlayOddsHistory = {
  points: PlayOddsPoint[];
  outcomeCount: number;
  status: string;
  loading: boolean;
  error: boolean;
  /** True once a fetch has resolved (success or empty) at least once. */
  loaded: boolean;
};

const EMPTY: PlayOddsPoint[] = [];

export function usePlayOddsHistory(
  marketAddress: string | null | undefined,
  opts?: { enabled?: boolean; maxPoints?: number }
): PlayOddsHistory {
  const enabled = opts?.enabled ?? true;
  const maxPoints = opts?.maxPoints;
  const addr = marketAddress ?? "";

  // Current-mode snapshot: in Play mode this carries the authoritative change
  // signal (updated_at bumps on every trade, status on settlement).
  const { snapshot, mode } = useMarketSnapshot(addr);
  const isPlay = mode === "play";
  const signal =
    isPlay && snapshot
      ? `${snapshot.updatedAt ?? "0"}|${snapshot.status}`
      : null;

  const [points, setPoints] = useState<PlayOddsPoint[]>(EMPTY);
  const [outcomeCount, setOutcomeCount] = useState(0);
  const [status, setStatus] = useState("open");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Bumps on every fetch — drops stale in-flight responses.
  const epochRef = useRef(0);

  const active = enabled && isPlay && !!addr;

  // Reset when the target market changes or Play is left, so a previous
  // market's series can never flash under a new one.
  useEffect(() => {
    epochRef.current += 1;
    setPoints(EMPTY);
    setOutcomeCount(0);
    setLoaded(false);
    setError(false);
    setLoading(false);
  }, [addr, isPlay, enabled]);

  useEffect(() => {
    if (!active) return;

    const epoch = ++epochRef.current;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    // Coalesce back-to-back signal changes (e.g. rapid trades) into one fetch.
    debounce = setTimeout(() => {
      setLoading((prev) => (loaded ? prev : true));
      (async () => {
        try {
          const h = await playClient.marketHistory(
            addr,
            maxPoints ? { maxPoints } : undefined
          );
          if (epoch !== epochRef.current) return; // stale — discard
          setPoints(
            (h.points ?? []).map((p) => ({
              t: new Date(p.t).getTime(),
              pct: Array.isArray(p.pct) ? p.pct.map((v) => Number(v) || 0) : [],
            }))
          );
          setOutcomeCount(Number(h.outcome_count) || 0);
          setStatus(String(h.status || "open"));
          setError(false);
          setLoaded(true);
        } catch {
          if (epoch !== epochRef.current) return;
          setError(true);
          setLoaded(true);
        } finally {
          if (epoch === epochRef.current) setLoading(false);
        }
      })();
    }, 250);

    return () => {
      if (debounce) clearTimeout(debounce);
    };
    // `signal` drives the refetch-on-new-trade; `active`/`addr` drive mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, addr, signal, maxPoints]);

  return { points, outcomeCount, status, loading, error, loaded };
}
