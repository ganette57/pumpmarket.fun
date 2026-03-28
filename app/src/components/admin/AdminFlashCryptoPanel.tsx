"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Play, RefreshCw, Sparkles, Square, X } from "lucide-react";
import {
  FLASH_CRYPTO_MAJOR_SYMBOLS,
  getFlashCryptoMajorConfigBySymbol,
  type FlashCryptoMajorSymbol,
  type FlashCryptoSourceType,
} from "@/lib/flashCrypto/majors";

type CampaignStatus = "running" | "stopped" | "completed";
type FlashMode = "price" | "graduation";
type PriceSourceType = FlashCryptoSourceType;

type Campaign = {
  id: string;
  type?: "flash_crypto_price" | "flash_crypto_graduation";
  mode?: FlashMode;
  status: CampaignStatus;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  tokenImageUri: string | null;
  sourceType?: PriceSourceType;
  majorSymbol?: string | null;
  majorPair?: string | null;
  durationMinutes: number;
  launchIntervalMinutes: number;
  totalMarkets: number;
  launchedCount: number;
  startedAt: string;
  stoppedAt: string | null;
  lastError: string | null;
};

type CampaignView = Campaign & {
  _lastSeenAtMs: number;
};

type PendingResolution = {
  marketAddress: string;
  marketId: string | null;
  tokenMint: string;
  tokenSymbol: string;
  tokenName: string;
  priceStart: number;
  priceEnd: number;
  progressStart: number | null;
  progressEnd: number | null;
  didGraduateEnd: boolean | null;
  sourceType?: PriceSourceType;
  majorSymbol?: string | null;
  majorPair?: string | null;
  durationMinutes: number;
  mode: FlashMode;
  autoResolvedOutcome: "YES" | "NO";
  resolutionStatus: "pending_admin_confirmation" | "proposed";
  resolvedAt: string | null;
};

type GraduationSuggestion = {
  mint: string;
  symbol: string;
  name: string;
  imageUri: string | null;
  durationMinutes: 10 | 30 | 60;
  thresholdPct: 40 | 60;
  progressPct: number;
  didGraduate: boolean;
  remainingToGraduate: number | null;
  lastTradeAt: string | null;
  volumeUsd: number | null;
  activityCount: number | null;
  momentum: number | null;
  recentlyUsed: boolean;
  recentlyUsedCount: number;
  score: number;
  scoreBreakdown: {
    progressWeight: number;
    proximityWeight: number;
    activityWeight: number;
    volumeWeight: number;
    momentumWeight: number;
    recentDuplicatePenalty: number;
  };
};

type NoticeTone = "ok" | "error" | "neutral";
type Notice = { tone: NoticeTone; message: string };

const CAMPAIGNS_PAGE_SIZE = 5;
const PENDING_PAGE_SIZE = 6;
const CAMPAIGN_MISSING_RETENTION_MS = 30 * 60_000;

const PRICE_DURATION_OPTIONS = [1, 3, 5] as const;
const GRADUATION_DURATION_OPTIONS = [10, 30, 60] as const;
const MAJOR_SYMBOL_OPTIONS = [...FLASH_CRYPTO_MAJOR_SYMBOLS] as FlashCryptoMajorSymbol[];

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

function formatProgress(value: number | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.max(0, Math.min(100, n)).toFixed(1)}%`;
}

function formatVolumeUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
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

function campaignModeOf(campaign: Pick<Campaign, "mode" | "type">): FlashMode {
  return campaign.mode || (campaign.type === "flash_crypto_graduation" ? "graduation" : "price");
}

function campaignHasUsefulFlow(campaign: Campaign, pendingRows: PendingResolution[]): boolean {
  if (campaign.status === "running") return true;
  if (campaign.launchedCount < campaign.totalMarkets) return true;
  const mode = campaignModeOf(campaign);
  return pendingRows.some((p) => p.tokenMint === campaign.tokenMint && p.mode === mode);
}

function mergeCampaignsForAdmin(params: {
  previous: CampaignView[];
  incoming: Campaign[];
  pending: PendingResolution[];
  nowMs: number;
}): CampaignView[] {
  const merged: CampaignView[] = [];
  const seen = new Set<string>();

  for (const incoming of params.incoming) {
    merged.push({
      ...incoming,
      _lastSeenAtMs: params.nowMs,
    });
    seen.add(incoming.id);
  }

  for (const prev of params.previous) {
    if (seen.has(prev.id)) continue;
    const keepForFlow = campaignHasUsefulFlow(prev, params.pending);
    const keepForGrace = params.nowMs - prev._lastSeenAtMs <= CAMPAIGN_MISSING_RETENTION_MS;
    if (!keepForFlow && !keepForGrace) continue;
    merged.push(prev);
  }

  merged.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return merged;
}

export default function AdminFlashCryptoPanel() {
  const [mode, setMode] = useState<FlashMode>("price");
  const [priceSourceType, setPriceSourceType] = useState<PriceSourceType>("pump_fun");
  const [tokenMint, setTokenMint] = useState("");
  const [majorSymbol, setMajorSymbol] = useState<FlashCryptoMajorSymbol>("BTC");
  const [duration, setDuration] = useState<number>(5);
  const [totalMarkets, setTotalMarkets] = useState(10);
  const [launchInterval, setLaunchInterval] = useState(5);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [pending, setPending] = useState<PendingResolution[]>([]);
  const [campaignPage, setCampaignPage] = useState(1);
  const [pendingPage, setPendingPage] = useState(1);

  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<GraduationSuggestion[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [campRes, pendRes] = await Promise.all([
        adminPost("list_campaigns"),
        adminPost("list_pending"),
      ]);
      const nextPending = pendRes.ok
        ? ((pendRes.pending || []) as PendingResolution[]).slice().sort((a, b) => {
            const aTs = Date.parse(String(a.resolvedAt || ""));
            const bTs = Date.parse(String(b.resolvedAt || ""));
            const safeA = Number.isFinite(aTs) ? aTs : 0;
            const safeB = Number.isFinite(bTs) ? bTs : 0;
            return safeB - safeA;
          })
        : null;

      if (nextPending) {
        setPending(nextPending);
      }

      if (campRes.ok) {
        const incomingCampaigns = (campRes.campaigns || []) as Campaign[];
        setCampaigns((prev) =>
          mergeCampaignsForAdmin({
            previous: prev,
            incoming: incomingCampaigns,
            pending: nextPending || pending,
            nowMs: Date.now(),
          }),
        );
      }
    } catch {
      // ignore
    }
  }, [pending]);

  const loadSuggestions = useCallback(async (d: number) => {
    if (mode !== "graduation") return;
    setSuggestionsLoading(true);
    try {
      const res = await adminPost("list_suggestions", {
        duration_minutes: d,
        limit: 16,
      });
      if (res.ok) {
        setSuggestions((res.suggestions || []) as GraduationSuggestion[]);
      } else {
        setSuggestions([]);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [mode]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, [refresh]);

  useEffect(() => {
    if (mode === "graduation") {
      if (!GRADUATION_DURATION_OPTIONS.includes(duration as any)) {
        setDuration(10);
        setLaunchInterval(10);
      }
      return;
    }
    if (!PRICE_DURATION_OPTIONS.includes(duration as any)) {
      setDuration(5);
      setLaunchInterval(5);
    }
  }, [duration, mode]);

  useEffect(() => {
    if (mode !== "graduation") {
      setSuggestions([]);
      return;
    }
    void loadSuggestions(duration);
  }, [duration, mode, loadSuggestions]);

  const campaignsTotalPages = Math.max(1, Math.ceil(campaigns.length / CAMPAIGNS_PAGE_SIZE));
  const safeCampaignPage = Math.min(Math.max(1, campaignPage), campaignsTotalPages);
  const paginatedCampaigns = useMemo(() => {
    const start = (safeCampaignPage - 1) * CAMPAIGNS_PAGE_SIZE;
    return campaigns.slice(start, start + CAMPAIGNS_PAGE_SIZE);
  }, [campaigns, safeCampaignPage]);

  const pendingTotalPages = Math.max(1, Math.ceil(pending.length / PENDING_PAGE_SIZE));
  const safePendingPage = Math.min(Math.max(1, pendingPage), pendingTotalPages);
  const paginatedPending = useMemo(() => {
    const start = (safePendingPage - 1) * PENDING_PAGE_SIZE;
    return pending.slice(start, start + PENDING_PAGE_SIZE);
  }, [pending, safePendingPage]);

  useEffect(() => {
    setCampaignPage((prev) => Math.min(prev, campaignsTotalPages));
  }, [campaignsTotalPages]);

  useEffect(() => {
    setPendingPage((prev) => Math.min(prev, pendingTotalPages));
  }, [pendingTotalPages]);

  const handleStart = async () => {
    const selectedMajor = getFlashCryptoMajorConfigBySymbol(majorSymbol);
    const isMajorPrice = mode === "price" && priceSourceType === "major";
    const resolvedTokenMint = isMajorPrice ? (selectedMajor?.pair || "") : tokenMint.trim();

    if (!resolvedTokenMint) {
      setNotice({ tone: "error", message: "Token mint is required." });
      return;
    }

    setLoading(true);
    setNotice(null);
    try {
      const res = await adminPost("start_campaign", {
        mode,
        source_type: mode === "price" ? priceSourceType : "pump_fun",
        token_mint: resolvedTokenMint,
        major_symbol: isMajorPrice ? selectedMajor?.symbol || majorSymbol : null,
        major_pair: isMajorPrice ? selectedMajor?.pair || null : null,
        duration_minutes: duration,
        total_markets: totalMarkets,
        launch_interval_minutes: launchInterval,
      });
      if (res.ok) {
        setNotice({
          tone: "ok",
          message: `Campaign started: $${res.result?.campaign?.tokenSymbol || "?"} — ${res.result?.campaign?.id}`,
        });
        if (!isMajorPrice) {
          setTokenMint("");
        }
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

  const durationOptions = mode === "graduation" ? GRADUATION_DURATION_OPTIONS : PRICE_DURATION_OPTIONS;

  return (
    <div className="card-pump space-y-6">
      <h2 className="text-xl font-bold text-white">Flash Crypto Campaign</h2>

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

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setMode("price");
              setDuration(5);
              setLaunchInterval(5);
            }}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
              mode === "price"
                ? "border-pump-green/60 bg-pump-green/10 text-pump-green"
                : "border-white/10 bg-pump-dark text-gray-300 hover:border-white/20"
            }`}
          >
            PRICE
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("graduation");
              setDuration(10);
              setLaunchInterval(10);
            }}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
              mode === "graduation"
                ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-300"
                : "border-white/10 bg-pump-dark text-gray-300 hover:border-white/20"
            }`}
          >
            GRADUATION
          </button>
        </div>

        {mode === "price" && (
          <div className="space-y-2">
            <label className="block text-xs text-gray-400">Flash source</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPriceSourceType("pump_fun")}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  priceSourceType === "pump_fun"
                    ? "border-pump-green/60 bg-pump-green/10 text-pump-green"
                    : "border-white/10 bg-pump-dark text-gray-300 hover:border-white/20"
                }`}
              >
                MEME (pump.fun)
              </button>
              <button
                type="button"
                onClick={() => setPriceSourceType("major")}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  priceSourceType === "major"
                    ? "border-amber-400/60 bg-amber-500/10 text-amber-200"
                    : "border-white/10 bg-pump-dark text-gray-300 hover:border-white/20"
                }`}
              >
                MAJOR (Binance)
              </button>
            </div>
          </div>
        )}

        {mode === "price" && priceSourceType === "major" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Major symbol</label>
              <select
                value={majorSymbol}
                onChange={(e) => setMajorSymbol(e.target.value as FlashCryptoMajorSymbol)}
                className="w-full px-3 py-2 rounded-lg bg-pump-dark border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-amber-300"
              >
                {MAJOR_SYMBOL_OPTIONS.map((symbol) => (
                  <option key={symbol} value={symbol} className="bg-pump-dark text-white">
                    {symbol}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Pair</label>
              <div className="px-3 py-2 rounded-lg bg-black/20 border border-white/10 text-sm text-white">
                {getFlashCryptoMajorConfigBySymbol(majorSymbol)?.pair || `${majorSymbol}USDT`}
              </div>
            </div>
          </div>
        ) : (
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
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Duration (min)</label>
            <select
              value={duration}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDuration(v);
                setLaunchInterval(v);
              }}
              className="w-full px-3 py-2 rounded-lg bg-pump-dark border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-pump-green"
            >
              {durationOptions.map((d) => (
                <option key={d} value={d} className="bg-pump-dark text-white">
                  {d === 60 ? "1 hour" : `${d} min`}
                </option>
              ))}
            </select>
            {mode === "graduation" && (
              <p className="mt-1 text-[11px] text-gray-500">
                Recommended threshold: {duration === 10 ? "40%+" : "60%+"} progress
              </p>
            )}
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

      {mode === "graduation" && (
        <div className="space-y-3 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-300" />
              <h3 className="text-sm font-semibold text-cyan-200">Suggested Tokens (Moon or Rug)</h3>
            </div>
            <button
              type="button"
              onClick={() => void loadSuggestions(duration)}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-gray-200 hover:bg-white/10 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${suggestionsLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {suggestionsLoading ? (
            <div className="text-xs text-gray-400">Loading suggestions…</div>
          ) : suggestions.length === 0 ? (
            <div className="text-xs text-gray-500">No candidates found right now for this duration.</div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-auto pr-1">
              {suggestions.map((s) => (
                <div key={s.mint} className="rounded-lg border border-white/10 bg-black/25 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">${s.symbol} <span className="text-gray-400">{s.name}</span></div>
                      <div className="mt-1 text-[11px] text-gray-400 flex flex-wrap gap-2">
                        <span>Progress: <span className="text-cyan-200">{formatProgress(s.progressPct)}</span></span>
                        <span>Score: <span className="text-pump-green">{s.score.toFixed(1)}</span></span>
                        <span>Volume: <span className="text-gray-200">{formatVolumeUsd(s.volumeUsd)}</span></span>
                        <span>Activity: <span className="text-gray-200">{s.activityCount ?? 0}</span></span>
                        {s.recentlyUsed && <span className="text-yellow-300">Used x{s.recentlyUsedCount}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTokenMint(s.mint)}
                      className="shrink-0 rounded-md border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/25 transition"
                    >
                      Select
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {campaigns.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-300">Campaigns</h3>
            <div className="text-[11px] text-gray-500">
              {campaigns.length} total • page {safeCampaignPage}/{campaignsTotalPages}
            </div>
          </div>
          {paginatedCampaigns.map((c) => {
            const modeTag = c.mode || (c.type === "flash_crypto_graduation" ? "graduation" : "price");
            const isMajor = modeTag === "price" && c.sourceType === "major";
            return (
              <div key={c.id} className="p-3 rounded-lg bg-pump-dark border border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {c.tokenImageUri && (
                      <img src={c.tokenImageUri} alt={c.tokenSymbol} className="w-6 h-6 rounded-full" />
                    )}
                    <span className="font-semibold text-white">${c.tokenSymbol}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${
                      modeTag === "graduation"
                        ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200"
                        : isMajor
                        ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                        : "border-pump-green/40 bg-pump-green/10 text-pump-green"
                    }`}>
                      {modeTag === "graduation" ? "GRADUATION" : isMajor ? "PRICE • MAJOR" : "PRICE • MEME"}
                    </span>
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
                  <div>Duration: <span className="text-white">{c.durationMinutes === 60 ? "1h" : `${c.durationMinutes}m`}</span></div>
                  <div>Markets: <span className="text-white">{c.launchedCount}/{c.totalMarkets}</span></div>
                  <div>Interval: <span className="text-white">{c.launchIntervalMinutes}m</span></div>
                  <div>Started: <span className="text-white">{new Date(c.startedAt).toLocaleTimeString()}</span></div>
                </div>
                {c.lastError && (
                  <div className="text-xs text-red-400 bg-red-500/10 p-2 rounded">{c.lastError}</div>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setCampaignPage((p) => Math.max(1, p - 1))}
              disabled={safeCampaignPage <= 1}
              className="px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-200 text-[11px] hover:bg-white/10 disabled:opacity-50 transition"
            >
              Previous
            </button>
            <div className="text-[11px] text-gray-500">
              Showing {(safeCampaignPage - 1) * CAMPAIGNS_PAGE_SIZE + 1}-{Math.min(safeCampaignPage * CAMPAIGNS_PAGE_SIZE, campaigns.length)}
            </div>
            <button
              type="button"
              onClick={() => setCampaignPage((p) => Math.min(campaignsTotalPages, p + 1))}
              disabled={safeCampaignPage >= campaignsTotalPages}
              className="px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-200 text-[11px] hover:bg-white/10 disabled:opacity-50 transition"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-300">Auto-Proposed Resolutions</h3>
            <div className="text-[11px] text-gray-500">
              {pending.length} total • page {safePendingPage}/{pendingTotalPages}
            </div>
          </div>
          {paginatedPending.map((p, idx) => {
            const pendingIndex = (safePendingPage - 1) * PENDING_PAGE_SIZE + idx + 1;
            return (
            <div key={`${p.marketAddress}-${p.resolvedAt || idx}`} className="p-3 rounded-lg bg-pump-dark border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">${p.tokenSymbol}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded border ${
                    p.mode === "graduation"
                      ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200"
                      : p.sourceType === "major"
                      ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                      : "border-pump-green/40 bg-pump-green/10 text-pump-green"
                  }`}>
                    {p.mode === "graduation" ? "GRADUATION" : p.sourceType === "major" ? "PRICE • MAJOR" : "PRICE • MEME"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500 tabular-nums">{pendingIndex}/{pending.length}</span>
                  <span className="text-xs text-gray-400 font-mono">{p.marketAddress.slice(0, 8)}...</span>
                </div>
              </div>

              {p.mode === "graduation" ? (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="text-gray-400">
                    Start: <span className="text-white">{formatProgress(p.progressStart)}</span>
                  </div>
                  <div className="text-gray-400">
                    End: <span className="text-white">{formatProgress(p.progressEnd)}</span>
                  </div>
                  <div className="text-gray-400">
                    Final: <span className={p.didGraduateEnd ? "text-pump-green" : "text-red-300"}>{p.didGraduateEnd ? "Graduated" : "Not graduated"}</span>
                  </div>
                </div>
              ) : (
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
              )}

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
          )})}
          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setPendingPage((p) => Math.max(1, p - 1))}
              disabled={safePendingPage <= 1}
              className="px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-200 text-[11px] hover:bg-white/10 disabled:opacity-50 transition"
            >
              Previous
            </button>
            <div className="text-[11px] text-gray-500">
              Showing {(safePendingPage - 1) * PENDING_PAGE_SIZE + 1}-{Math.min(safePendingPage * PENDING_PAGE_SIZE, pending.length)}
            </div>
            <button
              type="button"
              onClick={() => setPendingPage((p) => Math.min(pendingTotalPages, p + 1))}
              disabled={safePendingPage >= pendingTotalPages}
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
