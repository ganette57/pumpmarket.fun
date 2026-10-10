"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayMarketActivity } from "@/components/play/usePlayMarketActivity";
import {
  collectUnseenLiveTrades,
  enqueueLiveTradeActivity,
  normalizePlayTradeActivity,
  normalizeLiveMarketIdentifier,
} from "@/lib/liveTradeActivity";
import {
  subscribeRecentTrades,
  type LiveTradeActivityToast,
  type RecentTrade,
} from "@/lib/liveSessions";
import type { TradingMode } from "@/lib/tradingMode";

const DISMISS_MS = 4000;

type Options = {
  marketAddress: string | null | undefined;
  mode: TradingMode;
  enabled?: boolean;
  /** Lets existing REAL consumers refresh their activity/snapshot state. */
  onRealTrade?: (trade: RecentTrade) => void;
};

/**
 * One mode-aware queue for the shared LIVE/Trade popup renderer.
 *
 * REAL keeps the existing Supabase + ticker-fallback subscription. PLAY
 * reuses usePlayMarketActivity, which is driven by MarketSnapshotProvider's
 * existing visibility-aware watcher; this hook adds no interval or channel.
 */
export function useTradeActivityPopups({
  marketAddress,
  mode,
  enabled = true,
  onRealTrade,
}: Options): LiveTradeActivityToast[] {
  const address = normalizeLiveMarketIdentifier(marketAddress);
  const [toasts, setToasts] = useState<LiveTradeActivityToast[]>([]);
  const counterRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const playSeenRef = useRef<Set<string> | null>(null);
  const playContextRef = useRef("");
  const activeContextRef = useRef({ address, mode, enabled });
  activeContextRef.current = { address, mode, enabled };
  const onRealTradeRef = useRef(onRealTrade);
  onRealTradeRef.current = onRealTrade;

  const playActivity = usePlayMarketActivity(address, {
    enabled: enabled && mode === "play",
    limit: 30,
  });

  const dismissLater = useCallback((key: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      setToasts((prev) => prev.filter((item) => item._key !== key));
    }, DISMISS_MS);
    timersRef.current.add(timer);
  }, []);

  const enqueue = useCallback(
    (trade: RecentTrade, expectedMode: TradingMode) => {
      const active = activeContextRef.current;
      if (!active.enabled || active.mode !== expectedMode || active.address !== address) {
        return;
      }
      const key = ++counterRef.current;
      setToasts((prev) => {
        const next = enqueueLiveTradeActivity(
          prev,
          trade,
          address,
          key,
          expectedMode,
        );
        return next;
      });
      // Duplicate IDs are rejected by the queue; their eventual dismissal is
      // therefore a no-op and cannot remove the original keyed popup.
      dismissLater(key);
    },
    [address, dismissLater],
  );

  // A market or mode switch is a hard boundary: no popup crosses it.
  useEffect(() => {
    setToasts([]);
    playSeenRef.current = null;
    playContextRef.current = `${mode}:${address}`;
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  }, [address, mode, enabled]);

  useEffect(() => {
    if (!enabled || mode !== "real" || !address) return;
    return subscribeRecentTrades(address, (trade) => {
      onRealTradeRef.current?.(trade);
      enqueue(
        {
          ...trade,
          activity_mode: "real",
          cost_currency: "SOL",
        },
        "real",
      );
    });
  }, [address, mode, enabled, enqueue]);

  useEffect(() => {
    if (!enabled || mode !== "play" || !address || !playActivity.loaded) return;

    const context = `play:${address}`;
    if (playContextRef.current !== context) {
      playContextRef.current = context;
      playSeenRef.current = null;
    }

    const collected = collectUnseenLiveTrades(
      playActivity.rows,
      playSeenRef.current,
    );
    playSeenRef.current = collected.seenIds;

    for (const row of collected.newTrades) {
      enqueue(
        normalizePlayTradeActivity(row, address, playActivity.outcomeNames),
        "play",
      );
    }
  }, [address, mode, enabled, playActivity.loaded, playActivity.rows, playActivity.outcomeNames, enqueue]);

  useEffect(
    () => () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    },
    [],
  );

  return toasts;
}
