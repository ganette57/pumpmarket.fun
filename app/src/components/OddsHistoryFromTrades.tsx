"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import OddsHistoryChart, { OddsPoint } from "@/components/OddsHistoryChart";

type TxRow = {
  created_at: string;
  is_buy?: boolean | null;

  // legacy binary
  is_yes?: boolean | null;

  // multi
  outcome_index?: number | null;
  outcome_name?: string | null;

  // IMPORTANT: prefer shares
  shares?: number | null;

  // fallback (sometimes cost/SOL etc)
  amount?: number | null;

  market_id?: string | null;
  market_address?: string | null;
};

function toNum(v: any, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

export default function OddsHistoryFromTrades({
  marketId,
  marketAddress,
  outcomeNames,
  outcomesCount,
  outcomeSupplies, // baseline fallback (SUPER useful on homepage)
  hours = 24,
  height = 170,
}: {
  marketId?: string;
  marketAddress?: string;
  outcomeNames: string[];
  outcomesCount?: number;
  outcomeSupplies?: number[];
  hours?: number;
  height?: number;
}) {
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // If we have neither id nor address => nothing
      if (!marketId && !marketAddress) {
        setTxs([]);
        return;
      }

      setLoading(true);
      try {
        const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

        let q = supabase
          .from("transactions")
          .select(
            "created_at,is_buy,is_yes,outcome_index,outcome_name,shares,amount,market_id,market_address"
          )
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(400);

        // Match by uuid OR address (depending on what you stored)
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
    const n = Math.max(2, Math.min(10, Math.floor(outcomesCount || names.length || 2)));

    // Ensure we have n labels
    const finalNames =
      names.length >= n ? names.slice(0, n) : [...names, ...Array(n - names.length).fill("Option")].slice(0, n);

    // Baseline supplies from props (homepage)
    const baseSupplies = Array.from({ length: n }, (_, i) => toNum(outcomeSupplies?.[i], 0));

    // Start cumulative supplies from baseline (important if you already store current supplies)
    const supplies = [...baseSupplies];

    const out: OddsPoint[] = [];

    for (const row of txs) {
      const isBuy = !!row.is_buy;

      // ✅ prefer shares (because amount might be SOL/cost)
      const raw = row.shares ?? row.amount ?? 0;
      const delta = Math.max(0, toNum(raw, 0));

      // Determine outcome index
      let idx: number | null = null;

      if (Number.isFinite(toNum(row.outcome_index, NaN))) {
        idx = Math.floor(toNum(row.outcome_index, 0));
      } else if (row.outcome_name) {
        const found = finalNames.findIndex(
          (x) => String(x).toLowerCase() === String(row.outcome_name).toLowerCase()
        );
        if (found >= 0) idx = found;
      } else if (row.is_yes != null) {
        idx = row.is_yes ? 0 : 1;
      }

      if (idx == null || !Number.isFinite(idx)) idx = 0;
      idx = clamp(idx, 0, n - 1);

      supplies[idx] = Math.max(0, supplies[idx] + (isBuy ? delta : -delta));

      const total = supplies.reduce((s, x) => s + (x || 0), 0);
      const pct = total > 0 ? supplies.map((s) => (s / total) * 100) : supplies.map(() => 100 / n);

      const t = new Date(row.created_at).getTime();
      out.push({ t, pct });
    }

    // If we still don't have enough points, create a 2-point baseline so the chart renders
    if (out.length < 2) {
      const total = baseSupplies.reduce((s, x) => s + (x || 0), 0);
      const pct = total > 0 ? baseSupplies.map((s) => (s / total) * 100) : baseSupplies.map(() => 100 / n);
      const now = Date.now();
      return [
        { t: now - 60 * 1000, pct },
        { t: now, pct },
      ];
    }

    return out;
  }, [txs, outcomeNames, outcomesCount, outcomeSupplies]);

  const safeNames = useMemo(() => (outcomeNames || []).filter(Boolean).slice(0, 10), [outcomeNames]);

  return (
    <div className="w-full">
      {loading ? (
        <div className="h-[170px] flex items-center justify-center text-xs text-gray-500">
          Loading…
        </div>
      ) : (
        <OddsHistoryChart points={points} outcomeNames={safeNames.length ? safeNames : ["YES", "NO"]} height={height} />
      )}
    </div>
  );
}