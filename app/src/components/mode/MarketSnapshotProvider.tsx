"use client";

// src/components/mode/MarketSnapshotProvider.tsx
//
// Mode-aware market snapshots for the Home Feed and Live.
//
// ROOT CAUSE THIS FIXES
// ---------------------
// The feed loaded Real market rows from /api/home once into React state and
// rendered supplies/volume straight off them. Nothing in that pipeline was
// keyed by trading mode, so flipping PLAY/REAL re-rendered the SAME Real
// numbers — and a Play trade even mutated those Real supplies optimistically.
// The cure is data ownership, not a reload: every mode-specific value now
// comes from a snapshot addressed by BOTH market address and mode.
//
// CACHE IDENTITY: `${mode}:${marketAddress}`. A Real snapshot can never be
// served as a Play snapshot or vice versa — they live in different keys.
//
// STALE-RESPONSE SAFETY: every fetch captures an epoch that increments on
// each mode change. A response whose epoch is no longer current is dropped,
// so PLAY -> REAL -> PLAY can never let an in-flight response paint the
// wrong mode's economics.
//
// IDEMPOTENT WRITES: publishRealSnapshots and the Play fetch/poll apply only
// REPLACE an entry when its content actually changed, returning the previous
// state object otherwise. Two things depend on this:
//   1. Callers may hand us a fresh object every render (e.g. a Live surface
//      whose realFallback is rebuilt each render). Without the equality gate
//      that would setState → re-render → rebuild → setState forever — the
//      "Maximum update depth exceeded" loop the Live graph tripped.
//   2. The Play cross-client poll below can run every ~1.5s without causing a
//      re-render when nothing moved.
//
// CROSS-CLIENT PLAY SYNC: the authoritative Play state (play_market_states)
// is server-only (RLS with no anon policy, revoked from anon/authenticated)
// and is NOT in a Supabase Realtime publication, so the browser cannot
// subscribe to it. Instead this provider centralises a single, visibility-
// aware poll of the public /api/play/markets endpoint for the Play markets a
// surface has asked to WATCH. That keeps every client (tab/device) converging
// on the same authoritative Play odds/volume without a second store and
// without each component opening its own subscription.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTradingMode } from "@/components/mode/ModeProvider";
import { playClient, type PlayMarketSnapshotView } from "@/lib/playClient";
import type { TradingMode } from "@/lib/tradingMode";

export type MarketSnapshot = {
  mode: TradingMode;
  marketAddress: string;
  /** Raw per-outcome supply. Real: share counts. Play: virtual shares. */
  supplies: string[];
  /** 0..1 per outcome. */
  probabilities: number[];
  /** Real: lamports. Play: USD decimal string. Interpret via `mode`. */
  volume: string;
  status: string;
  /** Play only: no trades yet, showing the backend opening book. */
  seeded?: boolean;
  updatedAt?: string | null;
  /**
   * PLAY ONLY: actual cumulative USD staked per outcome, index-stable.
   * Undefined in Real — Real has no equivalent authoritative aggregation on
   * this surface, so Real call sites keep their existing display.
   */
  stakeByOutcomeUsd?: string[];
};

type Entry =
  | { state: "loading" }
  | { state: "ready"; snapshot: MarketSnapshot }
  | { state: "unavailable" };

type Ctx = {
  /** Feed pages publish the Real rows they already loaded. No extra fetch. */
  publishRealSnapshots: (snaps: MarketSnapshot[]) => void;
  /** Drop a cached snapshot for one market in one mode (post-trade). */
  invalidate: (mode: TradingMode, marketAddress: string) => void;
  /**
   * Register interest in live PLAY updates for one market. While at least one
   * watcher is active AND the app is in Play mode AND the tab is visible, the
   * provider polls the authoritative Play snapshot for this market so other
   * clients' trades appear here. Returns an unwatch cleanup — call it on
   * unmount / market change. Real mode is never polled.
   */
  watchPlayMarket: (marketAddress: string) => () => void;
  getEntry: (marketAddress: string) => Entry | undefined;
  /** Current mode, so consumers format the right currency. */
  mode: TradingMode;
};

const SnapshotContext = createContext<Ctx | null>(null);

const key = (mode: TradingMode, addr: string) => `${mode}:${addr}`;

/** How often to poll the authoritative Play book for watched Live markets. */
const PLAY_POLL_MS = 1500;

/** Content equality for a snapshot — drives idempotent store writes. */
function sameSnapshot(a?: MarketSnapshot, b?: MarketSnapshot): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.mode !== b.mode ||
    a.status !== b.status ||
    a.volume !== b.volume ||
    !!a.seeded !== !!b.seeded ||
    (a.updatedAt ?? null) !== (b.updatedAt ?? null) ||
    a.supplies.length !== b.supplies.length ||
    a.probabilities.length !== b.probabilities.length ||
    (a.stakeByOutcomeUsd?.length ?? -1) !== (b.stakeByOutcomeUsd?.length ?? -1)
  ) {
    return false;
  }
  for (let i = 0; i < a.supplies.length; i++) {
    if (a.supplies[i] !== b.supplies[i]) return false;
  }
  for (let i = 0; i < a.probabilities.length; i++) {
    if (a.probabilities[i] !== b.probabilities[i]) return false;
  }
  // Staked-per-outcome must take part in equality, or a poll that only moved
  // stake would be treated as "no change" and never reach the UI.
  const aStake = a.stakeByOutcomeUsd;
  const bStake = b.stakeByOutcomeUsd;
  if (aStake && bStake) {
    for (let i = 0; i < aStake.length; i++) {
      if (aStake[i] !== bStake[i]) return false;
    }
  }
  return true;
}

/** Normalises a raw Play API snapshot into our MarketSnapshot shape. */
function buildPlaySnapshot(
  addr: string,
  s: PlayMarketSnapshotView
): MarketSnapshot {
  return {
    mode: "play",
    marketAddress: addr,
    supplies: s.supplies ?? [],
    probabilities: s.probabilities ?? [],
    volume: String(s.virtual_pool_usd ?? "0"),
    status: s.status ?? "open",
    seeded: !!s.seeded,
    updatedAt: s.updated_at,
    stakeByOutcomeUsd: s.stake_by_outcome_usd ?? [],
  };
}

export function MarketSnapshotProvider({ children }: { children: ReactNode }) {
  const { mode } = useTradingMode();

  const [entries, setEntries] = useState<Record<string, Entry>>({});
  // Addresses currently visible in the feed, so a mode switch knows what to load.
  const addressesRef = useRef<Set<string>>(new Set());
  // Bumped on every mode change — the stale-response guard.
  const epochRef = useRef(0);
  const inFlightRef = useRef<Set<string>>(new Set());
  // Markets a Live surface asked to keep fresh cross-client (refcounted).
  const watchersRef = useRef<Map<string, number>>(new Map());
  // Prevents overlapping poll round-trips.
  const pollInFlightRef = useRef(false);

  useEffect(() => {
    epochRef.current += 1;
  }, [mode]);

  const publishRealSnapshots = useCallback((snaps: MarketSnapshot[]) => {
    if (snaps.length === 0) return;
    // Register addresses regardless (cheap, idempotent) so a later switch to
    // Play knows which books to fetch, even when the values are unchanged.
    for (const s of snaps) addressesRef.current.add(s.marketAddress);
    setEntries((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of snaps) {
        const k = key("real", s.marketAddress);
        const cur = next[k];
        if (cur?.state === "ready" && sameSnapshot(cur.snapshot, s)) continue;
        next[k] = { state: "ready", snapshot: s };
        changed = true;
      }
      // Returning prev unchanged is what stops the render loop.
      return changed ? next : prev;
    });
  }, []);

  const invalidate = useCallback((m: TradingMode, addr: string) => {
    setEntries((prev) => {
      if (!prev[key(m, addr)]) return prev;
      const next = { ...prev };
      delete next[key(m, addr)];
      return next;
    });
  }, []);

  /** Applies a batch of freshly fetched Play snapshots idempotently. */
  const applyPlaySnapshots = useCallback(
    (
      addrs: string[],
      snaps: Record<string, PlayMarketSnapshotView>,
      opts?: { markUnavailable?: boolean }
    ) => {
      setEntries((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const a of addrs) {
          const k = key("play", a);
          const s = snaps[a];
          if (s) {
            const snap = buildPlaySnapshot(a, s);
            const cur = next[k];
            if (cur?.state === "ready" && sameSnapshot(cur.snapshot, snap)) {
              continue; // no change — keep the same object (no re-render)
            }
            next[k] = { state: "ready", snapshot: snap };
            changed = true;
          } else if (opts?.markUnavailable && next[k]?.state !== "ready") {
            // Only the initial load marks a missing market unavailable; the
            // poll leaves any prior value untouched (never clobbers to empty).
            if (next[k]?.state !== "unavailable") {
              next[k] = { state: "unavailable" };
              changed = true;
            }
          }
        }
        return changed ? next : prev;
      });
    },
    []
  );

  /** Loads Play snapshots for any known address missing one (first paint). */
  const loadPlay = useCallback(
    async (addrs: string[]) => {
      const wanted = addrs.filter((a) => !inFlightRef.current.has(a));
      if (wanted.length === 0) return;

      const epoch = epochRef.current;
      wanted.forEach((a) => inFlightRef.current.add(a));

      setEntries((prev) => {
        const next = { ...prev };
        for (const a of wanted) {
          if (!next[key("play", a)]) next[key("play", a)] = { state: "loading" };
        }
        return next;
      });

      try {
        const snaps = await playClient.marketSnapshots(wanted);
        if (epoch !== epochRef.current) return; // mode changed — discard
        applyPlaySnapshots(wanted, snaps, { markUnavailable: true });
      } catch {
        if (epoch !== epochRef.current) return;
        setEntries((prev) => {
          const next = { ...prev };
          for (const a of wanted) {
            if (next[key("play", a)]?.state !== "ready") {
              next[key("play", a)] = { state: "unavailable" };
            }
          }
          return next;
        });
      } finally {
        wanted.forEach((a) => inFlightRef.current.delete(a));
      }
    },
    [applyPlaySnapshots]
  );

  /**
   * Refetches the authoritative Play book for the watched markets and applies
   * it idempotently. Epoch-guarded (a mode switch mid-flight drops it) and
   * single-flighted (overlapping ticks are skipped). Errors are swallowed —
   * the next tick simply tries again.
   */
  const pollWatchedPlay = useCallback(async () => {
    if (pollInFlightRef.current) return;
    const addrs = Array.from(watchersRef.current.keys());
    if (addrs.length === 0) return;

    const epoch = epochRef.current;
    pollInFlightRef.current = true;
    try {
      const snaps = await playClient.marketSnapshots(addrs);
      if (epoch !== epochRef.current) return; // switched away — drop
      applyPlaySnapshots(addrs, snaps); // poll never clobbers to unavailable
    } catch {
      /* keep prior values; retry next tick */
    } finally {
      pollInFlightRef.current = false;
    }
  }, [applyPlaySnapshots]);

  const watchPlayMarket = useCallback((addr: string) => {
    if (!addr) return () => {};
    const m = watchersRef.current;
    m.set(addr, (m.get(addr) ?? 0) + 1);
    return () => {
      const cur = m.get(addr) ?? 1;
      if (cur <= 1) m.delete(addr);
      else m.set(addr, cur - 1);
    };
  }, []);

  // Whenever Play is active, make sure every known market has a Play snapshot.
  useEffect(() => {
    if (mode !== "play") return;
    // Array.from (not spread) — tsconfig targets ES5 without downlevelIteration.
    const missing = Array.from(addressesRef.current).filter(
      (a) => !entries[key("play", a)]
    );
    if (missing.length > 0) void loadPlay(missing);
  }, [mode, entries, loadPlay]);

  // Cross-client Play sync: one interval for all watched markets, only while
  // in Play mode and the tab is visible. Pauses when hidden; refetches
  // immediately on focus / visibility restore; fully torn down on unmount or
  // when leaving Play. No polling in Real mode.
  useEffect(() => {
    if (mode !== "play") return;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (!timer) timer = setInterval(() => void pollWatchedPlay(), PLAY_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void pollWatchedPlay(); // catch up immediately
        start();
      } else {
        stop();
      }
    };
    const onFocus = () => void pollWatchedPlay();

    if (document.visibilityState === "visible") {
      void pollWatchedPlay();
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [mode, pollWatchedPlay]);

  const getEntry = useCallback(
    (addr: string) => entries[key(mode, addr)],
    [entries, mode]
  );

  const value = useMemo<Ctx>(
    () => ({
      publishRealSnapshots,
      invalidate,
      watchPlayMarket,
      getEntry,
      mode,
    }),
    [publishRealSnapshots, invalidate, watchPlayMarket, getEntry, mode]
  );

  return (
    <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>
  );
}

function useSnapshotStore(): Ctx | null {
  return useContext(SnapshotContext);
}

/**
 * The snapshot for one market in the CURRENT mode.
 *
 * `realFallback` is the Real data the feed already has in hand. It is used
 * ONLY when the active mode is Real — Play never borrows it, which is the
 * whole point of this phase.
 */
export function useMarketSnapshot(
  marketAddress: string,
  realFallback?: MarketSnapshot
): { snapshot: MarketSnapshot | null; loading: boolean; mode: TradingMode } {
  const store = useSnapshotStore();

  // Rendered outside the provider (or during SSR): behave exactly as before.
  if (!store) {
    return {
      snapshot: realFallback ?? null,
      loading: false,
      mode: "real",
    };
  }

  const entry = store.getEntry(marketAddress);

  if (store.mode === "real") {
    return {
      snapshot:
        entry?.state === "ready" ? entry.snapshot : realFallback ?? null,
      loading: false,
      mode: "real",
    };
  }

  return {
    snapshot: entry?.state === "ready" ? entry.snapshot : null,
    loading: !entry || entry.state === "loading",
    mode: "play",
  };
}

/** Publish/invalidate/watch helpers for pages and trade sheets. */
export function useMarketSnapshotActions() {
  const store = useSnapshotStore();
  const noop = useCallback(() => {}, []);
  const noopWatch = useCallback(() => () => {}, []);
  return {
    publishRealSnapshots: store?.publishRealSnapshots ?? noop,
    invalidate: store?.invalidate ?? noop,
    watchPlayMarket: store?.watchPlayMarket ?? noopWatch,
  };
}
