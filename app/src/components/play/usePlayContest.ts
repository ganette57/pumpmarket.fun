"use client";

// src/components/play/usePlayContest.ts
//
// The current public Play competition, from /api/play/contest.
//
// REAL SAFETY / MODE ISOLATION
// ----------------------------
// It fetches only while Play mode is active and reads nothing but
// /api/play/contest. Every fetch captures an epoch that bumps on mode
// change, so a late Play response can never paint after the user switched
// to Real. On error it does NOT fall back to anything — there is no Real
// read in this file at all.
//
// REFRESH POLICY — driven by how final the ranking is
// ---------------------------------------------------
// A FROZEN ranking is immutable by construction: no settlement can move
// it, so polling it would be pure load for a guaranteed-identical answer.
// It loads once and refreshes only on return-to-tab.
//
// A LIVE contest does move — the standings change every time a market
// settles — so it also polls on a slow timer while the tab is visible.
// The timer is paused when the document is hidden, so a backgrounded tab
// costs nothing, and a focus refetch shares one cooldown with it so an
// alt-tab cannot stack a burst of requests on top of a poll.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTradingMode } from "@/components/mode/ModeProvider";
import { playClient, type PlayContestResponse } from "@/lib/playClient";

/** Poll interval while a contest is actually running and the tab is visible. */
const LIVE_POLL_MS = 45_000;

/** Minimum gap between focus-triggered refetches, shared with the poll. */
const REFRESH_COOLDOWN_MS = 15_000;

export type PlayContestState = {
  data: PlayContestResponse | null;
  loading: boolean;
  error: boolean;
  /** True until the first response resolves — render the skeleton on this. */
  pending: boolean;
  refresh: () => void;
};

export function usePlayContest(opts?: { limit?: number }): PlayContestState {
  const { isPlay } = useTradingMode();
  const limit = opts?.limit;

  const [data, setData] = useState<PlayContestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const epochRef = useRef(0);
  const lastFetchAtRef = useRef(0);

  // Reset when Play is left, so a Play contest can never linger under Real.
  useEffect(() => {
    epochRef.current += 1;
    setData(null);
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
        const d = await playClient.contest(limit ? { limit } : undefined);
        if (epoch !== epochRef.current) return; // stale — discard
        setData(d);
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
  }, [isPlay, limit, reloadNonce]);

  const refresh = useCallback(() => setReloadNonce((n) => n + 1), []);

  const maybeRefresh = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    if (Date.now() - lastFetchAtRef.current < REFRESH_COOLDOWN_MS) return;
    setReloadNonce((n) => n + 1);
  }, []);

  // Return-to-tab: exactly when a stale ranking would be looked at.
  useEffect(() => {
    if (!isPlay) return;
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", maybeRefresh);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", maybeRefresh);
    };
  }, [isPlay, maybeRefresh]);

  // Slow poll, and ONLY while a contest is genuinely running. A frozen
  // snapshot cannot change, an upcoming contest has nothing to rank yet,
  // and a finished one is waiting on an admin action rather than on data.
  const isLive =
    data?.contest?.status === "live" && data?.meta.ranking_state === "preview";

  useEffect(() => {
    if (!isPlay || !isLive) return;

    const tick = () => {
      if (document.visibilityState === "hidden") return;
      maybeRefresh();
    };
    const id = window.setInterval(tick, LIVE_POLL_MS);
    return () => window.clearInterval(id);
  }, [isPlay, isLive, maybeRefresh]);

  return {
    data,
    loading,
    error,
    pending: isPlay && !loaded && !error,
    refresh,
  };
}
