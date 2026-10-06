"use client";
import { useEffect, useState } from "react";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";

type Mode = "play" | "real";
type Delivery = (values: (number | null)[]) => void;
const pending = new Map<string, { mode: Mode; wallet: string | null; queue: Map<string, Delivery[]> }>();
let timer: ReturnType<typeof setTimeout> | undefined;

function enqueue(mode: Mode, identity: string, wallet: string | null, address: string, deliver: Delivery) {
  const groupKey = `${mode}:${identity}`;
  if (!pending.has(groupKey)) pending.set(groupKey, { mode, wallet, queue: new Map() });
  const { queue } = pending.get(groupKey)!;
  queue.set(address, [...(queue.get(address) ?? []), deliver]);
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    const groups = Array.from(pending.values());
    pending.clear();
    for (const { mode, wallet, queue } of groups) {
      const entries = Array.from(queue);
      for (let i = 0; i < entries.length; i += 100) {
        const batch = entries.slice(i, i + 100);
        void fetch("/api/feed/returns", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, wallet, addresses: batch.map(([address]) => address) }),
        }).then(r => r.ok ? r.json() : null).catch(() => null).then(data => {
          for (const [address, callbacks] of batch) {
            const values = data?.multiples?.[address];
            callbacks.forEach(callback => callback(Array.isArray(values) ? values : []));
          }
        });
      }
    }
  }, 40);
}

export function useFeedMultipliers(address: string, mode: Mode, revision: string, closed: boolean) {
  const play = usePlaySession();
  const wallet = useFunMarketWallet();
  const realWallet = wallet.connected ? wallet.publicKey?.toBase58() ?? null : null;
  const identity = mode === "play" ? play.quoteIdentity : realWallet;
  const [positionRevision, setPositionRevision] = useState(0);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.mode === mode && detail?.marketAddress === address) {
        setPositionRevision(value => value + 1);
      }
    };
    window.addEventListener("market-position-invalidated", refresh);
    return () => window.removeEventListener("market-position-invalidated", refresh);
  }, [address, mode]);
  const balance = mode === "play" ? play.balanceUsd : "";
  const key = `${mode}:${identity}:${address}:${revision}:${closed}:${balance}:${positionRevision}`;
  const [result, setResult] = useState<{ key: string; values: (number | null)[] } | null>(null);
  useEffect(() => {
    if (!identity || closed || !window.matchMedia("(max-width: 767px)").matches) return;
    let cancelled = false;
    enqueue(mode, identity, mode === "real" ? realWallet : null, address, values => {
      if (!cancelled) setResult({ key, values });
    });
    return () => { cancelled = true; };
  }, [address, mode, identity, realWallet, key, closed]);
  return result?.key === key ? result.values : [];
}

export function formatFeedMultiplier(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1e21) return null;
  const rounded = Number(value.toFixed(2));
  return rounded > 0 ? `${rounded}x` : null;
}
