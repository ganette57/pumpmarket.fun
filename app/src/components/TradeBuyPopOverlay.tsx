"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

type TxRow = {
  id: string;
  is_buy: boolean | null;
  cost: number | string | null; // SOL paid
  created_at: string | null;
};

type PopItem = {
  id: string;       // unique per pop instance
  value: string;    // "+0.905 SOL"
  x: number;        // px offset for slight randomness
};

function toNumber(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatSol(v: number): string {
  if (v >= 10) return v.toFixed(2);
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(3);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const ENABLE_BUY_POP_OVERLAY = true;

export default function TradeBuyPopOverlay({
  marketAddress,
  marketId,
}: {
  marketAddress?: string | null;
  marketId?: string | null;
}) {
  const [pops, setPops] = useState<PopItem[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const timeoutsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!ENABLE_BUY_POP_OVERLAY) return;

    const addr = String(marketAddress || "").trim();
    const dbId = String(marketId || "").trim();
    if (!addr && !dbId) return;

    let cancelled = false;
    let intervalId: number | null = null;

    // reset state when market changes
    seenIdsRef.current = new Set();
    seededRef.current = false;
    setPops([]);

    const pushPop = (txId: string, costSol: number) => {
      const popId = `${txId}_${Date.now()}`;
      const value = `+${formatSol(Math.max(0, costSol))} SOL`;
      const x = randInt(-12, 12);

      setPops((prev) => {
        const next = [...prev, { id: popId, value, x }];
        // stack limit 4 (drop oldest)
        return next.length > 4 ? next.slice(next.length - 4) : next;
      });

      const timeoutId = window.setTimeout(() => {
        setPops((prev) => prev.filter((p) => p.id !== popId));
        timeoutsRef.current.delete(timeoutId);
      }, 3000);

      timeoutsRef.current.add(timeoutId);
    };

    const fetchRows = async (byAddress: boolean) => {
      let query = supabase
        .from("transactions")
        .select("id,is_buy,cost,created_at")
        .order("created_at", { ascending: false })
        .limit(15);

      if (byAddress) query = query.eq("market_address", addr);
      else query = query.eq("market_id", dbId);

      return query;
    };

    const poll = async () => {
      if (cancelled) return;

      try {
        // prefer address when available
        const primary = addr ? await fetchRows(true) : await fetchRows(false);

        if (primary.error) {
          console.debug("[buy-pop] poll error:", primary.error.message);
          return;
        }
        if (cancelled) return;

        let rows = (primary.data || []) as TxRow[];

        // fallback to market_id if address query returns nothing
        if (addr && dbId && rows.length === 0) {
          const fallback = await fetchRows(false);
          if (!fallback.error) rows = (fallback.data || []) as TxRow[];
        }

        // seed once to avoid old spam
        if (!seededRef.current) {
          for (const row of rows) {
            if (row?.id) seenIdsRef.current.add(String(row.id));
          }
          seededRef.current = true;
          return;
        }

        // process oldest->newest so pops come in order
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i];
          const txId = String(row?.id || "");
          if (!txId || seenIdsRef.current.has(txId)) continue;

          seenIdsRef.current.add(txId);
          if (row?.is_buy !== true) continue;

          const cost = toNumber(row.cost); // SOL paid
          if (cost > 0) pushPop(txId, cost);
        }
      } catch (e: any) {
        console.debug("[buy-pop] poll exception:", e?.message || e);
      }
    };

    void poll();
    intervalId = window.setInterval(() => void poll(), 2000);

    return () => {
      cancelled = true;
      if (intervalId != null) window.clearInterval(intervalId);
      timeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutsRef.current.clear();
    };
  }, [marketAddress, marketId]);

  if (!ENABLE_BUY_POP_OVERLAY || !pops.length) return null;

  return (
    <>
      <div className="pointer-events-none fixed right-4 bottom-24 md:bottom-20 z-[70] flex flex-col items-end gap-2">
        {pops.map((pop) => (
          <div
            key={pop.id}
            className="px-2 py-1 text-l font-semibold text-green-300"
            style={
              {
                "--buy-pop-x": `${pop.x}px`,
                animation: "buy-pop-float 3s ease-out forwards",
                willChange: "transform, opacity",
              } as CSSProperties
            }
          >
            {pop.value}
          </div>
        ))}
      </div>

      <style jsx>{`
        @keyframes buy-pop-float {
          0% {
            opacity: 0;
            transform: translateX(var(--buy-pop-x)) translateY(14px) scale(1.02);
          }
          12% {
            opacity: 1;
            transform: translateX(var(--buy-pop-x)) translateY(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateX(var(--buy-pop-x)) translateY(-280px) scale(1);
          }
        }
      `}</style>
    </>
  );
}
