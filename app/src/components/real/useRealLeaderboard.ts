"use client";

// src/components/real/useRealLeaderboard.ts
//
// The Real "Road to $1M" ranking, from /api/real/leaderboard.
//
// PLAY ISOLATION
// --------------
// It fetches only while REAL mode is active and reads nothing but
// /api/real/leaderboard. Every fetch captures an epoch that bumps on mode
// change, so a late Real response can never paint after the user switched
// to Play. There is no Play read in this file, and on error it falls back
// to nothing — never to Play data, never to a static ranking.
//
// REFRESH POLICY
// --------------
// A claimed-profit ranking moves only when somebody CLAIMS — an on-chain
// action that lands minutes apart, not on a ticker. So it loads on mount,
// refetches when the tab regains focus (exactly when a stale ranking would
// be looked at), and otherwise polls slowly and only while visible. The
// focus refetch and the poll share one cooldown, so an alt-tab can never
// stack a burst of requests on top of a poll.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTradingMode } from "@/components/mode/ModeProvider";

export type RealLeaderboardRowView = {
  rank: number;
  wallet_address: string;
  username: string | null;
  avatar_url: string | null;
  claimed_profit_sol: string;
  settled_claimed_positions: number;
  wins: number;
  losses: number;
  win_rate: string;
  total_settled_volume_sol: string;
};

export type RealLeaderboardResponse = {
  rows: RealLeaderboardRowView[];
  viewer: RealLeaderboardRowView | null;
  meta: {
    generated_at: string;
    total_traders: number;
    cluster: string;
    is_test_data: boolean;
    excluded_unclaimed_positions: number;
    eligible_rows: number;
  };
  /** null when the price is unavailable or stale — hide every USD figure. */
  sol_usd: { usd: number; as_of: string } | null;
};

/** Slowest sensible cadence for a board that only moves on a claim. */
const POLL_MS = 90_000;

/** Minimum gap between refetches, shared by focus and poll. */
const REFRESH_COOLDOWN_MS = 30_000;

export type RealLeaderboardState = {
  data: RealLeaderboardResponse | null;
  loading: boolean;
  error: boolean;
  /** True until the first response resolves — render the skeleton on this. */
  pending: boolean;
  refresh: () => void;
};

export function useRealLeaderboard(opts?: {
  limit?: number;
  /** Connected Real wallet, for the "Your rank" card. */
  wallet?: string | null;
}): RealLeaderboardState {
  const { isPlay } = useTradingMode();
  const isReal = !isPlay;
  const limit = opts?.limit;
  const wallet = opts?.wallet ?? null;

  const [data, setData] = useState<RealLeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const epochRef = useRef(0);
  const lastFetchAtRef = useRef(0);

  // Reset when Real is left, so a Real ranking can never linger under Play.
  useEffect(() => {
    epochRef.current += 1;
    setData(null);
    setLoaded(false);
    setError(false);
    setLoading(false);
  }, [isReal]);

  useEffect(() => {
    if (!isReal) return;

    const epoch = ++epochRef.current;
    setLoading(true);

    (async () => {
      try {
        const res = await fetch("/api/real/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ limit, wallet }),
        });
        const json = await res.json().catch(() => null);
        if (epoch !== epochRef.current) return; // stale — discard
        if (!res.ok || !json || json.error) throw new Error(json?.error || "failed");
        setData(json as RealLeaderboardResponse);
        setError(false);
        setLoaded(true);
      } catch {
        if (epoch !== epochRef.current) return;
        setData(null);
        setError(true);
        setLoaded(true);
      } finally {
        if (epoch === epochRef.current) {
          lastFetchAtRef.current = Date.now();
          setLoading(false);
        }
      }
    })();
  }, [isReal, limit, wallet, reloadNonce]);

  const refresh = useCallback(() => setReloadNonce((n) => n + 1), []);

  const maybeRefresh = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    if (Date.now() - lastFetchAtRef.current < REFRESH_COOLDOWN_MS) return;
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!isReal) return;
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", maybeRefresh);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", maybeRefresh);
    };
  }, [isReal, maybeRefresh]);

  useEffect(() => {
    if (!isReal) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      maybeRefresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [isReal, maybeRefresh]);

  return {
    data,
    loading,
    error,
    pending: isReal && !loaded && !error,
    refresh,
  };
}
