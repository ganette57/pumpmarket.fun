"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { lamportsToSol } from "@/utils/solana";

type TxRow = {
  id: string;
  created_at: string;
  user_address: string | null;
  tx_signature: string | null;

  is_buy: boolean | null;
  amount: number | string | null; // shares
  cost: number | string | null; // SOL (your recordTransaction uses cost in SOL)
  outcome_index: number | null;
  outcome_name: string | null;

  // legacy binary
  is_yes: boolean | null;
};

function toNum(v: any, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function shortAddr(a?: string | null, head = 6, tail = 4) {
  if (!a) return "unknown";
  if (a.length <= head + tail) return a;
  return `${a.slice(0, head)}...${a.slice(-tail)}`;
}

export default function MarketActivityTab({
  marketDbId,
  marketAddress,
  limit = 200,
}: {
  marketDbId?: string;
  marketAddress?: string;
  limit?: number;
}) {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setErr(null);

      if (!marketDbId && !marketAddress) {
        setRows([]);
        return;
      }

      setLoading(true);
      try {
        // Prefer UUID market_id, fallback to market_address if you stored it
        let q = supabase
          .from("transactions")
          .select(
            "id,created_at,user_address,tx_signature,is_buy,amount,cost,outcome_index,outcome_name,is_yes"
          )
          .order("created_at", { ascending: false })
          .limit(limit);

        if (marketDbId) q = q.eq("market_id", marketDbId);
        else if (marketAddress) q = q.eq("market_address", marketAddress);

        const { data, error } = await q;
        if (error) throw error;

        if (!cancelled) setRows((data as TxRow[]) || []);
      } catch (e: any) {
        if (!cancelled) {
          setRows([]);
          setErr(e?.message || "Failed to load activity");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [marketDbId, marketAddress, limit]);

  const items = useMemo(() => {
    return (rows || []).map((r) => {
      const shares = Math.max(0, Math.floor(toNum(r.amount, 0)));
      const costSol = Math.abs(toNum(r.cost, 0)); // recorded as SOL
      const price = shares > 0 ? costSol / shares : 0;

      const side = r.is_buy ? "bought" : "sold";
      const outcome =
        r.outcome_name ||
        (Number.isFinite(toNum(r.outcome_index, NaN)) ? `Outcome #${toNum(r.outcome_index)}` : null) ||
        (r.is_yes == null ? "Outcome" : r.is_yes ? "YES" : "NO");

      const when = r.created_at ? new Date(r.created_at) : null;

      return {
        id: r.id,
        when,
        user: r.user_address,
        sig: r.tx_signature,
        side,
        shares,
        outcome,
        price,
        total: costSol,
      };
    });
  }, [rows]);

  return (
    <div className="card-pump">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">Activity</h2>
          <p className="text-sm text-gray-400 mt-1">
            Latest trades on this market
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 bg-pump-dark/40 border border-gray-800 rounded-xl p-4">
          Loading…
        </div>
      ) : err ? (
        <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          {err}
        </div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-400 bg-pump-dark/40 border border-gray-800 rounded-xl p-4">
          No activity yet.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <div className="divide-y divide-gray-800">
            {items.map((it) => (
              <div key={it.id} className="px-4 py-3 bg-pump-dark/20">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-200">
                      <span className="font-semibold">{shortAddr(it.user)}</span>{" "}
                      <span className="text-gray-400">{it.side}</span>{" "}
                      <span className="font-semibold">{it.shares}</span>{" "}
                      <span className="text-gray-400">shares of</span>{" "}
                      <span className="text-white font-semibold">{it.outcome}</span>{" "}
                      <span className="text-gray-400">
                        at{" "}
                        <span className="text-white font-semibold">
                          {it.price.toFixed(4)} SOL
                        </span>{" "}
                        ({it.total.toFixed(4)} SOL)
                      </span>
                    </div>

                    <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      <span>
                        {it.when
                          ? it.when.toLocaleString()
                          : "unknown time"}
                      </span>

                      {it.sig && (
                        <a
                          className="hover:text-pump-green transition"
                          href={`https://explorer.solana.com/tx/${it.sig}?cluster=devnet`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {it.sig.slice(0, 10)}…{it.sig.slice(-6)}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-gray-500 whitespace-nowrap">
                    {/* small visual hint */}
                    <span
                      className={`px-2 py-1 rounded-lg border ${
                        it.side === "bought"
                          ? "border-green-500/20 bg-green-500/10 text-green-300"
                          : "border-red-500/20 bg-red-500/10 text-red-300"
                      }`}
                    >
                      {it.side.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}