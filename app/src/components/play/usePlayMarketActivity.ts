"use client";

// src/components/play/usePlayMarketActivity.ts
//
// Authoritative PUBLIC Play trade activity for one market. The single data
// source behind every Play activity surface (Market Detail, the mobile Home
// Feed drawer, the Live mobile drawer, the Live desktop panel) — one endpoint,
// one hook, no per-surface query.
//
// LIVE UPDATES WITHOUT A NEW POLL
// -------------------------------
// Identical strategy to usePlayOddsHistory, and for the same reason: the
// MarketSnapshotProvider ALREADY polls the authoritative Play book for watched
// markets (one shared interval, Play mode only, paused when the tab is
// hidden). This hook registers a watcher while it is active and then refetches
// the list only when that snapshot's change signal (updated_at + status)
// advances — i.e. once per new trade or settlement, from ANY client — instead
// of re-reading the ledger on every poll tick. No second polling architecture,
// no per-surface interval.
//
// REAL SAFETY / MODE ISOLATION
// ----------------------------
// It fetches only while Play mode is active and `enabled` is true, and it
// reads nothing but /api/play/markets/activity. Every fetch captures an epoch
// that bumps on mode change, market change and signal change, so a late Play
// response can never paint after the user switched to Real, swiped to another
// market, or closed the drawer.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useMarketSnapshot,
  useMarketSnapshotActions,
} from "@/components/mode/MarketSnapshotProvider";
import { playClient, type PlayActivityRowView } from "@/lib/playClient";

export type PlayActivityRow = PlayActivityRowView;

export type PlayMarketActivity = {
  rows: PlayActivityRow[];
  /** Outcome names from the market row, for trades stored without a name. */
  outcomeNames: string[];
  loading: boolean;
  error: boolean;
  /** True once a fetch has resolved (success or empty) at least once. */
  loaded: boolean;
  /**
   * A first result is still owed: the surface is live but nothing has resolved
   * yet — including during the debounce window, before `loading` flips. Render
   * the spinner on this, NOT on `loading`, or the empty state flashes first.
   * False when there is nothing to fetch (no address / Real mode), which is
   * what lets the empty state show instead of a spinner that never ends.
   */
  pending: boolean;
  /** Manual refetch for the error state's Retry. Never auto-retries. */
  refresh: () => void;
};

const EMPTY: PlayActivityRow[] = [];
const EMPTY_NAMES: string[] = [];

export function usePlayMarketActivity(
  marketAddress: string | null | undefined,
  opts?: { enabled?: boolean; limit?: number }
): PlayMarketActivity {
  const enabled = opts?.enabled ?? true;
  const limit = opts?.limit;
  const addr = marketAddress ?? "";

  // Current-mode snapshot: in Play mode this carries the authoritative change
  // signal (updated_at bumps on every trade, status on settlement).
  const { snapshot, mode } = useMarketSnapshot(addr);
  const { watchPlayMarket } = useMarketSnapshotActions();
  const isPlay = mode === "play";
  const signal =
    isPlay && snapshot ? `${snapshot.updatedAt ?? "0"}|${snapshot.status}` : null;

  const [rows, setRows] = useState<PlayActivityRow[]>(EMPTY);
  const [outcomeNames, setOutcomeNames] = useState<string[]>(EMPTY_NAMES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Bumped by refresh() only — the error state never retries on its own.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Bumps on every fetch — drops stale in-flight responses.
  const epochRef = useRef(0);

  const active = enabled && isPlay && !!addr;

  // Keep this market's Play book fresh cross-client while the surface is open,
  // using the provider's existing refcounted watcher (no new interval). The
  // unwatch runs on close / market change / mode change.
  useEffect(() => {
    if (!active) return;
    return watchPlayMarket(addr);
  }, [active, addr, watchPlayMarket]);

  // Reset when the target market changes or Play is left, so one market's
  // rows can never flash under another — or under Real.
  useEffect(() => {
    epochRef.current += 1;
    setRows(EMPTY);
    setOutcomeNames(EMPTY_NAMES);
    setLoaded(false);
    setError(false);
    setLoading(false);
  }, [addr, isPlay, enabled]);

  useEffect(() => {
    if (!active) return;

    const epoch = ++epochRef.current;

    // Coalesce back-to-back signal changes (e.g. rapid trades) into one fetch.
    const debounce = setTimeout(() => {
      setLoading((prev) => (loaded ? prev : true));
      (async () => {
        try {
          const a = await playClient.marketActivity(
            addr,
            limit ? { limit } : undefined
          );
          if (epoch !== epochRef.current) return; // stale — discard
          setRows(a.rows ?? EMPTY);
          setOutcomeNames(a.outcome_names ?? EMPTY_NAMES);
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

    return () => clearTimeout(debounce);
    // `signal` drives the refetch-on-new-trade; `active`/`addr` drive mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, addr, signal, limit, reloadNonce]);

  const refresh = useCallback(() => setReloadNonce((n) => n + 1), []);

  return {
    rows,
    outcomeNames,
    loading,
    error,
    loaded,
    pending: active && !loaded && !error,
    refresh,
  };
}
