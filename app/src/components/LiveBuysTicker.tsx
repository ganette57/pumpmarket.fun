"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type TxRow = {
  id: string;
  created_at: string;
  is_buy: boolean;
  shares: number | string | null;
  outcome_name: string | null;
  market_address: string | null;
};

type MarketRow = {
  market_address: string;
  question: string | null;
};

type Variant = "default" | "breaking";

export default function LiveBuysTicker({
  variant = "breaking",
  limit = 20,
  refreshMs = 4000,
  className = "",
}: {
  variant?: Variant;
  limit?: number;
  refreshMs?: number;
  className?: string;
}) {
  const [rows, setRows] = useState<(TxRow & { __market_question?: string })[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);

  async function fetchLatest() {
    const { data: txs, error: txErr } = await supabase
      .from("transactions")
      .select("id,created_at,is_buy,shares,outcome_name,market_address")
      .eq("is_buy", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (txErr) {
      console.error("LiveBuysTicker tx fetch error:", txErr);
      setRows([]);
      setLoadedOnce(true);
      return;
    }

    const cleanTxs = (((txs as any[]) || []) as TxRow[]).filter((r) => r.is_buy);

    const addresses = Array.from(
      new Set(cleanTxs.map((r) => r.market_address).filter((x): x is string => !!x))
    );

    const marketMap = new Map<string, string>();

    if (addresses.length) {
      const { data: mkts, error: mErr } = await supabase
        .from("markets")
        .select("market_address,question")
        .in("market_address", addresses);

      if (mErr) {
        console.warn("LiveBuysTicker markets fetch error:", mErr);
      } else {
        (((mkts as any[]) || []) as MarketRow[]).forEach((m) => {
          if (m?.market_address) marketMap.set(m.market_address, m.question || "a market");
        });
      }
    }

    setRows(
      cleanTxs.map((r) => ({
        ...r,
        __market_question: r.market_address
          ? marketMap.get(r.market_address) || "a market"
          : "a market",
      }))
    );

    setLoadedOnce(true);
  }

  useEffect(() => {
    fetchLatest();
    const t = setInterval(fetchLatest, refreshMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshMs, limit]);

  const items = useMemo(() => {
    return rows.map((r) => {
      const marketName = r.__market_question || "a market";
      const outcome = r.outcome_name || "an outcome";
      const shares = Math.max(0, Math.floor(Number(r.shares || 0)));
      return { marketName, outcome, shares };
    });
  }, [rows]);

  const isBreaking = variant === "breaking";

  if (!loadedOnce) return null;

  const content =
    items.length === 0 ? (
      <span className="text-sm text-gray-300">
        No recent buys yet — be the first degen 😈
      </span>
    ) : (
      <>
        {isBreaking && (
          <span
            className="shrink-0 inline-flex items-center px-2 py-1 rounded-md text-[11px] font-extrabold tracking-wide
                       bg-[#ff5c73]/15 text-[#ff5c73] border border-[#ff5c73]/35
                       animate-[pulsePill_0.4s_ease-in-out_infinite]"
          >
            BREAKING
          </span>
        )}

        <div className="w-full overflow-hidden">
          <div className="whitespace-nowrap animate-[ticker_12s_linear_infinite]">
            {items.concat(items).map((it, i) => (
              <span key={i} className="text-sm text-gray-100 mr-10">
                <span className="text-pump-green font-semibold">Just bought</span>{" "}
                {it.shares} shares of "{it.outcome}" • {it.marketName}
              </span>
            ))}
          </div>
        </div>
      </>
    );

  return (
    <div
    className={[
      "fixed left-0 right-0 bottom-0 z-[60] border-t border-white/15 bg-black/85 backdrop-blur",
      className,
    ].join(" ")}
    >
      <div className="max-w-7xl mx-auto px-4 py-2 overflow-hidden flex items-center gap-3">
        {content}
      </div>

      <style jsx>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes pulsePill {
          0% { box-shadow: 0 0 0 0 rgba(255, 92, 115, 0.0); transform: translateY(0); }
          50% { box-shadow: 0 0 18px 2px rgba(255, 92, 115, 0.35); transform: translateY(-0.5px); }
          100% { box-shadow: 0 0 0 0 rgba(255, 92, 115, 0.0); transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}