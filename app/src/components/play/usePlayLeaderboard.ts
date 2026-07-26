"use client";

// src/components/play/usePlayLeaderboard.ts
//
// The public Play leaderboard, from the authoritative /api/play/leaderboard
// route.
//
// REAL SAFETY / MODE ISOLATION
// ----------------------------
// It fetches only while Play mode is active and reads nothing but
// /api/play/leaderboard. Every fetch captures an epoch that bumps on mode
// change, so a late Play response can never paint after the user switched to
// Real. On error it does NOT fall back to the Real leaderboard — there is no
// Real read in this file at all.
//
// NO POLLING
// ----------
// A leaderboard is not a live book: it moves when a MARKET SETTLES, which is
// an admin action that can land minutes apart, not on a ticker. So it loads
// once per Play entry and refetches when the tab REGAINS FOCUS — exactly when
// a stale ranking would be looked at. A cooldown collapses the burst of events
// a single alt-tab produces, so this stays one request per return-to-tab and
// never a background timer.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTradingMode } from "@/components/mode/ModeProvider";
import { playClient, type PlayLeaderboardView } from "@/lib/playClient";

/** Minimum gap between focus-triggered refetches. */
const FOCUS_REFRESH_COOLDOWN_MS = 15_000;

export type PlayLeaderboardState = {
  leaderboard: PlayLeaderboardView | null;
  loading: boolean;
  error: boolean;
  /** True until the first response resolves — render the skeleton on this. */
  pending: boolean;
  refresh: () => void;
};

export function usePlayLeaderboard(opts?: {
  limit?: number;
}): PlayLeaderboardState {
  const { isPlay } = useTradingMode();
  const limit = opts?.limit;

  const [leaderboard, setLeaderboard] = useState<PlayLeaderboardView | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Bumped by refresh() only — the error state never retries on its own.
  const [reloadNonce, setReloadNonce] = useState(0);

  const epochRef = useRef(0);
  /** When the last fetch resolved — drives the focus-refetch cooldown. */
  const lastFetchAtRef = useRef(0);

  // Reset when Play is left, so a Play ranking can never linger under Real.
  useEffect(() => {
    epochRef.current += 1;
    setLeaderboard(null);
    setLoaded(false);
    setError(false);
    setLoading(false);
  }, [isPlay]);

  useEffect(() => {
    if (!isPlay) return;

    const epoch = ++epochRef.current;
    setLoading(true);

    (async () => {
      try {
        const l = await playClient.leaderboard(limit ? { limit } : undefined);
        if (epoch !== epochRef.current) return; // stale — discard
        setLeaderboard(l);
        setError(false);
        setLoaded(true);
      } catch {
        if (epoch !== epochRef.current) return;
        setLeaderboard(null);
        setError(true);
        setLoaded(true);
      } finally {
        if (epoch === epochRef.current) {
          lastFetchAtRef.current = Date.now();
          setLoading(false);
        }
      }
    })();
  }, [isPlay, limit, reloadNonce]);

  const refresh = useCallback(() => setReloadNonce((n) => n + 1), []);

  // Refetch on return-to-tab, so a market settled while the user was away
  // moves the ranking without a reload. Not a poll: it fires only on a real
  // focus/visibility transition.
  useEffect(() => {
    if (!isPlay) return;

    const maybeRefresh = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastFetchAtRef.current < FOCUS_REFRESH_COOLDOWN_MS) return;
      setReloadNonce((n) => n + 1);
    };

    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", maybeRefresh);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", maybeRefresh);
    };
  }, [isPlay]);

  return {
    leaderboard,
    loading,
    error,
    pending: isPlay && !loaded && !error,
    refresh,
  };
}
