"use client";

import { useEffect, useState } from "react";
import { playClient, type PlayCurrentPositionPayoutView } from "@/lib/playClient";

/** Same public authoritative profile as Profile; viewing holdings requires no signature/session. */
export function usePlayPositionPayouts(input: {
  enabled: boolean; market: string; wallet: string | null; identity: string | null;
  revision: string | number | null | undefined; balance: string | null;
}) {
  const { enabled, market, wallet, identity, revision, balance } = input;
  const key = JSON.stringify([enabled, market, wallet, identity, revision, balance]);
  const [state, setState] = useState<{ key: string; positions: PlayCurrentPositionPayoutView[] } | null>(null);
  useEffect(() => {
    if (!enabled || !market || (!wallet && !identity)) return;
    let cancelled = false;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const positions = wallet
          ? (await playClient.profile(wallet)).positions.filter(p => p.status === "open" && p.market_address === market)
          : await playClient.currentPositionPayouts(market);
        if (!cancelled && current === request) setState({ key, positions });
      } catch {
        if (!cancelled && current === request) setState(null);
      }
    };
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    void refresh();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [key, enabled, market, wallet, identity, revision, balance]);
  return state?.key === key ? state.positions : [];
}
