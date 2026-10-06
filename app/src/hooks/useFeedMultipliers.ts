"use client";
import { useEffect, useState } from "react";

type Mode = "play" | "real";
type Delivery = (values: (number | null)[]) => void;
const pending: Record<Mode, Map<string, Delivery[]>> = { play: new Map(), real: new Map() };
let timer: ReturnType<typeof setTimeout> | undefined;

function enqueue(mode: Mode, address: string, deliver: Delivery) {
  const queue = pending[mode];
  queue.set(address, [...(queue.get(address) ?? []), deliver]);
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    for (const mode of ["play", "real"] as const) {
      const entries = Array.from(pending[mode]);
      pending[mode].clear();
      for (let i = 0; i < entries.length; i += 100) {
        const batch = entries.slice(i, i + 100);
        void fetch("/api/feed/returns", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, addresses: batch.map(([address]) => address) }),
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
  const key = `${mode}:${address}:${revision}:${closed}`;
  const [result, setResult] = useState<{ key: string; values: (number | null)[] } | null>(null);
  useEffect(() => {
    if (closed || !window.matchMedia("(max-width: 767px)").matches) return;
    let cancelled = false;
    enqueue(mode, address, values => {
      if (!cancelled) setResult({ key, values });
    });
    return () => { cancelled = true; };
  }, [address, mode, key, closed]);
  return result?.key === key ? result.values : [];
}

export function formatFeedMultiplier(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1e21) return null;
  const rounded = Number(value.toFixed(2));
  return rounded > 0 ? `${rounded}x` : null;
}
