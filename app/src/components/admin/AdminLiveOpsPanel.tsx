"use client";

// Live Operations — operator control center.
// Reuses the existing Admin design language (card-pump, pills, drawers).
// Lets an operator find any live session in seconds and disable it for
// compliance / moderation. It does NOT touch Host Controls or trading.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { parseStream } from "@/lib/streamProviders";
import type { DisableReason, LiveSessionStatus } from "@/lib/liveSessions";

type AdminLiveSession = {
  id: string;
  created_at: string;
  title: string;
  market_address: string;
  host_wallet: string;
  stream_url: string;
  status: LiveSessionStatus;
  started_at: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
  disable_reason: string | null;
};

type StatusGroup = "live" | "scheduled" | "ended" | "disabled";

const GROUP_META: Record<
  StatusGroup,
  { label: string; icon: string; tone: string }
> = {
  live: { label: "LIVE", icon: "🔴", tone: "text-red-400" },
  scheduled: { label: "Scheduled", icon: "🟢", tone: "text-pump-green" },
  ended: { label: "Ended", icon: "⚫", tone: "text-gray-400" },
  disabled: { label: "Disabled", icon: "🚫", tone: "text-orange-400" },
};

const DISABLE_REASONS: { value: DisableReason; label: string }[] = [
  { value: "dmca", label: "DMCA" },
  { value: "copyright", label: "Copyright" },
  { value: "creator_request", label: "Creator request" },
  { value: "platform_request", label: "Platform request" },
  { value: "terms_violation", label: "Terms violation" },
  { value: "manual", label: "Manual" },
];

const REASON_LABELS: Record<string, string> = Object.fromEntries(
  DISABLE_REASONS.map((r) => [r.value, r.label]),
);

function reasonLabel(code?: string | null): string {
  if (!code) return "—";
  return REASON_LABELS[code] || code;
}

function groupForStatus(status: LiveSessionStatus): StatusGroup {
  switch (status) {
    case "live":
    case "locked":
      return "live";
    case "scheduled":
      return "scheduled";
    case "disabled":
      return "disabled";
    default:
      return "ended"; // ended | resolved | cancelled
  }
}

function shortAddr(a?: string | null) {
  if (!a) return "—";
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-6)}`;
}

function formatDate(x?: string | null) {
  if (!x) return "—";
  const d = new Date(x);
  if (!Number.isFinite(d.getTime())) return "—";
  return (
    d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }) +
    " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

function StatusPill({ status }: { status: LiveSessionStatus }) {
  const g = groupForStatus(status);
  const cls =
    g === "live"
      ? "border-red-600/40 bg-red-600/20 text-red-400"
      : g === "scheduled"
      ? "border-pump-green/40 bg-pump-green/10 text-pump-green"
      : g === "disabled"
      ? "border-orange-500/40 bg-orange-500/10 text-orange-400"
      : "border-white/10 bg-white/5 text-gray-300";
  return (
    <span
      className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}

const ROWS_PER_PAGE = 20;

export default function AdminLiveOpsPanel() {
  const [sessions, setSessions] = useState<AdminLiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<StatusGroup | "all">("all");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);

  // Disable dialog state
  const [disableTarget, setDisableTarget] = useState<AdminLiveSession | null>(null);
  const [disableReason, setDisableReason] = useState<DisableReason | "">("");
  const [addToBlocklist, setAddToBlocklist] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [dialogErr, setDialogErr] = useState<string | null>(null);

  // Restore (re-enable a disabled session)
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/live-sessions?t=${Date.now()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setSessions((j?.sessions || []) as AdminLiveSession[]);
    } catch (e: any) {
      setErr(e?.message || "Failed to load live sessions");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Enrich + filter + sort.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const enriched = sessions.map((s) => {
      const parsed = parseStream(s.stream_url);
      return { session: s, parsed, group: groupForStatus(s.status) };
    });

    const filtered = enriched.filter(({ session, parsed, group }) => {
      if (groupFilter !== "all" && group !== groupFilter) return false;
      if (!q) return true;
      const haystack = [
        session.title,
        parsed.providerLabel,
        session.host_wallet,
        parsed.videoId,
        parsed.channel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

    filtered.sort((a, b) => {
      const at = new Date(a.session.started_at || a.session.created_at).getTime();
      const bt = new Date(b.session.started_at || b.session.created_at).getTime();
      return sortDir === "asc" ? at - bt : bt - at;
    });

    return filtered;
  }, [sessions, search, groupFilter, sortDir]);

  const counts = useMemo(() => {
    const c: Record<StatusGroup, number> = {
      live: 0,
      scheduled: 0,
      ended: 0,
      disabled: 0,
    };
    for (const s of sessions) c[groupForStatus(s.status)] += 1;
    return c;
  }, [sessions]);

  // Pagination — keeps the table compact (mirrors the Resolutions section).
  const totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  // Reset to page 1 whenever filters / search / sort change the result set.
  useEffect(() => {
    setPage(1);
  }, [search, groupFilter, sortDir]);
  // Clamp the current page if the row count shrinks (e.g. after a disable).
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);
  const pagedRows = useMemo(
    () => rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE),
    [rows, page],
  );

  function openDisable(session: AdminLiveSession) {
    setDisableTarget(session);
    setDisableReason("");
    setAddToBlocklist(false);
    setDialogErr(null);
  }

  function closeDisable() {
    setDisableTarget(null);
    setDisableReason("");
    setAddToBlocklist(false);
    setDialogErr(null);
    setDisabling(false);
  }

  async function confirmDisable() {
    if (!disableTarget || !disableReason) return;
    setDisabling(true);
    setDialogErr(null);
    try {
      const r = await fetch("/api/admin/live-sessions/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          session_id: disableTarget.id,
          reason: disableReason,
          add_to_blocklist: addToBlocklist,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      closeDisable();
      await load();
    } catch (e: any) {
      setDialogErr(e?.message || "Failed to disable");
      setDisabling(false);
    }
  }

  // Restore a mistakenly disabled session (admin-only). The server sets the
  // status back to "live" and preserves the disable audit columns as history.
  // No data is deleted.
  async function restoreSession(session: AdminLiveSession) {
    setRestoringId(session.id);
    try {
      const r = await fetch("/api/admin/live-sessions/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ session_id: session.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to restore live session");
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Status summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(Object.keys(GROUP_META) as StatusGroup[]).map((g) => (
          <button
            key={g}
            onClick={() => setGroupFilter((prev) => (prev === g ? "all" : g))}
            className={`card-pump p-3 text-left transition ${
              groupFilter === g ? "ring-1 ring-pump-green/50" : ""
            }`}
          >
            <div className={`text-xs ${GROUP_META[g].tone}`}>
              {GROUP_META[g].icon} {GROUP_META[g].label}
            </div>
            <div className="text-2xl font-bold text-white mt-1">{counts[g]}</div>
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-pump-dark-lighter rounded-lg p-1">
          {(["all", "live", "scheduled", "ended", "disabled"] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroupFilter(g)}
              className={`px-3 py-2 rounded-lg text-xs md:text-sm font-medium transition ${
                groupFilter === g
                  ? "bg-white/10 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {g === "all" ? "All" : GROUP_META[g].label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
          className="flex items-center gap-1 px-3 py-2 rounded-lg bg-pump-dark-lighter text-gray-300 text-xs md:text-sm hover:text-white transition"
        >
          Started {sortDir === "desc" ? "↓" : "↑"}
        </button>

        <button
          onClick={() => void load()}
          className="px-3 py-2 rounded-lg bg-pump-dark-lighter text-gray-300 text-xs md:text-sm hover:text-white transition"
        >
          Refresh
        </button>

        <div className="flex-1" />

        <input
          type="text"
          placeholder="Search title, provider, host, video ID, channel…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full md:w-80 px-3 md:px-4 py-2 rounded-lg bg-white text-black placeholder-gray-500 border border-white/20 text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-pump-green"
        />
      </div>

      {/* Table */}
      <div className="card-pump overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-white/10">
                {["Event", "Host", "Provider", "Video / Channel", "Stream URL", "Started", "Status", "Action"].map(
                  (h) => (
                    <th
                      key={h}
                      className="text-left text-[10px] md:text-xs text-gray-500 uppercase tracking-wide px-3 py-3 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    Loading live sessions…
                  </td>
                </tr>
              ) : err ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-red-300">
                    {err}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No live sessions match.
                  </td>
                </tr>
              ) : (
                pagedRows.map(({ session, parsed, group }) => (
                  <tr
                    key={session.id}
                    className={`border-b border-white/5 transition ${
                      group === "disabled"
                        ? "bg-orange-500/[0.08] hover:bg-orange-500/[0.14] border-l-2 border-l-orange-500/70"
                        : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <td className="px-3 py-3">
                      <div className="text-white font-medium truncate max-w-[220px] text-sm">
                        {session.title || "(Untitled)"}
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {shortAddr(session.market_address)}
                      </div>
                      {group === "disabled" && (
                        <div className="text-[10px] text-orange-300/90 mt-1 leading-snug space-y-0.5">
                          <div>Reason: {reasonLabel(session.disable_reason)}</div>
                          <div>Disabled: {formatDate(session.disabled_at)}</div>
                          {session.disabled_by && (
                            <div>By: {shortAddr(session.disabled_by)}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-300 font-mono whitespace-nowrap">
                      {shortAddr(session.host_wallet)}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-300 whitespace-nowrap">
                      {parsed.providerLabel || "—"}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-300 whitespace-nowrap">
                      {parsed.videoId || parsed.channel || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <a
                        href={session.stream_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-pump-green hover:underline truncate inline-block max-w-[180px] align-bottom"
                      >
                        {session.stream_url}
                      </a>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-400 whitespace-nowrap">
                      {formatDate(session.started_at || session.created_at)}
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill status={session.status} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <a
                          href={`/live/${session.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition"
                        >
                          View
                        </a>
                        {session.status === "disabled" ? (
                          <button
                            onClick={() => restoreSession(session)}
                            disabled={restoringId === session.id}
                            className="px-2 py-1.5 rounded-lg bg-pump-green text-black text-xs font-semibold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {restoringId === session.id ? "Restoring…" : "Restore Live"}
                          </button>
                        ) : (
                          <button
                            onClick={() => openDisable(session)}
                            className="px-2 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition"
                          >
                            Disable Live
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination — Previous / Next (mirrors the Resolutions section) */}
        {!loading && !err && rows.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-3 md:px-4 py-3 border-t border-white/10">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs md:text-sm font-medium hover:bg-white/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <div className="text-xs md:text-sm text-gray-400">
              Page {page} / {totalPages} · {rows.length} total
            </div>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs md:text-sm font-medium hover:bg-white/10 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Disable dialog (Part 5) */}
      {disableTarget && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeDisable} />
          <div className="relative z-[9999] w-full max-w-md card-pump p-5">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              Disable Live
            </div>
            <div className="text-lg font-bold text-white mb-1 truncate">
              {disableTarget.title || "(Untitled)"}
            </div>
            <p className="text-sm text-gray-400 mb-4">
              The stream and all data are kept. The session is marked
              <span className="text-orange-400 font-semibold"> disabled</span> and the
              player stops rendering. Trading and historical data continue to work.
            </p>

            <div className="text-xs text-gray-400 mb-2">Reason</div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {DISABLE_REASONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setDisableReason(r.value)}
                  className={`py-2 rounded-lg text-sm font-medium border transition ${
                    disableReason === r.value
                      ? "border-red-500 bg-red-500/10 text-red-300"
                      : "border-white/10 text-gray-300 hover:border-white/30"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Optional: also block this specific stream from future use. */}
            {(() => {
              const p = parseStream(disableTarget.stream_url);
              const ident = p.videoId
                ? `${p.providerLabel} video ${p.videoId}`
                : p.channel
                ? `${p.providerLabel} channel ${p.channel}`
                : null;
              return (
                <label className="flex items-start gap-2 mb-4 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={addToBlocklist}
                    onChange={(e) => setAddToBlocklist(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-red-500"
                  />
                  <span className="text-sm text-gray-300">
                    Add stream to blocklist
                    <span className="block text-xs text-gray-500">
                      {ident
                        ? `Blocks ${ident} from being used in new sessions.`
                        : "Stream identifier could not be parsed — nothing will be blocked."}
                    </span>
                  </span>
                </label>
              );
            })()}

            {dialogErr && (
              <div className="mb-3 text-sm text-red-400">{dialogErr}</div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={closeDisable}
                disabled={disabling}
                className="px-4 py-2 rounded-lg bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDisable}
                disabled={disabling || !disableReason}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {disabling ? "Disabling…" : "Disable Live"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
