"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Play, Square, X } from "lucide-react";

type CampaignStatus = "running" | "stopped" | "completed";

type Campaign = {
  id: string;
  status: CampaignStatus;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  tokenImageUri: string | null;
  durationMinutes: number;
  launchIntervalMinutes: number;
  totalMarkets: number;
  launchedCount: number;
  startedAt: string;
  stoppedAt: string | null;
  lastError: string | null;
};

type PendingResolution = {
  marketAddress: string;
  marketId: string | null;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  priceStart: number;
  priceEnd: number;
  durationMinutes: number;
  autoResolvedOutcome: "YES" | "NO";
  resolutionStatus: "pending_admin_confirmation" | "proposed";
  resolvedAt: string | null;
};

type NoticeTone = "ok" | "error" | "neutral";
type Notice = { tone: NoticeTone; message: string };

const CAMPAIGNS_PAGE_SIZE = 5;
const PENDING_PAGE_SIZE = 6;

function statusBadge(status: CampaignStatus) {
  const colors: Record<CampaignStatus, string> = {
    running: "bg-pump-green/20 text-pump-green border-pump-green/40",
    stopped: "bg-red-500/20 text-red-300 border-red-500/40",
    completed: "bg-gray-500/20 text-gray-300 border-gray-500/40",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${colors[status]}`}>
      {status.toUpperCase()}
    </span>
  );
}

function formatPrice(price: number): string {
  if (price === 0) return "0";
  if (price < 0.000001) return price.toExponential(4);
  if (price < 0.01) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  return price.toFixed(4);
}

function pctChange(start: number, end: number): string {
  if (start === 0) return "N/A";
  const pct = ((end - start) / start) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

async function adminPost(action: string, extra: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch("/api/admin/flash-crypto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
    credentials: "include",
  });
  return res.json();
}

export default function AdminFlashCryptoPanel() {
  const [tokenMint, setTokenMint] = useState("");
  const [duration, setDuration] = useState<1 | 3 | 5>(5);
  const [totalMarkets, setTotalMarkets] = useState(10);
  const [launchInterval, setLaunchInterval] = useState(5);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [pending, setPending] = useState<PendingResolution[]>([]);
  const [campaignPage, setCampaignPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);

  const refresh = useCallback(async () => {
    try {
      const [campRes, pendRes] = await Promise.all([
        adminPost("list_campaigns"),
        adminPost("list_pending"),
      ]);
      if (campRes.ok) setCampaigns(campRes.campaigns || []);
      if (pendRes.ok) setPending(pendRes.pending || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const campaignsTotalPages = Math.max(1, Math.ceil(campaigns.length / CAMPAIGNS_PAGE_SIZE));
  const paginatedCampaigns = useMemo(() => {
    const start = (campaignPage - 1) * CAMPAIGNS_PAGE_SIZE;
    return campaigns.slice(start, start + CAMPAIGNS_PAGE_SIZE);
  }, [campaignPage, campaigns]);

  const pendingTotalPages = Math.max(1, Math.ceil(pending.length / PENDING_PAGE_SIZE));
  const paginatedPending = useMemo(() => {
    const start = (pendingPage - 1) * PENDING_PAGE_SIZE;
    return pending.slice(start, start + PENDING_PAGE_SIZE);
  }, [pending, pendingPage]);

  useEffect(() => {
    setCampaignPage((prev) => Math.min(prev, campaignsTotalPages));
  }, [campaignsTotalPages]);

  useEffect(() => {
    setPendingPage((prev) => Math.min(prev, pendingTotalPages));
  }, [pendingTotalPages]);

  const handleStart = async () => {
    if (!tokenMint.trim()) {
      setNotice({ tone: "error", message: "Token mint is required." });
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const res = await adminPost("start_campaign", {
        token_mint: tokenMint.trim(),
        duration_minutes: duration,
        total_markets: totalMarkets,
        launch_interval_minutes: launchInterval,
      });
      if (res.ok) {
        setNotice({
          tone: "ok",
          message: `Campaign started: $${res.result?.campaign?.tokenSymbol || "?"} — ${res.result?.campaign?.id}`,
        });
        setTokenMint("");
        await refresh();
      } else {
        setNotice({ tone: "error", message: res.error || "Failed to start campaign." });
      }
    } catch (e: any) {
      setNotice({ tone: "error", message: String(e?.message || e) });
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (campaignId: string) => {
    try {
      const res = await adminPost("stop_campaign", { campaign_id: campaignId });
      if (res.ok) {
        setNotice({ tone: "ok", message: `Campaign ${campaignId} stopped.` });
        await refresh();
      } else {
        setNotice({ tone: "error", message: res.error || "Failed to stop." });
      }
    } catch (e: any) {
      setNotice({ tone: "error", message: String(e?.message || e) });
    }
  };

  return (
    <div className="card-pump space-y-6">
      <h2 className="text-xl font-bold text-white">Flash Crypto Campaign</h2>

      {/* Notice */}
      {notice && (
        <div
          className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
            notice.tone === "ok"
              ? "bg-pump-green/10 text-pump-green border border-pump-green/30"
              : notice.tone === "error"
              ? "bg-red-500/10 text-red-300 border border-red-500/30"
              : "bg-white/5 text-gray-300 border border-white/10"
          }`}
        >
          <span className="flex-1">{notice.message}</span>
          <button onClick={() => setNotice(null)} className="text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* New Campaign Form */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Token Mint Address or pump.fun URL</label>
          <input
            type="text"
            value={tokenMint}
            onChange={(e) => setTokenMint(e.target.value)}
            placeholder="Mint address or https://pump.fun/coin/..."
            className="w-full px-3 py-2 rounded-lg bg-pump-dark border border-white/10 text-white text-sm placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-pump-green"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Duration (min)</label>
            <select
              value={duration}
              onChange={(e) => {
                const v = Number(e.target.value) as 1 | 3 | 5;
                setDuration(v);
                setLaunchInterval(v);
              }}
              className="w-full px-3 py-2 rounded-lg bg-pump-dark border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-pump-green"
            >
              <option value={1} className="bg-pump-dark text-white">1 min</option>
              <option value={3} className="bg-pump-dark text-white">3 min</option>
              <option value={5} className="bg-pump-dark text-white">5 min</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Total Markets</label>
            <input
              type="number"
              min={1}
              max={100}
              value={totalMarkets}
              onChange={(e) => setTotalMarkets(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              className="w-full px-3 py-2 rounded-lg bg-pump-dark border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-pump-green"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Interval (min)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={launchInterval}
              onChange={(e) => setLaunchInterval(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              className="w-full px-3 py-2 rounded-lg bg-pump-dark border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-pump-green"
            />
          </div>
        </div>

        <button
          onClick={handleStart}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-pump-green text-black font-semibold hover:opacity-90 transition disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Start Campaign
        </button>
      </div>

      {/* Active Campaigns */}
      {campaigns.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-300">Campaigns</h3>
            <div className="text-[11px] text-gray-500">
              {campaigns.length} total • page {campaignPage}/{campaignsTotalPages}
            </div>
          </div>
          {paginatedCampaigns.map((c) => (
            <div key={c.id} className="p-3 rounded-lg bg-pump-dark border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {c.tokenImageUri && (
                    <img src={c.tokenImageUri} alt={c.tokenSymbol} className="w-6 h-6 rounded-full" />
                  )}
                  <span className="font-semibold text-white">${c.tokenSymbol}</span>
                  <span className="text-xs text-gray-400">{c.tokenName}</span>
                  {statusBadge(c.status)}
                </div>
                {c.status === "running" && (
                  <button
                    onClick={() => handleStop(c.id)}
                    className="flex items-center gap-1 px-3 py-1 rounded bg-red-500/20 text-red-300 text-xs hover:bg-red-500/30 transition"
                  >
                    <Square className="w-3 h-3" />
                    Stop
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs text-gray-400">
                <div>Duration: <span className="text-white">{c.durationMinutes}m</span></div>
                <div>Markets: <span className="text-white">{c.launchedCount}/{c.totalMarkets}</span></div>
                <div>Interval: <span className="text-white">{c.launchIntervalMinutes}m</span></div>
                <div>Started: <span className="text-white">{new Date(c.startedAt).toLocaleTimeString()}</span></div>
              </div>
              {c.lastError && (
                <div className="text-xs text-red-400 bg-red-500/10 p-2 rounded">{c.lastError}</div>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setCampaignPage((p) => Math.max(1, p - 1))}
              disabled={campaignPage <= 1}
              className="px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-200 text-[11px] hover:bg-white/10 disabled:opacity-50 transition"
            >
              Previous
            </button>
            <div className="text-[11px] text-gray-500">
              Showing {(campaignPage - 1) * CAMPAIGNS_PAGE_SIZE + 1}-{Math.min(campaignPage * CAMPAIGNS_PAGE_SIZE, campaigns.length)}
            </div>
            <button
              type="button"
              onClick={() => setCampaignPage((p) => Math.min(campaignsTotalPages, p + 1))}
              disabled={campaignPage >= campaignsTotalPages}
              className="px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-200 text-[11px] hover:bg-white/10 disabled:opacity-50 transition"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Auto-proposed Resolutions */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-300">Auto-Proposed Resolutions</h3>
            <div className="text-[11px] text-gray-500">
              {pending.length} total • page {pendingPage}/{pendingTotalPages}
            </div>
          </div>
          {paginatedPending.map((p) => (
            <div key={p.marketAddress} className="p-3 rounded-lg bg-pump-dark border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">${p.tokenSymbol}</span>
                <span className="text-xs text-gray-400 font-mono">{p.marketAddress.slice(0, 8)}...</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-gray-400">
                  Start: <span className="text-white">{formatPrice(p.priceStart)}</span>
                </div>
                <div className="text-gray-400">
                  End: <span className="text-white">{formatPrice(p.priceEnd)}</span>
                </div>
                <div className="text-gray-400">
                  Change:{" "}
                  <span className={p.priceEnd > p.priceStart ? "text-pump-green" : "text-red-400"}>
                    {pctChange(p.priceStart, p.priceEnd)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-400">
                  Suggested: <span className={`font-semibold ${p.autoResolvedOutcome === "YES" ? "text-pump-green" : "text-red-400"}`}>
                    {p.autoResolvedOutcome}
                  </span>
                </span>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded border ${
                    p.resolutionStatus === "proposed"
                      ? "border-blue-400/40 bg-blue-500/10 text-blue-300"
                      : "border-yellow-400/40 bg-yellow-500/10 text-yellow-300"
                  }`}
                >
                  {p.resolutionStatus === "proposed" ? "PROPOSED" : "PENDING"}
                </span>
              </div>
              {p.resolvedAt && (
                <div className="text-[11px] text-gray-500">
                  Proposed at {new Date(p.resolvedAt).toLocaleString()}
                </div>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setPendingPage((p) => Math.max(1, p - 1))}
              disabled={pendingPage <= 1}
              className="px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-200 text-[11px] hover:bg-white/10 disabled:opacity-50 transition"
            >
              Previous
            </button>
            <div className="text-[11px] text-gray-500">
              Showing {(pendingPage - 1) * PENDING_PAGE_SIZE + 1}-{Math.min(pendingPage * PENDING_PAGE_SIZE, pending.length)}
            </div>
            <button
              type="button"
              onClick={() => setPendingPage((p) => Math.min(pendingTotalPages, p + 1))}
              disabled={pendingPage >= pendingTotalPages}
              className="px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-200 text-[11px] hover:bg-white/10 disabled:opacity-50 transition"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
