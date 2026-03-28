"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Play, RefreshCw, ToggleLeft, ToggleRight, X } from "lucide-react";

type NoticeTone = "ok" | "error" | "neutral";
type Notice = { tone: NoticeTone; message: string };

type TrafficCamera = {
  id: string;
  name: string;
  streamUrl: string;
};

type TrafficMarket = {
  market_address: string;
  question: string | null;
  created_at: string | null;
  end_date: string | null;
  resolution_status: string | null;
  resolved: boolean | null;
  sport_meta: Record<string, unknown> | null;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

async function adminPost(action: string, extra: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch("/api/admin/traffic-flash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
    credentials: "include",
  });
  return res.json();
}

export default function AdminTrafficFlashPanel() {
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState(12);
  const [durationSec, setDurationSec] = useState<60 | 180 | 300>(60);
  const [cameraId, setCameraId] = useState("");
  const [cameras, setCameras] = useState<TrafficCamera[]>([]);
  const [recent, setRecent] = useState<TrafficMarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await adminPost("status");
      if (!res?.ok) throw new Error(res?.error || "Failed to load traffic status.");

      const runtime = asObject(res.status);
      const nextEnabled = !!runtime.enabled;
      const nextCameras = (Array.isArray(runtime.cameras) ? runtime.cameras : []) as TrafficCamera[];
      setEnabled(nextEnabled);
      setCameras(nextCameras);
      setRecent((Array.isArray(res.recent) ? res.recent : []) as TrafficMarket[]);

      const hasCurrentCamera = nextCameras.some((camera) => camera.id === cameraId);
      if (!hasCurrentCamera) {
        setCameraId(nextCameras[0]?.id || "");
      }
    } catch (e: any) {
      if (!silent) {
        setNotice({ tone: "error", message: String(e?.message || e || "Failed to refresh panel.") });
      }
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, [cameraId]);

  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(true), 10_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const handleToggleEnabled = async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await adminPost("set_enabled", { enabled: !enabled });
      if (!res?.ok) throw new Error(res?.error || "Failed to change traffic flash status.");
      setEnabled(!!res.enabled);
      setNotice({
        tone: "ok",
        message: res.enabled ? "Traffic Flash enabled." : "Traffic Flash disabled.",
      });
    } catch (e: any) {
      setNotice({ tone: "error", message: String(e?.message || e || "Toggle failed.") });
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    const safeThreshold = Math.max(1, Math.floor(Number(threshold) || 12));
    if (!cameraId) {
      setNotice({ tone: "error", message: "Select a camera before starting." });
      return;
    }

    setLoading(true);
    setNotice(null);
    try {
      const res = await adminPost("start_flash", {
        threshold: safeThreshold,
        duration_sec: durationSec,
        camera_id: cameraId,
      });

      if (!res?.ok) throw new Error(res?.error || "Failed to start traffic flash.");
      const marketAddress = String(res?.result?.marketAddress || "");
      setNotice({
        tone: "ok",
        message: marketAddress
          ? `Traffic flash started: ${marketAddress}`
          : "Traffic flash started.",
      });
      await refresh(true);
    } catch (e: any) {
      setNotice({ tone: "error", message: String(e?.message || e || "Start failed.") });
    } finally {
      setLoading(false);
    }
  };

  const selectedCameraName = useMemo(
    () => cameras.find((camera) => camera.id === cameraId)?.name || "Unknown camera",
    [cameraId, cameras],
  );

  return (
    <div className="card-pump space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">Traffic Flash</h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-60"
          disabled={refreshing || loading}
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {notice && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            notice.tone === "ok"
              ? "border-pump-green/30 bg-pump-green/10 text-pump-green"
              : notice.tone === "error"
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-white/15 bg-white/5 text-gray-300"
          }`}
        >
          <span className="flex-1">{notice.message}</span>
          <button onClick={() => setNotice(null)} className="text-gray-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Traffic Flash Status</div>
            <div className="text-xs text-gray-400">
              {enabled ? "Enabled" : "Disabled"} • Camera: {selectedCameraName}
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleEnabled}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
              enabled
                ? "border-pump-green/40 bg-pump-green/10 text-pump-green"
                : "border-red-500/40 bg-red-500/10 text-red-300"
            }`}
            disabled={loading}
          >
            {enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
            {enabled ? "Disable" : "Enable"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-gray-400 uppercase tracking-wide">Threshold</span>
            <input
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(1, Math.floor(Number(e.target.value) || 12)))}
              className="w-full rounded-lg border border-white/10 bg-pump-dark px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-gray-400 uppercase tracking-wide">Duration</span>
            <select
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value) as 60 | 180 | 300)}
              className="w-full rounded-lg border border-white/10 bg-pump-dark px-3 py-2 text-sm text-white"
            >
              <option value={60}>60s</option>
              <option value={180}>180s</option>
              <option value={300}>300s</option>
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-xs text-gray-400 uppercase tracking-wide">Camera</span>
            <select
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-pump-dark px-3 py-2 text-sm text-white"
            >
              {cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={handleStart}
          disabled={loading || !enabled || !cameraId}
          className="inline-flex items-center gap-2 rounded-lg border border-pump-green/40 bg-pump-green/10 px-4 py-2 text-sm font-semibold text-pump-green hover:bg-pump-green/20 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Start Traffic Flash
        </button>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="mb-3 text-sm font-semibold text-white">Recent Traffic Flash Markets</div>
        {recent.length === 0 ? (
          <div className="text-sm text-gray-400">No traffic flash market yet.</div>
        ) : (
          <div className="space-y-2">
            {recent.slice(0, 8).map((row) => {
              const meta = asObject(row.sport_meta);
              const thresholdValue = Number(meta.threshold || 0);
              const durationValue = Number(meta.duration_sec || 0);
              const currentCount = Number(meta.current_count || meta.end_count || 0);
              const cameraName = String(meta.camera_name || meta.camera_id || "").trim() || "camera";
              const status = String(row.resolution_status || "open").toLowerCase();
              return (
                <div
                  key={row.market_address}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                >
                  <div className="min-w-0">
                    <a
                      href={`/trade/${row.market_address}`}
                      className="text-sm font-semibold text-white hover:text-pump-green underline-offset-2 hover:underline"
                    >
                      {row.question || row.market_address}
                    </a>
                    <div className="text-xs text-gray-400">
                      {cameraName} • threshold {thresholdValue || "—"} • duration {durationValue || "—"}s • count{" "}
                      {Number.isFinite(currentCount) ? Math.floor(currentCount) : "—"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`text-xs font-semibold ${
                        status === "proposed" || status === "finalized"
                          ? "text-pump-green"
                          : status === "cancelled"
                          ? "text-red-300"
                          : "text-yellow-300"
                      }`}
                    >
                      {status.toUpperCase()}
                    </div>
                    <div className="text-xs text-gray-500">{formatDateTime(row.created_at)}</div>
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
