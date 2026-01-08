"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Overview = {
  kpi: {
    markets_total: number;
    markets_open: number;
    markets_ended: number;
    markets_proposed: number;
    markets_finalized: number;
    markets_cancelled: number;

    volume_sol_total: number;
    tx_count: number;
    unique_traders: number;

    disputes_open: number;
    disputes_total: number;
  };
  recent_proposed: Array<{
    market_address: string;
    question: string | null;
    contest_deadline: string | null;
    contest_count: number | null;
  }>;
};

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card-pump p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
      {hint ? <div className="text-xs text-gray-500 mt-1">{hint}</div> : null}
    </div>
  );
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/overview", { credentials: "include" });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(t || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as Overview;
      setData(j);
    } catch (e: any) {
      setErr(e?.message || "Failed to load overview");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const k = data?.kpi;

  const disputesBadge = useMemo(() => {
    const n = k?.disputes_open ?? 0;
    if (n <= 0) return "No open disputes";
    return `${n} open disputes`;
  }, [k?.disputes_open]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Admin • Overview</h1>
          <div className="text-sm text-gray-400 mt-1">All KPIs + quick access to disputed markets.</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="px-4 py-2 rounded-lg border border-white/10 text-gray-200 hover:bg-white/5 transition"
          >
            Refresh
          </button>
          <Link
            href="/admin"
            className="px-4 py-2 rounded-lg bg-pump-green text-black font-semibold hover:opacity-90 transition"
          >
            Back
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="card-pump p-4 text-gray-400">Loading…</div>
      ) : err ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
          {err}
          <div className="text-xs text-red-200/80 mt-2">
            Tip: if you just logged in, reload /admin/login, then come back here.
          </div>
        </div>
      ) : !data || !k ? (
        <div className="card-pump p-4 text-gray-400">No data.</div>
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label="Markets" value={`${k.markets_total}`} hint={`Open: ${k.markets_open} • Ended: ${k.markets_ended}`} />
            <StatCard label="Volume (SOL)" value={k.volume_sol_total.toFixed(2)} hint="Total volume from DB" />
            <StatCard label="Transactions" value={`${k.tx_count}`} hint={`Unique traders: ${k.unique_traders}`} />

            <StatCard label="Proposed" value={`${k.markets_proposed}`} hint="In contest window" />
            <StatCard label="Finalized" value={`${k.markets_finalized}`} hint="Resolved (final)" />
            <StatCard label="Cancelled" value={`${k.markets_cancelled}`} hint="Refundable" />
          </div>

          {/* Disputes */}
          <div className="mt-6 card-pump p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-white">🚨 Disputes</div>
                <div className="text-sm text-gray-400">{disputesBadge}</div>
              </div>
              <div className="text-xs text-gray-500">Total disputes: {k.disputes_total}</div>
            </div>

            <div className="mt-4 space-y-2">
              {(data.recent_proposed || []).length === 0 ? (
                <div className="text-sm text-gray-500">No proposed markets found.</div>
              ) : (
                data.recent_proposed.map((m) => (
                  <div
                    key={m.market_address}
                    className="rounded-xl border border-white/10 bg-pump-dark/40 p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-white font-semibold truncate">{m.question || "(Market)"}</div>
                      <div className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono">{m.market_address.slice(0, 6)}…{m.market_address.slice(-4)}</span>
                        <span className="opacity-40">•</span>
                        <span>Disputes: {Number(m.contest_count || 0)}</span>
                        {m.contest_deadline ? (
                          <>
                            <span className="opacity-40">•</span>
                            <span>Deadline: {new Date(m.contest_deadline).toLocaleString()}</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link
                        href={`/contest/${m.market_address}`}
                        className={[
                          "px-4 py-2 rounded-lg text-sm font-semibold transition border",
                          Number(m.contest_count || 0) > 0
                            ? "bg-[#ff5c73]/15 border-[#ff5c73]/40 text-[#ff5c73] hover:bg-[#ff5c73]/20"
                            : "bg-black/30 border-white/10 text-gray-300 hover:border-white/20",
                        ].join(" ")}
                      >
                        Open disputes
                      </Link>
                      <Link
                        href={`/trade/${m.market_address}`}
                        className="px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:opacity-90 transition"
                      >
                        Trade
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}