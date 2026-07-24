"use client";

// src/components/mode/MarketSnapshotProvider.tsx
//
// Mode-aware market snapshots for the Home Feed.
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
import { playClient } from "@/lib/playClient";
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
  getEntry: (marketAddress: string) => Entry | undefined;
  /** Current mode, so consumers format the right currency. */
  mode: TradingMode;
};

const SnapshotContext = createContext<Ctx | null>(null);

const key = (mode: TradingMode, addr: string) => `${mode}:${addr}`;

export function MarketSnapshotProvider({ children }: { children: ReactNode }) {
  const { mode } = useTradingMode();

  const [entries, setEntries] = useState<Record<string, Entry>>({});
  // Addresses currently visible in the feed, so a mode switch knows what to load.
  const addressesRef = useRef<Set<string>>(new Set());
  // Bumped on every mode change — the stale-response guard.
  const epochRef = useRef(0);
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    epochRef.current += 1;
  }, [mode]);

  const publishRealSnapshots = useCallback((snaps: MarketSnapshot[]) => {
    if (snaps.length === 0) return;
    setEntries((prev) => {
      const next = { ...prev };
      for (const s of snaps) {
        addressesRef.current.add(s.marketAddress);
        next[key("real", s.marketAddress)] = { state: "ready", snapshot: s };
      }
      return next;
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

  /** Loads Play snapshots for any known address missing one. */
  const loadPlay = useCallback(async (addrs: string[]) => {
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
      // Mode changed while this was in flight — discard entirely.
      if (epoch !== epochRef.current) return;

      setEntries((prev) => {
        const next = { ...prev };
        for (const a of wanted) {
          const s = snaps[a];
          next[key("play", a)] = s
            ? {
                state: "ready",
                snapshot: {
                  mode: "play",
                  marketAddress: a,
                  supplies: s.supplies ?? [],
                  probabilities: s.probabilities ?? [],
                  volume: String(s.virtual_pool_usd ?? "0"),
                  status: s.status ?? "open",
                  seeded: !!s.seeded,
                  updatedAt: s.updated_at,
                },
              }
            : // Never fall back to Real numbers.
              { state: "unavailable" };
        }
        return next;
      });
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

  const getEntry = useCallback(
    (addr: string) => entries[key(mode, addr)],
    [entries, mode]
  );

  const value = useMemo<Ctx>(
    () => ({ publishRealSnapshots, invalidate, getEntry, mode }),
    [publishRealSnapshots, invalidate, getEntry, mode]
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

/** Publish/invalidate helpers for pages and trade sheets. */
export function useMarketSnapshotActions() {
  const store = useSnapshotStore();
  const noop = useCallback(() => {}, []);
  return {
    publishRealSnapshots: store?.publishRealSnapshots ?? noop,
    invalidate: store?.invalidate ?? noop,
  };
}
