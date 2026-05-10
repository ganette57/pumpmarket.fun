"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchUserActivityRows, type ActivityRow } from "@/lib/activity";
import { solanaExplorerTxUrl } from "@/utils/explorer";

function shortSig(sig?: string) {
  if (!sig) return "";
  return sig.length > 14 ? `${sig.slice(0, 6)}…${sig.slice(-6)}` : sig;
}

function shortAddr(a?: string) {
  if (!a) return "";
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

interface ActivityListProps {
  wallet: string;
  /** Optional cap. Defaults to 80 (same as dashboard). */
  limit?: number;
}

export default function ActivityList({ wallet, limit = 80 }: ActivityListProps) {
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    fetchUserActivityRows(wallet, limit)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Failed to load activity.");
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, limit]);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }

  if (rows === null) {
    return <p className="text-gray-400 text-sm">Loading transactions…</p>;
  }

  if (rows.length === 0) {
    return <p className="text-gray-500 text-sm">No activity yet.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div
          key={r.id}
          className="rounded-xl border border-white/10 bg-pump-dark/40 p-3 md:p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-white font-medium text-sm">{r.title}</div>
              <div className="text-xs text-gray-400 mt-1 truncate">
                {r.marketQuestion || shortAddr(r.marketAddress)}
              </div>
              <div className="text-[10px] text-gray-500 mt-1 flex flex-wrap items-center gap-1 md:gap-2">
                <span>{r.createdAt ? r.createdAt.toLocaleString("fr-FR") : ""}</span>
                {r.sig && (
                  <>
                    <span className="opacity-40">•</span>
                    <a
                      href={solanaExplorerTxUrl(r.sig)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-pump-green hover:underline"
                    >
                      tx: {shortSig(r.sig)}
                    </a>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between sm:justify-end gap-3">
              <div className="text-pump-green font-bold text-sm">
                {r.costSol > 0 ? `${r.costSol.toFixed(4)} SOL` : "0.0000 SOL"}
              </div>
              {r.marketAddress && (
                <Link
                  href={`/trade/${r.marketAddress}`}
                  className="px-3 py-1.5 rounded-lg bg-pump-green text-black text-xs font-semibold hover:opacity-90 transition"
                >
                  View
                </Link>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
