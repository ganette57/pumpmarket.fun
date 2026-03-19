"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Play, RefreshCw, Search, Trophy, X } from "lucide-react";

type MatchStatus = "scheduled" | "live" | "finished" | "unknown";

type SportsMatch = {
  provider: string;
  provider_event_id: string;
  sport: string;
  league: string;
  home_team: string;
  away_team: string;
  start_time: string;
  status: MatchStatus | string;
  raw?: Record<string, unknown> | null;
};

type LiveMicroLoopStatus = "active" | "halftime" | "ended" | "error";
type LiveMicroLoopPhase = "first_half" | "halftime" | "second_half" | "ended";
type LiveMicroDisplayStatus = LiveMicroLoopStatus | "retrying" | "stopped";

type LiveMicroLoop = {
  id: string;
  provider_match_id: string;
  provider_name: string;
  sport: string;
  loop_status: LiveMicroLoopStatus;
  loop_phase: LiveMicroLoopPhase;
  first_half_count: number;
  second_half_count: number;
  stop_reason: string | null;
  current_active_live_micro_id: string | null;
  error_message: string | null;
  activated_at: string;
  updated_at: string;
  last_snapshot_payload: Record<string, unknown> | null;
};

type TriggerLoopStatusResponse = {
  ok?: boolean;
  error?: string;
  loop?: LiveMicroLoop | null;
  loops?: LiveMicroLoop[];
};

type TriggerActivateResponse = {
  ok?: boolean;
  error?: string;
  result?: {
    reason?: string;
    firstMarketCreated?: boolean;
    firstMarket?: {
      liveMicroId?: string;
    } | null;
    loop?: LiveMicroLoop | null;
  };
};

type TriggerResumeResponse = {
  ok?: boolean;
  error?: string;
  result?: {
    resumed?: boolean;
    reason?: string;
    reconcile?: Record<string, unknown> | null;
    loop?: LiveMicroLoop | null;
  };
};

type TriggerStopResponse = {
  ok?: boolean;
  error?: string;
  result?: {
    stopped?: boolean;
    reason?: string;
    loop?: LiveMicroLoop | null;
  };
};

type NoticeTone = "ok" | "error" | "neutral";

type Notice = {
  tone: NoticeTone;
  message: string;
};

function isValidIanaTimeZone(tz?: string | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function hasExplicitTimeZone(input: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(input.trim());
}

function zonedLocalToUtcMs(localDateTime: string, timeZone: string): number {
  const m = localDateTime
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s])(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return NaN;

  const guessUtcMs = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] || "0")
  );

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(new Date(guessUtcMs));
  const byType = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const interpretedMs = Date.UTC(
    Number(byType("year")),
    Number(byType("month")) - 1,
    Number(byType("day")),
    Number(byType("hour")),
    Number(byType("minute")),
    Number(byType("second"))
  );

  const offsetMs = interpretedMs - guessUtcMs;
  return guessUtcMs - offsetMs;
}

function parseEventStartDate(startTime: unknown, eventTimeZone?: string | null): Date | null {
  if (typeof startTime === "number") {
    const ms = startTime > 1_000_000_000_000 ? startTime : startTime * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  if (typeof startTime !== "string" || !startTime.trim()) return null;
  const raw = startTime.trim();

  if (hasExplicitTimeZone(raw)) {
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  if (isValidIanaTimeZone(eventTimeZone)) {
    const utcMs = zonedLocalToUtcMs(raw, eventTimeZone);
    if (Number.isFinite(utcMs)) return new Date(utcMs);
  }

  const utcGuess = new Date(`${raw}Z`);
  return Number.isFinite(utcGuess.getTime()) ? utcGuess : null;
}

function formatYourTime(utcDate: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(utcDate);
}

function formatMatchTime(utcDate: Date, eventTimeZone?: string | null): string {
  if (!isValidIanaTimeZone(eventTimeZone)) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(utcDate);
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: eventTimeZone,
    timeZoneName: "short",
  }).format(utcDate);
}

function extractEventTimeZone(m: SportsMatch): string | null {
  const raw = (m.raw || {}) as Record<string, unknown>;
  const fixture = (raw.fixture || {}) as Record<string, unknown>;
  const candidates = [raw.timezone, raw.tz, fixture.timezone];
  for (const tz of candidates) {
    const value = String(tz || "").trim();
    if (isValidIanaTimeZone(value)) return value;
  }
  return null;
}

function normalizeMatchStatus(value: unknown): MatchStatus {
  const s = String(value || "").trim().toLowerCase();
  if (s === "scheduled" || s === "live" || s === "finished") return s;
  return "unknown";
}

function toReadableStatus(status: MatchStatus): string {
  if (status === "live") return "Live";
  if (status === "finished") return "Finished";
  if (status === "scheduled") return "Scheduled";
  return "Unknown";
}

function matchStatusTone(status: MatchStatus): string {
  if (status === "live") return "border-red-500/40 bg-red-500/10 text-red-300";
  if (status === "finished") return "border-gray-500/40 bg-gray-500/10 text-gray-300";
  if (status === "scheduled") return "border-white/20 bg-white/10 text-gray-200";
  return "border-yellow-500/40 bg-yellow-500/10 text-yellow-300";
}

function loopStatusTone(status: LiveMicroDisplayStatus): string {
  if (status === "active") return "border-pump-green/40 bg-pump-green/10 text-pump-green";
  if (status === "halftime") return "border-blue-500/40 bg-blue-500/10 text-blue-300";
  if (status === "retrying") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (status === "stopped") return "border-slate-500/40 bg-slate-500/10 text-slate-300";
  if (status === "ended") return "border-gray-500/40 bg-gray-500/10 text-gray-300";
  return "border-red-500/40 bg-red-500/10 text-red-300";
}

function loopPhaseTone(phase: LiveMicroLoopPhase): string {
  if (phase === "first_half") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (phase === "second_half") return "border-cyan-500/40 bg-cyan-500/10 text-cyan-300";
  if (phase === "halftime") return "border-indigo-500/40 bg-indigo-500/10 text-indigo-300";
  return "border-gray-500/40 bg-gray-500/10 text-gray-300";
}

function safeObj(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

type LoopRetryInfo = {
  retrying: boolean;
  retryCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

function readLoopRetryInfo(loop: LiveMicroLoop): LoopRetryInfo {
  const payload = safeObj(loop.last_snapshot_payload);
  const runtime = safeObj(payload.__live_micro_loop_runtime);
  const retry = safeObj(runtime.retry);
  const retryCount = Math.max(0, Math.floor(Number(retry.retry_count ?? 0) || 0));
  const maxAttempts = Math.max(1, Math.floor(Number(retry.max_attempts ?? 6) || 6));
  const nextRetryAt = String(retry.next_retry_at || "").trim() || null;
  const lastError = String(retry.last_error || "").trim() || null;
  const lastErrorAt = String(retry.last_error_at || "").trim() || null;
  return {
    retrying: Boolean(retry.retrying),
    retryCount,
    maxAttempts,
    nextRetryAt,
    lastError,
    lastErrorAt,
  };
}

function loopDisplayStatus(loop: LiveMicroLoop): LiveMicroDisplayStatus {
  if (loop.loop_status === "ended" && loop.stop_reason === "manual_admin_stop") return "stopped";
  if (loop.loop_status === "ended") return "ended";
  if (loop.loop_status === "error") return "error";
  const retryInfo = readLoopRetryInfo(loop);
  if (retryInfo.retrying) return "retrying";
  return loop.loop_status;
}

function readNestedString(obj: unknown, path: string[]): string | null {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  const value = String(cur || "").trim();
  return value || null;
}

function loopMatchLabel(loop: LiveMicroLoop, knownByMatchId: Record<string, SportsMatch>): string {
  const known = knownByMatchId[loop.provider_match_id];
  if (known?.home_team && known?.away_team) return `${known.home_team} vs ${known.away_team}`;

  const payload = safeObj(loop.last_snapshot_payload);
  const event = safeObj(payload.event);
  const fixture = safeObj(payload.fixture);
  const home =
    readNestedString(event, ["home_team"]) ||
    readNestedString(fixture, ["teams", "home", "name"]) ||
    readNestedString(payload, ["home_team"]);
  const away =
    readNestedString(event, ["away_team"]) ||
    readNestedString(fixture, ["teams", "away", "name"]) ||
    readNestedString(payload, ["away_team"]);

  if (home && away) return `${home} vs ${away}`;
  return `Match ${loop.provider_match_id}`;
}

function loopLeague(loop: LiveMicroLoop, knownByMatchId: Record<string, SportsMatch>): string | null {
  const known = knownByMatchId[loop.provider_match_id];
  if (known?.league) return known.league;

  const payload = safeObj(loop.last_snapshot_payload);
  const event = safeObj(payload.event);
  const fixture = safeObj(payload.fixture);
  return (
    readNestedString(event, ["league"]) ||
    readNestedString(fixture, ["league", "name"]) ||
    readNestedString(payload, ["league"])
  );
}

function friendlyActivationReason(reason: string | undefined): string {
  const r = String(reason || "").trim();
  if (!r) return "Loop activated.";
  if (r === "first_market_created") return "Loop activated and first market created.";
  if (r === "active_micro_already_exists") return "Loop activated (active market already existed).";
  if (r === "first_market_retry_scheduled") return "Loop activated. First window creation failed temporarily and retry is scheduled.";
  if (r === "first_market_retry_exhausted") return "Loop activation reached max retry attempts for first window.";
  if (r.startsWith("match_not_live:")) return "Loop activated. Match is not live yet, waiting for live state.";
  if (r === "provider_finished" || r === "provider_match_finished") {
    return "Loop ended immediately because provider reports the match as finished.";
  }
  if (r === "hard_stop_minute_reached" || r === "hard_stop_max_match_minutes_reached") {
    return "Loop reached hard stop conditions.";
  }
  return `Loop activated (${r}).`;
}

function friendlyApiError(message: string): string {
  const msg = String(message || "").trim();
  const lowered = msg.toLowerCase();
  if (lowered.includes("max active match loops reached")) {
    return "Maximum active loops reached. End or wait for current loops before activating another one.";
  }
  if (lowered.includes("provider_match_id is required")) {
    return "Please pick a match before activation.";
  }
  if (lowered.includes("unauthorized")) {
    return "Admin authorization required.";
  }
  return msg || "Action failed.";
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

function SoccerMatchPickerModal({
  open,
  onClose,
  onSelectMatch,
}: {
  open: boolean;
  onClose: () => void;
  onSelectMatch: (m: SportsMatch) => void;
}) {
  const [fixtures, setFixtures] = useState<SportsMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setFilter("");
    setError("");
  }, [open]);

  const handleLoad = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/sports/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport: "soccer" }),
      });

      if (res.status === 429) {
        setError("Rate limit reached. Try again later.");
        return;
      }

      if (!res.ok) {
        setError("Failed to load matches.");
        return;
      }

      const json = (await res.json().catch(() => ({}))) as { matches?: SportsMatch[] };
      const matches = Array.isArray(json.matches) ? json.matches : [];
      setFixtures(matches);
      setLoaded(true);
      if (matches.length === 0) setError("No soccer matches found.");
    } catch {
      setError("Failed to load matches.");
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const fixturesByDay = useMemo(() => {
    const filtered = fixtures.filter((m) => {
      if (!filter.trim()) return true;
      const q = filter.toLowerCase();
      return `${m.home_team} ${m.away_team} ${m.league}`.toLowerCase().includes(q);
    });

    const groups: { label: string; matches: SportsMatch[] }[] = [];
    const byDay = new Map<string, SportsMatch[]>();

    for (const m of filtered) {
      const d = parseEventStartDate(m.start_time, extractEventTimeZone(m));
      if (!d) continue;
      const key = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(m);
    }

    byDay.forEach((matches, label) => {
      groups.push({ label, matches });
    });
    return groups;
  }, [filter, fixtures]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-[#0a0b0d] border border-gray-800 rounded-2xl shadow-2xl flex max-h-[85vh] flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <Trophy className="w-5 h-5 text-pump-green" />
            <h3 className="text-lg font-bold text-white">Pick a match</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition"
            type="button"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="p-4 border-b border-gray-800 space-y-3">
          <div className="flex items-center gap-3">
            <div className="input-pump flex-1 text-sm text-gray-300">Soccer</div>
            <button
              type="button"
              onClick={handleLoad}
              disabled={loading}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold transition flex items-center gap-2 bg-pump-green text-black hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {loaded ? "Reload" : "Load"}
            </button>
          </div>

          {loaded && fixtures.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="input-pump w-full pl-9 text-sm"
                placeholder="Filter by team or league..."
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {!loaded && !loading && !error && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <Trophy className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">Click Load to fetch soccer matches</p>
              <p className="text-xs mt-1 text-gray-600">Next 7 days from provider</p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading upcoming matches...
            </div>
          )}

          {error && <p className="text-xs text-yellow-400 text-center py-4 px-4">{error}</p>}

          {loaded && fixtures.length > 0 && (
            <>
              {fixturesByDay.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-6">No matches match your filter.</p>
              )}
              {fixturesByDay.map((group) => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 px-4 py-1.5 bg-[#0a0b0d]/95 border-b border-white/10 backdrop-blur-sm">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{group.label}</span>
                  </div>
                  {group.matches.map((m) => {
                    const eventTz = extractEventTimeZone(m);
                    const d = parseEventStartDate(m.start_time, eventTz);
                    const yourTime = d ? formatYourTime(d) : "--:--";
                    const matchTime = d ? formatMatchTime(d, eventTz) : "Time unavailable";
                    const status = normalizeMatchStatus(m.status);

                    return (
                      <button
                        key={`${m.provider}:${m.provider_event_id}`}
                        type="button"
                        onClick={() => {
                          onSelectMatch(m);
                          onClose();
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-white/5 transition border-b border-white/5 last:border-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-white truncate">
                            {m.home_team} vs {m.away_team}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${matchStatusTone(status)}`}
                          >
                            {toReadableStatus(status)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-400 truncate">{m.league || "League unavailable"}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                          <span>Your time: {yourTime}</span>
                          <span>{isValidIanaTimeZone(eventTz) ? `Match time: ${matchTime}` : `UTC: ${matchTime}`}</span>
                          <span className="font-mono">id: {m.provider_event_id}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminLiveMicroPanel() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<SportsMatch | null>(null);
  const [knownMatchesById, setKnownMatchesById] = useState<Record<string, SportsMatch>>({});

  const [activating, setActivating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [resumingLoopId, setResumingLoopId] = useState<string | null>(null);
  const [stoppingLoopId, setStoppingLoopId] = useState<string | null>(null);

  const [loops, setLoops] = useState<LiveMicroLoop[]>([]);
  const [loopsLoading, setLoopsLoading] = useState(true);
  const [loopsError, setLoopsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const rememberMatch = useCallback((m: SportsMatch) => {
    setKnownMatchesById((prev) => ({ ...prev, [m.provider_event_id]: m }));
  }, []);

  const loadLoops = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) {
      setLoopsLoading(true);
    } else {
      setRefreshing(true);
    }
    setLoopsError(null);

    try {
      const res = await fetch("/api/admin/live-micro/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "loop_status",
          limit: 20,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as TriggerLoopStatusResponse;
      if (!res.ok || !json.ok) {
        throw new Error(friendlyApiError(json.error || `HTTP ${res.status}`));
      }

      const nextLoops = Array.isArray(json.loops)
        ? json.loops
        : json.loop
        ? [json.loop]
        : [];

      setLoops(nextLoops);
    } catch (e: unknown) {
      setLoopsError((e as { message?: string })?.message || "Failed to load loop statuses.");
    } finally {
      setLoopsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadLoops();
  }, [loadLoops]);

  async function inspectSelectedLoop() {
    if (!selectedMatch) return;
    setRefreshing(true);
    setLoopsError(null);

    try {
      const res = await fetch("/api/admin/live-micro/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "loop_status",
          provider_match_id: selectedMatch.provider_event_id,
          provider_name: selectedMatch.provider || "api-football",
        }),
      });

      const json = (await res.json().catch(() => ({}))) as TriggerLoopStatusResponse;
      if (!res.ok || !json.ok) {
        throw new Error(friendlyApiError(json.error || `HTTP ${res.status}`));
      }

      if (!json.loop) {
        setNotice({
          tone: "neutral",
          message: "No loop found for the selected match yet.",
        });
        return;
      }

      const incoming = json.loop;
      setLoops((prev) => {
        const byId = new Map<string, LiveMicroLoop>();
        for (const row of prev) byId.set(row.id, row);
        byId.set(incoming.id, incoming);
        return Array.from(byId.values()).sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      });
      setNotice({ tone: "neutral", message: "Loop status refreshed for selected match." });
    } catch (e: unknown) {
      setNotice({
        tone: "error",
        message: (e as { message?: string })?.message || "Failed to inspect selected loop.",
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function activateSelectedLoop() {
    if (!selectedMatch || activating) return;

    setActivating(true);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/live-micro/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "activate_match",
          provider_match_id: selectedMatch.provider_event_id,
          provider_name: selectedMatch.provider || "api-football",
        }),
      });

      const json = (await res.json().catch(() => ({}))) as TriggerActivateResponse;
      if (!res.ok || !json.ok) {
        throw new Error(friendlyApiError(json.error || `HTTP ${res.status}`));
      }

      if (json.result?.loop) {
        setLoops((prev) => {
          const byId = new Map<string, LiveMicroLoop>();
          byId.set(json.result!.loop!.id, json.result!.loop!);
          for (const loop of prev) byId.set(loop.id, loop);
          return Array.from(byId.values()).sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          );
        });
      }

      const base = friendlyActivationReason(json.result?.reason);
      const firstMarketId = json.result?.firstMarket?.liveMicroId;
      const details = firstMarketId ? ` First market: ${firstMarketId}.` : "";

      setNotice({
        tone: "ok",
        message: `${base}${details}`,
      });
      await loadLoops({ silent: true });
    } catch (e: unknown) {
      setNotice({
        tone: "error",
        message: (e as { message?: string })?.message || "Failed to activate loop.",
      });
    } finally {
      setActivating(false);
    }
  }

  async function resumeLoop(loop: LiveMicroLoop) {
    if (resumingLoopId) return;
    setResumingLoopId(loop.id);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/live-micro/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "resume_loop",
          loop_id: loop.id,
          provider_match_id: loop.provider_match_id,
          provider_name: loop.provider_name,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as TriggerResumeResponse;
      if (!res.ok || !json.ok) {
        throw new Error(friendlyApiError(json.error || `HTTP ${res.status}`));
      }

      const resumed = json.result?.resumed;
      const reason = String(json.result?.reason || "").trim();
      const summary = resumed
        ? reason === "manual_resume_retry_scheduled"
          ? "Loop resume requested. Reconcile hit a temporary error and retry was scheduled."
          : reason === "manual_resume_retry_exhausted"
          ? "Loop resume requested but retry budget is exhausted."
          : "Loop resumed and immediate reconcile triggered."
        : reason === "manual_resume_blocked_match_finished"
        ? "Loop not resumed because provider reports the match as finished."
        : reason === "manual_resume_blocked_hard_stop"
        ? "Loop not resumed because hard stop conditions are already met."
        : reason === "loop_already_ended"
        ? "Loop is already ended."
        : reason === "loop_not_found"
        ? "Loop not found."
        : reason === "manual_resume_failed_non_retryable"
        ? "Loop resume failed with a non-retryable error."
        : `Resume not applied (${reason || "unknown reason"}).`;

      if (json.result?.loop) {
        setLoops((prev) => {
          const byId = new Map<string, LiveMicroLoop>();
          for (const row of prev) byId.set(row.id, row);
          byId.set(json.result!.loop!.id, json.result!.loop!);
          return Array.from(byId.values()).sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          );
        });
      }

      setNotice({
        tone: resumed ? "ok" : "neutral",
        message: summary,
      });
      await loadLoops({ silent: true });
    } catch (e: unknown) {
      setNotice({
        tone: "error",
        message: (e as { message?: string })?.message || "Failed to resume loop.",
      });
    } finally {
      setResumingLoopId(null);
    }
  }

  async function stopLoop(loop: LiveMicroLoop) {
    if (stoppingLoopId) return;
    setStoppingLoopId(loop.id);
    setNotice(null);

    try {
      const res = await fetch("/api/admin/live-micro/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "stop_loop",
          loop_id: loop.id,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as TriggerStopResponse;
      if (!res.ok || !json.ok) {
        throw new Error(friendlyApiError(json.error || `HTTP ${res.status}`));
      }

      const stopped = json.result?.stopped;
      const reason = String(json.result?.reason || "").trim();
      const summary = stopped
        ? "Loop stopped manually."
        : reason === "manual_stop_already_applied"
        ? "Loop is already manually stopped."
        : reason === "loop_already_ended"
        ? "Loop is already ended."
        : reason === "loop_not_found"
        ? "Loop not found."
        : `Stop not applied (${reason || "unknown reason"}).`;

      if (json.result?.loop) {
        setLoops((prev) => {
          const byId = new Map<string, LiveMicroLoop>();
          for (const row of prev) byId.set(row.id, row);
          byId.set(json.result!.loop!.id, json.result!.loop!);
          return Array.from(byId.values()).sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          );
        });
      }

      setNotice({
        tone: stopped ? "ok" : "neutral",
        message: summary,
      });
      await loadLoops({ silent: true });
    } catch (e: unknown) {
      setNotice({
        tone: "error",
        message: (e as { message?: string })?.message || "Failed to stop loop.",
      });
    } finally {
      setStoppingLoopId(null);
    }
  }

  const selectedMatchStatus = selectedMatch ? normalizeMatchStatus(selectedMatch.status) : "unknown";
  const selectedMatchTime = selectedMatch
    ? parseEventStartDate(selectedMatch.start_time, extractEventTimeZone(selectedMatch))
    : null;

  return (
    <>
      <div className="card-pump p-4 md:p-5 mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base md:text-lg font-bold text-white">Live Micro Control</h3>
            <p className="text-xs md:text-sm text-gray-400 mt-1">
              Activate live soccer loops for selected matches. Manual selection, automated execution.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadLoops({ silent: true })}
            disabled={refreshing}
            className="px-3 py-2 rounded-lg border border-white/15 bg-white/5 text-gray-200 text-xs md:text-sm hover:bg-white/10 transition disabled:opacity-60 inline-flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh statuses
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-gray-400 uppercase tracking-wide">Selected Match</div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="px-2.5 py-1 rounded-md bg-pump-green text-black text-xs font-semibold hover:opacity-90 transition"
                >
                  Pick a live soccer match
                </button>
              </div>

              {!selectedMatch ? (
                <p className="text-sm text-gray-500 mt-3">No match selected yet.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  <div className="text-sm font-semibold text-white">
                    {selectedMatch.home_team} vs {selectedMatch.away_team}
                  </div>
                  <div className="text-xs text-gray-400">{selectedMatch.league || "League unavailable"}</div>
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    <span className={`px-2 py-0.5 rounded-full border ${matchStatusTone(selectedMatchStatus)}`}>
                      {toReadableStatus(selectedMatchStatus)}
                    </span>
                    <span className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-gray-300 font-mono">
                      {selectedMatch.provider}:{selectedMatch.provider_event_id}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Kickoff: {selectedMatchTime ? formatDateTime(selectedMatchTime.toISOString()) : "Unavailable"}
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={activateSelectedLoop}
                  disabled={!selectedMatch || activating}
                  className="px-3 py-2 rounded-lg bg-pump-green text-black text-xs md:text-sm font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2 transition"
                >
                  {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Activate live loop
                </button>
                <button
                  type="button"
                  onClick={inspectSelectedLoop}
                  disabled={!selectedMatch || refreshing}
                  className="px-3 py-2 rounded-lg border border-white/15 bg-white/5 text-gray-200 text-xs md:text-sm hover:bg-white/10 disabled:opacity-50 transition"
                >
                  Inspect selected
                </button>
              </div>
            </div>

            {notice && (
              <div
                className={`rounded-lg border p-3 text-xs md:text-sm ${
                  notice.tone === "ok"
                    ? "border-pump-green/40 bg-pump-green/10 text-pump-green"
                    : notice.tone === "error"
                    ? "border-red-500/40 bg-red-500/10 text-red-300"
                    : "border-white/15 bg-white/5 text-gray-300"
                }`}
              >
                {notice.tone === "ok" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {notice.message}
                  </span>
                ) : (
                  notice.message
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Activated Loops</div>
              <div className="text-[11px] text-gray-500">{loops.length} shown</div>
            </div>

            {loopsLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading loop statuses...
              </div>
            ) : loopsError ? (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                {loopsError}
              </div>
            ) : loops.length === 0 ? (
              <div className="py-6 text-sm text-gray-500">No activated loops found yet.</div>
            ) : (
              <div className="mt-3 space-y-2 max-h-[320px] overflow-y-auto pr-1">
                {loops.map((loop) => {
                  const label = loopMatchLabel(loop, knownMatchesById);
                  const league = loopLeague(loop, knownMatchesById);
                  const retryInfo = readLoopRetryInfo(loop);
                  const displayStatus = loopDisplayStatus(loop);
                  const canResume =
                    loop.loop_status === "error" ||
                    loop.loop_status === "halftime" ||
                    displayStatus === "retrying" ||
                    displayStatus === "stopped";
                  const canStop = loop.loop_status !== "ended";
                  const isResuming = resumingLoopId === loop.id;
                  const isStopping = stoppingLoopId === loop.id;
                  return (
                    <div key={loop.id} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium text-white truncate">{label}</div>
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${loopPhaseTone(loop.loop_phase)}`}>
                            {loop.loop_phase.replace("_", " ")}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-medium ${loopStatusTone(displayStatus)}`}>
                            {displayStatus}
                          </span>
                        </div>
                      </div>

                      <div className="mt-1.5 text-[11px] text-gray-400 flex flex-wrap gap-x-3 gap-y-1">
                        <span className="font-mono">id: {loop.provider_match_id}</span>
                        {league ? <span>{league}</span> : null}
                        <span>1H: {loop.first_half_count}</span>
                        <span>2H: {loop.second_half_count}</span>
                        <span>active market: {loop.current_active_live_micro_id ? "yes" : "no"}</span>
                        <span>updated: {formatDateTime(loop.updated_at)}</span>
                      </div>

                      {displayStatus === "retrying" ? (
                        <div className="mt-1 text-[11px] text-amber-300">
                          retry: {retryInfo.retryCount}/{retryInfo.maxAttempts}
                          {retryInfo.nextRetryAt ? ` • next: ${formatDateTime(retryInfo.nextRetryAt)}` : ""}
                        </div>
                      ) : null}

                      {loop.stop_reason ? (
                        <div className="mt-1 text-[11px] text-gray-400">
                          stop reason: <span className="text-gray-300">{loop.stop_reason}</span>
                        </div>
                      ) : null}

                      {retryInfo.lastError ? (
                        <div className="mt-1 text-[11px] text-red-300">
                          last error: {retryInfo.lastError}
                          {retryInfo.lastErrorAt ? ` (${formatDateTime(retryInfo.lastErrorAt)})` : ""}
                        </div>
                      ) : null}

                      {loop.error_message ? (
                        <div className="mt-1 text-[11px] text-red-300">error: {loop.error_message}</div>
                      ) : null}

                      {canResume || canStop ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void resumeLoop(loop)}
                            disabled={!canResume || !!resumingLoopId || !!stoppingLoopId}
                            className="px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-gray-200 text-[11px] hover:bg-white/10 disabled:opacity-50 transition inline-flex items-center gap-1.5"
                          >
                            {isResuming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                            Resume loop
                          </button>
                          <button
                            type="button"
                            onClick={() => void stopLoop(loop)}
                            disabled={!canStop || !!resumingLoopId || !!stoppingLoopId}
                            className="px-2.5 py-1.5 rounded-md border border-red-500/25 bg-red-500/10 text-red-200 text-[11px] hover:bg-red-500/20 disabled:opacity-50 transition inline-flex items-center gap-1.5"
                          >
                            {isStopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                            Stop loop
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <SoccerMatchPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelectMatch={(match) => {
          rememberMatch(match);
          setSelectedMatch(match);
          setNotice(null);
        }}
      />
    </>
  );
}
