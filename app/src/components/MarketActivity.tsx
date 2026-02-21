"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { solanaExplorerTxUrl } from "@/utils/explorer";

type Props = {
  marketDbId?: string;
  marketAddress: string;
  outcomeNames: string[];
};

type TxRow = {
  id?: string;
  created_at: string;
  user_address?: string;
  tx_signature?: string;
  is_buy: boolean;
  amount?: number; // UI shares
  shares?: number; // UI shares
  outcome_index?: number | null;
  outcome_name?: string | null;
  is_yes?: boolean | null;
};

function shortAddr(a?: string) {
  if (!a) return "";
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export default function MarketActivityTab({ marketDbId, marketAddress, outcomeNames }: Props) {
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!marketDbId) {
      setRows([]);
      setLoading(false);
      return;
    }

    let alive = true;

    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("transactions")
          .select("id,created_at,user_address,tx_signature,is_buy,amount,shares,outcome_index,outcome_name,is_yes")
          .eq("market_id", marketDbId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (!alive) return;

        if (error) {
          console.error("activity fetch error:", error);
          setRows([]);
        } else {
          setRows((data as any[]) || []);
        }
      } catch (e) {
        console.error("activity error:", e);
        setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [marketDbId]);

  const mapped = useMemo(() => {
    return rows.map((tx) => {
      const idx = typeof tx.outcome_index === "number" ? tx.outcome_index : null;

      // ✅ Source de vérité: outcome_name stocké
      // ✅ Fallback: outcomeNames[idx] passé depuis TradePage
      const name =
        (tx.outcome_name && String(tx.outcome_name)) ||
        (idx !== null && outcomeNames?.[idx] ? outcomeNames[idx] : idx !== null ? `Outcome #${idx + 1}` : "—");

      const shares = Number(tx.shares ?? tx.amount ?? 0) || 0;

      return {
        ...tx,
        _outcomeLabel: name,
        _shares: shares,
      };
    });
  }, [rows, outcomeNames]);

  if (!marketDbId) {
    return (
      <div className="card-pump">
        <div className="text-sm text-gray-400">Activity not ready yet (market not indexed).</div>
        <div className="text-xs text-gray-600 mt-1">{marketAddress}</div>
      </div>
    );
  }

  return (
    <div className="card-pump">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Market activity</h3>
        <div className="text-xs text-gray-500">{rows.length} tx</div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading activity…</div>
      ) : !mapped.length ? (
        <div className="text-sm text-gray-400">No activity yet.</div>
      ) : (
        <div className="space-y-2">
          {mapped.map((tx, i) => (
            <div key={tx.id || `${tx.created_at}-${i}`} className="rounded-xl border border-gray-800 bg-pump-dark/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">
                  {tx.is_buy ? "Buy" : "Sell"}{" "}
                  <span className="text-gray-400 font-normal">
                    {tx._shares} shares
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(tx.created_at).toLocaleString()}
                </div>
              </div>

              <div className="mt-1 text-sm text-gray-300">
                Outcome: <span className="text-white font-semibold">{tx._outcomeLabel}</span>
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                <div>User: {shortAddr(tx.user_address)}</div>
                {tx.tx_signature ? (
                  <a
                    className="text-pump-green underline"
                    href={solanaExplorerTxUrl(tx.tx_signature)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View tx
                  </a>
                ) : (
                  <span />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
