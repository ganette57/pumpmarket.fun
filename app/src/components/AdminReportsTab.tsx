"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";

type Report = {
  id: string;
  created_at: string;
  market_address: string;
  reporter_address: string | null;
  reason: string;
  details: string | null;
  status: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  market_question: string;
  market_is_blocked: boolean;
};

type ReportCounts = {
  pending: number;
  total: number;
};

function formatDate(x?: string | null) {
  if (!x) return "—";
  const d = new Date(x);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortAddr(a?: string | null) {
  if (!a) return "Anonymous";
  if (a.length <= 12) return a;
  return `${a.slice(0, 4)}...${a.slice(-4)}`;
}

function ReasonBadge({ reason }: { reason: string }) {
  const colors: Record<string, string> = {
    spam: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    inappropriate: "bg-red-500/20 text-red-400 border-red-500/30",
    scam: "bg-red-600/20 text-red-300 border-red-600/30",
    misleading: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    duplicate: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    other: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  };

  const cls = colors[reason] || colors.other;

  return (
    <span className={`px-2 py-0.5 rounded-full border text-xs font-medium capitalize ${cls}`}>
      {reason}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "pending") {
    return (
      <span className="px-2 py-0.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-xs font-medium">
        Pending
      </span>
    );
  }
  if (status === "reviewed") {
    return (
      <span className="px-2 py-0.5 rounded-full border border-pump-green/30 bg-pump-green/10 text-pump-green text-xs font-medium">
        Reviewed
      </span>
    );
  }
  if (status === "dismissed") {
    return (
      <span className="px-2 py-0.5 rounded-full border border-gray-500/30 bg-gray-500/10 text-gray-400 text-xs font-medium">
        Dismissed
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300 text-xs font-medium">
      {status}
    </span>
  );
}

type Props = {
  onBlockMarket?: (marketAddress: string) => void;
};

export default function AdminReportsTab({ onBlockMarket }: Props) {
  const { publicKey } = useWallet();
  
  const [reports, setReports] = useState<Report[]>([]);
  const [counts, setCounts] = useState<ReportCounts>({ pending: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"pending" | "reviewed" | "dismissed" | "all">("pending");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function loadReports() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports?status=${statusFilter}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load reports");
      setReports(data.reports || []);
      setCounts(data.counts || { pending: 0, total: 0 });
    } catch (e: any) {
      setError(e?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports();
  }, [statusFilter]);

  async function handleAction(reportId: string, action: "reviewed" | "dismissed") {
    setActionLoading(reportId);
    try {
      const res = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: reportId,
          action,
          admin_wallet: publicKey?.toBase58(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update report");
      
      // Refresh
      await loadReports();
    } catch (e: any) {
      alert(e?.message || "Failed to update report");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div>
      {/* Header with counts */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-bold text-white">Reports</h3>
          {counts.pending > 0 && (
            <span className="px-2 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-semibold">
              {counts.pending} pending
            </span>
          )}
        </div>
        <button
          onClick={loadReports}
          className="text-sm text-gray-400 hover:text-white transition"
        >
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        {(["pending", "reviewed", "dismissed", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === s
                ? s === "pending"
                  ? "bg-yellow-500/20 text-yellow-400"
                  : "bg-white/10 text-white"
                : "bg-white/5 text-gray-400 hover:text-white"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-gray-500 py-8 text-center">Loading reports...</div>
      ) : error ? (
        <div className="text-red-400 py-8 text-center">{error}</div>
      ) : reports.length === 0 ? (
        <div className="text-gray-500 py-8 text-center">
          No {statusFilter === "all" ? "" : statusFilter} reports.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div
              key={r.id}
              className={`card-pump p-4 ${
                r.status === "pending" ? "border-yellow-500/30" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {/* Market info */}
                  <div className="flex items-center gap-2 mb-2">
                    <Link
                      href={`/trade/${r.market_address}`}
                      target="_blank"
                      className="text-white font-medium hover:text-pump-green transition truncate"
                    >
                      {r.market_question}
                    </Link>
                    {r.market_is_blocked && (
                      <span className="px-2 py-0.5 rounded-full bg-red-600/20 text-red-400 border border-red-600/30 text-xs">
                        Blocked
                      </span>
                    )}
                  </div>

                  {/* Report details */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 mb-2">
                    <ReasonBadge reason={r.reason} />
                    <StatusBadge status={r.status} />
                    <span>•</span>
                    <span>{formatDate(r.created_at)}</span>
                    <span>•</span>
                    <span>by {shortAddr(r.reporter_address)}</span>
                  </div>

                  {/* Details if any */}
                  {r.details && (
                    <div className="text-sm text-gray-300 bg-black/20 rounded-lg p-2 mt-2">
                      "{r.details}"
                    </div>
                  )}

                  {/* Reviewed info */}
                  {r.status !== "pending" && r.reviewed_at && (
                    <div className="text-xs text-gray-500 mt-2">
                      {r.status === "reviewed" ? "Reviewed" : "Dismissed"} on {formatDate(r.reviewed_at)}
                      {r.reviewed_by && ` by ${shortAddr(r.reviewed_by)}`}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 shrink-0">
                  {r.status === "pending" && (
                    <>
                      <button
                        onClick={() => handleAction(r.id, "reviewed")}
                        disabled={actionLoading === r.id}
                        className="px-3 py-1.5 rounded-lg bg-pump-green text-black text-xs font-semibold hover:opacity-90 transition disabled:opacity-50"
                      >
                        {actionLoading === r.id ? "..." : "✓ Reviewed"}
                      </button>
                      <button
                        onClick={() => handleAction(r.id, "dismissed")}
                        disabled={actionLoading === r.id}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                      {!r.market_is_blocked && onBlockMarket && (
                        <button
                          onClick={() => onBlockMarket(r.market_address)}
                          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition"
                        >
                          Block Market
                        </button>
                      )}
                    </>
                  )}
                  <Link
                    href={`/trade/${r.market_address}`}
                    target="_blank"
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition text-center"
                  >
                    View
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}