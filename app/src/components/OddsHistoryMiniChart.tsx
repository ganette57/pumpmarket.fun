"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import OddsHistoryChart, { OddsPoint } from "@/components/OddsHistoryChart";

type TxRow = {
  created_at: string;
  is_buy?: boolean | null;
  is_yes?: boolean | null;
  shares?: number | null;
  amount?: number | null; // fallback
  outcome_index?: number | null;
  market_id?: string | null;
  market_address?: string | null;
};

function toNum(v: any, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export default function OddsHistoryMiniChart({
  marketId,
  marketAddress,
  outcomeNames,
  outcomeSupplies,
  hours = 24,
  height = 220,
}: {
  marketId?: string;        // uuid supabase
  marketAddress?: string;   // text market_address (solana)
  outcomeNames: string[];
  outcomeSupplies: number[];
  hours?: number;
  height?: number;
}) {
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!marketId && !marketAddress) {
        setTxs([]);
        return;
      }

      setLoading(true);
      try {
        const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

        let q = supabase
          .from("transactions")
          .select("created_at,is_buy,is_yes,shares,amount,outcome_index,market_id,market_address")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(500);

        // ✅ match market_id OR market_address
        if (marketId && marketAddress) {
          q = q.or(`market_id.eq.${marketId},market_address.eq.${marketAddress}`);
        } else if (marketId) {
          q = q.eq("market_id", marketId);
        } else if (marketAddress) {
          q = q.eq("market_address", marketAddress);
        }

        const { data, error } = await q;
        if (error) throw error;

        if (!cancelled) setTxs((data as TxRow[]) || []);
      } catch {
        if (!cancelled) setTxs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [marketId, marketAddress, hours]);

  const points: OddsPoint[] = useMemo(() => {
    const names = (outcomeNames || []).filter(Boolean);
    const n = Math.max(2, names.length || 2);

    const current = Array.from({ length: n }, (_, i) => Math.max(0, toNum(outcomeSupplies?.[i], 0)));

    if (!txs.length) return [];

    // delta sums in window (to back-calc start supplies)
    const delta = Array(n).fill(0);
    for (const t of txs) {
      const isBuy = !!t.is_buy;
      const qty = Math.max(0, toNum(t.shares ?? t.amount, 0));
      let idx = Number.isFinite(toNum(t.outcome_index, NaN))
        ? Math.floor(toNum(t.outcome_index, 0))
        : (t.is_yes ? 0 : 1);
      if (!Number.isFinite(idx) || idx < 0 || idx >= n) idx = 0;
      delta[idx] += isBuy ? qty : -qty;
    }

    const start = current.map((c, i) => Math.max(0, c - delta[i]));
    const supplies = [...start];

    const mkPct = () => {
      const total = supplies.reduce((s, x) => s + (x || 0), 0);
      return Array.from({ length: n }, (_, i) => (total > 0 ? (supplies[i] / total) * 100 : 100 / n));
    };

    const out: OddsPoint[] = [];

    // first point at first tx time (pre first tx)
    const t0 = new Date(txs[0].created_at).getTime();
    out.push({ t: t0, pct: mkPct() });

    // apply txs and push points
    for (const t of txs) {
      const isBuy = !!t.is_buy;
      const qty = Math.max(0, toNum(t.shares ?? t.amount, 0));
      let idx = Number.isFinite(toNum(t.outcome_index, NaN))
        ? Math.floor(toNum(t.outcome_index, 0))
        : (t.is_yes ? 0 : 1);
      if (!Number.isFinite(idx) || idx < 0 || idx >= n) idx = 0;

      supplies[idx] = Math.max(0, supplies[idx] + (isBuy ? qty : -qty));

      const ts = new Date(t.created_at).getTime();
      out.push({ t: ts, pct: mkPct() });
    }

    return out;
  }, [txs, outcomeNames, outcomeSupplies]);

  return (
    <div className="w-full">
      {loading ? (
        <div className="h-[180px] flex items-center justify-center text-xs text-gray-500">
          Loading…
        </div>
      ) : points.length < 2 ? (
        <div className="h-[180px] flex items-center justify-center text-xs text-gray-500">
          Not enough trades yet
        </div>
      ) : (
        <OddsHistoryChart points={points} outcomeNames={outcomeNames} height={height} />
      )}
    </div>
  );
}