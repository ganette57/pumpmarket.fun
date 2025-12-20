// app/src/components/MarketActivity.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { outcomeLabelFromMarket } from "@/utils/outcomes";

type TxRow = {
  id: string;
  created_at: string;
  user_address: string | null;
  tx_signature: string | null;

  is_buy: boolean | null;
  is_yes: boolean | null;

  amount: number | null; // legacy
  shares: number | null; // preferred
  cost: number | null; // optional

  outcome_index: number | null;
  outcome_name: string | null;
};

function toNum(v: any, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function shortAddr(a?: string | null) {
  if (!a) return "—";
  if (a.length <= 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function relTime(iso: string) {
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function MarketActivityTab({
  marketDbId,
  marketAddress,
  outcomeNames,
  limit = 200,
}: {
  marketDbId?: string;
  marketAddress?: string;
  outcomeNames?: string[]; // ✅ from TradePage
  limit?: number;
}) {
  const [loading, setLoading] = useState(false);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");

  const marketLike = useMemo(
    () => ({ outcome_names: outcomeNames ?? null }),
    [outcomeNames]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!marketDbId && !marketAddress) {
        setTxs([]);
        return;
      }

      setLoading(true);
      try {
        let q = supabase
          .from("transactions")
          .select(
            "id,created_at,user_address,tx_signature,is_buy,is_yes,amount,shares,cost,outcome_index,outcome_name"
          )
          .order("created_at", { ascending: false })
          .limit(limit);

        if (marketDbId) q = q.eq("market_id", marketDbId);
        else q = q.eq("market_address", marketAddress as string);

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
  }, [marketDbId, marketAddress, limit]);

  const rows = useMemo(() => {
    if (filter === "all") return txs;
    if (filter === "buy") return txs.filter((t) => !!t.is_buy);
    return txs.filter((t) => !t.is_buy);
  }, [txs, filter]);

  return (
    <div className="bg-pump-gray border border-gray-800 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-lg font-bold text-white">Activity</div>
          <div className="text-sm text-gray-400">
            All transactions for this market
          </div>
        </div>

        <div className="flex gap-2">
          {(["all", "buy", "sell"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                filter === k
                  ? "bg-pump-green/15 border-pump-green text-pump-green"
                  : "bg-black/20 border-gray-700 text-gray-300 hover:border-gray-500"
              }`}
            >
              {k === "all" ? "All" : k === "buy" ? "Buys" : "Sells"}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-800 overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-gray-400">No activity yet.</div>
        ) : (
          <div className="divide-y divide-gray-800">
            {rows.map((t) => {
              const isBuy = !!t.is_buy;

              const outcome = outcomeLabelFromMarket(marketLike, {
                outcomeIndex:
                  t.outcome_index === null ? undefined : t.outcome_index,
                isYes: t.is_yes,
                txOutcomeName: t.outcome_name,
              });

              const shares = toNum(t.shares ?? t.amount, 0);
              const cost = toNum(t.cost, 0);

              return (
                <div
                  key={t.id}
                  className="p-4 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`px-2 py-1 rounded-md text-xs font-semibold border ${
                        isBuy
                          ? "bg-pump-green/10 border-pump-green/30 text-pump-green"
                          : "bg-red-500/10 border-red-500/30 text-red-400"
                      }`}
                    >
                      {isBuy ? "BUY" : "SELL"}
                    </span>

                    <div className="flex flex-col text-sm text-gray-200 truncate">
                      <span>
                        <span className="text-gray-400">Outcome:</span>{" "}
                        {outcome}
                      </span>
                      {t.tx_signature && (
                        <a
                          className="text-xs text-pump-green hover:underline"
                          href={`https://explorer.solana.com/tx/${t.tx_signature}?cluster=devnet`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View tx:{" "}
                          {`${t.tx_signature.slice(
                            0,
                            6
                          )}…${t.tx_signature.slice(-4)}`}
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <div className="text-sm text-white tabular-nums">
                        {shares.toLocaleString()} shares
                      </div>
                      <div className="text-xs text-gray-500 tabular-nums">
                        {cost > 0 ? `${cost.toFixed(4)} SOL` : ""}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm text-gray-200">
                        {shortAddr(t.user_address)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {relTime(t.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}