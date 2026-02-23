"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TxRow = {
  id: string;
  created_at: string;
  is_buy: boolean;
  shares: number | string | null;
  outcome_name: string | null;
  market_address: string | null;
  market_question?: string | null;
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
  const [rows, setRows] = useState<TxRow[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const warnedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let failCount = 0;

    const schedule = (ms: number) => {
      if (cancelled) return;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void poll();
      }, ms);
    };

    const poll = async () => {
      if (cancelled) return;
      if (document.hidden) {
        schedule(refreshMs);
        return;
      }

      try {
        const res = await fetch(`/api/live/ticker?limit=${limit}`, {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => ({}))) as { items?: TxRow[] };
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (cancelled) return;
        setRows(((json.items || []) as TxRow[]).filter((r) => r.is_buy));
        setLoadedOnce(true);
        failCount = 0;
        warnedRef.current = false;
        schedule(refreshMs);
      } catch (e: any) {
        if (!warnedRef.current) {
          console.debug("LiveBuysTicker API fetch failed:", e?.message || e);
          warnedRef.current = true;
        }
        setLoadedOnce(true);
        failCount += 1;
        const backoff = Math.min(30_000, refreshMs * Math.pow(2, failCount));
        schedule(backoff);
      }
    };

    const onVisibility = () => {
      if (!document.hidden) {
        void poll();
      }
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshMs, limit]);

  const items = useMemo(() => {
    return rows.map((r) => {
      const marketName = r.market_question || "a market";
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
