"use client";

// Desktop right-column Past Markets card. Same persisted source as the mobile
// drawer (`live_sessions.past_market_addresses` resolved via getMarketByAddress).
// Hidden when there is no history. Rows link to /trade/{marketAddress}.

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPastMarketAddresses } from "@/lib/liveSessions";
import { getMarketByAddress } from "@/lib/markets";

type PastRow = {
  pk: string;
  winningIdx: number;
  title: string;
  winningLabel: string;
  status: "resolved" | "proposed";
};

export default function LiveDesktopPastMarkets({
  sessionId,
  refreshKey,
}: {
  /** Live session id — drives the fetch. */
  sessionId: string | null | undefined;
  /** Optional key that changes when the session swaps to a new market, so
   *  the list refreshes after each resolve+auto-start. */
  refreshKey?: string | null;
}) {
  const [rows, setRows] = useState<PastRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const addrs = await fetchPastMarketAddresses(sessionId);
        if (cancelled) return;
        if (!addrs.length) {
          setRows([]);
          return;
        }
        const out = (
          await Promise.all(
            addrs.map(async (addr) => {
              try {
                const m = await getMarketByAddress(addr);
                if (!m) return null;
                const winningIdxRaw =
                  (m as any).winning_outcome != null
                    ? Number((m as any).winning_outcome)
                    : m.proposed_winning_outcome != null
                    ? Number(m.proposed_winning_outcome)
                    : null;
                if (
                  winningIdxRaw == null ||
                  !Number.isFinite(winningIdxRaw)
                ) {
                  return null;
                }
                const resolved =
                  !!m.resolved ||
                  String(m.resolution_status || "").toLowerCase() ===
                    "finalized";
                const status: "resolved" | "proposed" = resolved
                  ? "resolved"
                  : "proposed";
                const namesRaw = (m as any).outcome_names;
                const names: string[] = Array.isArray(namesRaw)
                  ? namesRaw.map((x: unknown) => String(x ?? ""))
                  : [];
                const winningLabel =
                  names[winningIdxRaw] ||
                  (winningIdxRaw === 0 ? "YES" : "NO");
                return {
                  pk: addr,
                  winningIdx: winningIdxRaw,
                  title: String(m.question || "Market"),
                  winningLabel,
                  status,
                };
              } catch {
                return null;
              }
            }),
          )
        ).filter((x): x is PastRow => x != null);
        if (!cancelled) setRows(out);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  // Hide the entire card when there is no history (loaded or otherwise).
  if (!loading && rows.length === 0) return null;

  return (
    <div className="card-pump p-4">
      <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3.5 h-3.5 text-gray-400"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4l3 2" />
        </svg>
        Past Markets
      </h3>

      {loading && rows.length === 0 ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
          {[...rows].reverse().map((r, i) => {
            const isYes = r.winningIdx === 0;
            return (
              <Link
                key={`${r.pk}-${i}`}
                href={`/trade/${encodeURIComponent(r.pk)}`}
                className="flex items-center gap-3 rounded-lg bg-white/[0.03] border border-white/10 px-3 py-2 hover:border-white/20 transition"
              >
                <span
                  className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border border-black/30 ${
                    isYes
                      ? "bg-pump-green shadow-[0_0_6px_rgba(109,255,164,0.55)]"
                      : "bg-[#ff5c73] shadow-[0_0_6px_rgba(255,92,115,0.55)]"
                  }`}
                >
                  <svg
                    viewBox="0 0 10 10"
                    className="w-2 h-2 fill-white"
                    aria-hidden
                  >
                    {isYes ? (
                      <polygon points="5,2 8.5,7.5 1.5,7.5" />
                    ) : (
                      <polygon points="5,8 8.5,2.5 1.5,2.5" />
                    )}
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-white font-semibold truncate">
                    {r.title}
                  </p>
                  <p className="text-[11px] text-gray-400 truncate">
                    <span
                      className={`font-semibold ${
                        isYes ? "text-pump-green" : "text-[#ff5c73]"
                      }`}
                    >
                      {r.winningLabel}
                    </span>
                    <span className="text-gray-500">
                      {" "}
                      · {r.status === "resolved" ? "Final" : "Proposed"}
                    </span>
                  </p>
                </div>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-3.5 h-3.5 text-gray-500 shrink-0"
                  aria-hidden
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
