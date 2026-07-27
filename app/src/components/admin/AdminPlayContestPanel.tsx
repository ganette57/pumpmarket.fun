"use client";

// Play Contest — admin section inside /admin/overview.
//
// Reuses the existing Admin design language (card-pump, pills, the
// centred confirm dialog from AdminLiveOpsPanel) and adds no new route.
//
// WHAT THIS PANEL DOES
//   * shows the configured contest period and its live ranking;
//   * freezes that ranking into an immutable snapshot;
//   * verifies the snapshot;
//   * tracks prize payment status, reference and internal notes;
//   * expands each frozen winner into an auditable breakdown of the
//     positions that produced their Profit.
//
// WHAT IT DOES NOT DO
// Send prizes. There is no transfer here, no bonus balance, no trading
// credit, no vault and no chain call. "Mark as paid" records a payment
// that happened somewhere else.
//
// It ranks nothing client-side either: every number rendered below comes
// from /api/admin/play-contests/*, which ranks on the server from
// authoritative play_trades data.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ========= Types (mirror src/lib/playContests.ts) ========= */

type ContestStatus =
  | "draft"
  | "live"
  | "ended"
  | "under_review"
  | "verified"
  | "paid"
  | "cancelled";

type PrizeStatus = "pending" | "verified" | "paid" | "disputed" | "cancelled";

type Contest = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: ContestStatus;
  prize_pool_usd: string;
  first_prize_usd: string;
  second_prize_usd: string;
  third_prize_usd: string;
  frozen_at: string | null;
  verified_at: string | null;
  created_by: string | null;
  frozen_by: string | null;
  verified_by: string | null;
  notes: string | null;
};

type RankingRow = {
  rank: number;
  wallet_address: string;
  username: string | null;
  avatar_url: string | null;
  realized_pnl_usd: string;
  settled_picks: number;
  wins: number;
  losses: number;
  win_rate: string;
  total_settled_stake_usd: string;
};

type ContestResult = RankingRow & {
  id: string;
  contest_id: string;
  prize_amount_usd: string;
  prize_status: PrizeStatus;
  payment_reference: string | null;
  admin_note: string | null;
  frozen_at: string;
  verified_at: string | null;
  paid_at: string | null;
};

type UnresolvedMarket = {
  market_address: string;
  market_title: string | null;
  open_trades: number;
  play_state_status: string | null;
  resolution_status: string | null;
};

type Preview = {
  contest_id: string;
  starts_at: string;
  ends_at: string;
  window_state: "not_started" | "live" | "ended";
  rows: RankingRow[];
  total_players: number;
  truncated: boolean;
  generated_at: string;
  warnings: string[];
  unresolved_markets: UnresolvedMarket[];
};

type AuditPosition = {
  market_address: string;
  market_title: string | null;
  outcome_index: number;
  outcome_name: string | null;
  total_stake_usd: string;
  payout_usd: string;
  realized_pnl_usd: string;
  status: "open" | "won" | "lost" | "refunded";
  trade_count: number;
  settled_at: string;
  winning_outcome: number | null;
  winning_outcome_name: string | null;
};

type WinnerAudit = {
  wallet_address: string;
  username: string | null;
  avatar_url: string | null;
  starts_at: string;
  ends_at: string;
  totals: {
    realized_pnl_usd: string;
    settled_picks: number;
    wins: number;
    losses: number;
    win_rate: string;
    total_settled_stake_usd: string;
  };
  positions: AuditPosition[];
  truncated: boolean;
};

type ContestTab = "preview" | "frozen" | "audit";

/* ========= Formatting ========= */

const PRIZE_STATUSES: PrizeStatus[] = [
  "pending",
  "verified",
  "paid",
  "disputed",
  "cancelled",
];

function shortAddr(a?: string | null) {
  if (!a) return "—";
  if (a.length <= 12) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function fmtUsd(v?: string | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtSignedUsd(v?: string | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${fmtUsd(v)}`;
}

function fmtPct(v?: string | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtUtc(x?: string | null): string {
  if (!x) return "—";
  const d = new Date(x);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** "3d 04h 12m" until `iso`, or null when it has already passed. */
function timeUntil(iso: string, nowMs: number): string | null {
  const ms = new Date(iso).getTime() - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(
    s % 60
  ).padStart(2, "0")}s`;
}

/** A `datetime-local` value read as UTC, not as the operator's local zone. */
function localInputToUtcIso(v: string): string {
  if (!v) return "";
  return `${v.length === 16 ? v : v.slice(0, 16)}:00Z`;
}

function utcIsoToLocalInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16);
}

/* ========= Small UI atoms (same language as the rest of Admin) ========= */

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "ok" | "pink" | "blocked" | "active";
}) {
  const cls =
    tone === "ok"
      ? "border-pump-green/40 bg-pump-green/10 text-pump-green"
      : tone === "warn"
      ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
      : tone === "pink"
      ? "border-[#ff5c73]/40 bg-[#ff5c73]/10 text-[#ff5c73]"
      : tone === "blocked"
      ? "border-red-600/40 bg-red-600/20 text-red-400"
      : tone === "active"
      ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
      : "border-white/10 bg-white/5 text-gray-300";
  return (
    <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

function contestTone(status: ContestStatus) {
  switch (status) {
    case "live":
      return "ok" as const;
    case "under_review":
      return "warn" as const;
    case "verified":
      return "active" as const;
    case "paid":
      return "ok" as const;
    case "cancelled":
      return "blocked" as const;
    default:
      return "neutral" as const;
  }
}

function prizeTone(status: PrizeStatus) {
  switch (status) {
    case "paid":
      return "ok" as const;
    case "verified":
      return "active" as const;
    case "disputed":
      return "pink" as const;
    case "cancelled":
      return "blocked" as const;
    default:
      return "warn" as const;
  }
}

function PlayerCell({ row }: { row: { wallet_address: string; username: string | null; avatar_url: string | null } }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {row.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.avatar_url}
          alt=""
          className="h-6 w-6 rounded-full object-cover shrink-0 border border-white/10"
        />
      ) : (
        <div className="h-6 w-6 rounded-full bg-white/10 shrink-0" />
      )}
      <div className="min-w-0">
        <div className="text-white text-sm font-medium truncate max-w-[140px]">
          {row.username || shortAddr(row.wallet_address)}
        </div>
        <div className="text-[10px] text-gray-500 font-mono truncate max-w-[140px]">
          {shortAddr(row.wallet_address)}
        </div>
      </div>
    </div>
  );
}

/* ========= Fetch helpers ========= */

async function postJSON<T>(url: string, body: object): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j as T;
}

/* ========= Panel ========= */

export default function AdminPlayContestPanel() {
  const [contest, setContest] = useState<Contest | null>(null);
  const [results, setResults] = useState<ContestResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);

  const [tab, setTab] = useState<ContestTab>("preview");
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);

  // Freeze / verify dialogs
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [freezeAck, setFreezeAck] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [freezeErr, setFreezeErr] = useState<string | null>(null);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);

  // Winner audit (expanded row)
  const [expanded, setExpanded] = useState<string | null>(null);
  const [audits, setAudits] = useState<Record<string, WinnerAudit>>({});
  const [auditLoading, setAuditLoading] = useState<string | null>(null);
  const [auditErr, setAuditErr] = useState<string | null>(null);

  // Per-row prize-tracking edits
  const [edits, setEdits] = useState<
    Record<string, { payment_reference: string; admin_note: string }>
  >({});
  const [savingRow, setSavingRow] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [form, setForm] = useState(() => defaultForm());

  const noticeTimer = useRef<number | null>(null);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/play-contests/current?t=${Date.now()}`, {
        credentials: "include",
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setContest((j?.contest ?? null) as Contest | null);
      setResults((j?.results ?? []) as ContestResult[]);
    } catch (e: any) {
      setErr(e?.message || "Failed to load the Play contest");
      setContest(null);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const refreshPreview = useCallback(async () => {
    if (!contest) return;
    setPreviewLoading(true);
    setPreviewErr(null);
    try {
      const j = await postJSON<{ preview: Preview; contest: Contest }>(
        "/api/admin/play-contests/preview",
        { contest_id: contest.id }
      );
      setPreview(j.preview);
      setContest(j.contest);
    } catch (e: any) {
      setPreviewErr(e?.message || "Failed to build the live preview");
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [contest]);

  // First preview once a contest is known. Never automatic after that —
  // the operator refreshes deliberately, so a number cannot change under
  // them while they are reading it.
  const previewedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!contest) return;
    if (previewedFor.current === contest.id) return;
    previewedFor.current = contest.id;
    void refreshPreview();
  }, [contest, refreshPreview]);

  /* ----- actions ----- */

  async function doFreeze() {
    if (!contest) return;
    setFreezing(true);
    setFreezeErr(null);
    try {
      const needsOverride = freezeNeedsOverride;
      const j = await postJSON<{
        froze: boolean;
        contest: Contest;
        results: ContestResult[];
        message: string;
      }>("/api/admin/play-contests/freeze", {
        contest_id: contest.id,
        override_unresolved: needsOverride.unresolved ? freezeAck : false,
        override_not_ended: needsOverride.notEnded ? freezeAck : false,
      });
      setContest(j.contest);
      setResults(j.results);
      setFreezeOpen(false);
      setFreezeAck(false);
      setTab("frozen");
      flash(j.message);
    } catch (e: any) {
      setFreezeErr(e?.message || "Freeze failed");
    } finally {
      setFreezing(false);
    }
  }

  async function doVerify() {
    if (!contest) return;
    setVerifying(true);
    setVerifyErr(null);
    try {
      const j = await postJSON<{
        verified: boolean;
        contest: Contest;
        results: ContestResult[];
        message: string;
      }>("/api/admin/play-contests/verify", { contest_id: contest.id });
      setContest(j.contest);
      setResults(j.results);
      setVerifyOpen(false);
      flash(j.message);
    } catch (e: any) {
      setVerifyErr(e?.message || "Verify failed");
    } finally {
      setVerifying(false);
    }
  }

  async function saveRow(row: ContestResult, nextStatus?: PrizeStatus) {
    if (!contest) return;
    setSavingRow(row.id);
    setRowErr((p) => ({ ...p, [row.id]: "" }));
    try {
      const edit = edits[row.id] ?? {
        payment_reference: row.payment_reference ?? "",
        admin_note: row.admin_note ?? "",
      };
      const j = await postJSON<{
        result: ContestResult;
        contest: Contest | null;
        message: string;
      }>("/api/admin/play-contests/result/update", {
        contest_id: contest.id,
        result_id: row.id,
        prize_status: nextStatus,
        payment_reference: edit.payment_reference,
        admin_note: edit.admin_note,
      });
      setResults((prev) => prev.map((r) => (r.id === j.result.id ? j.result : r)));
      if (j.contest) setContest(j.contest);
      flash(j.message);
    } catch (e: any) {
      setRowErr((p) => ({ ...p, [row.id]: e?.message || "Update failed" }));
    } finally {
      setSavingRow(null);
    }
  }

  async function toggleAudit(wallet: string) {
    if (expanded === wallet) {
      setExpanded(null);
      return;
    }
    setExpanded(wallet);
    setAuditErr(null);
    if (audits[wallet] || !contest) return;
    setAuditLoading(wallet);
    try {
      const j = await postJSON<{ audit: WinnerAudit }>(
        "/api/admin/play-contests/audit",
        { contest_id: contest.id, wallet }
      );
      setAudits((prev) => ({ ...prev, [wallet]: j.audit }));
    } catch (e: any) {
      setAuditErr(e?.message || "Failed to load the winner audit");
    } finally {
      setAuditLoading(null);
    }
  }

  async function doCreate() {
    setCreating(true);
    setCreateErr(null);
    try {
      const j = await postJSON<{ contest: Contest }>(
        "/api/admin/play-contests/create",
        {
          name: form.name,
          starts_at: localInputToUtcIso(form.starts_at),
          ends_at: localInputToUtcIso(form.ends_at),
          prize_pool_usd: form.prize_pool_usd,
          first_prize_usd: form.first_prize_usd,
          second_prize_usd: form.second_prize_usd,
          third_prize_usd: form.third_prize_usd,
        }
      );
      setContest(j.contest);
      setResults([]);
      setShowCreate(false);
      previewedFor.current = null;
      flash(`Contest "${j.contest.name}" created.`);
    } catch (e: any) {
      setCreateErr(e?.message || "Failed to create the contest");
    } finally {
      setCreating(false);
    }
  }

  /* ----- derived ----- */

  const remaining = contest ? timeUntil(contest.ends_at, now) : null;
  const notStarted = contest ? timeUntil(contest.starts_at, now) : null;

  const freezeNeedsOverride = useMemo(() => {
    const unresolved = (preview?.unresolved_markets?.length ?? 0) > 0;
    const notEnded = preview ? preview.window_state !== "ended" : false;
    return { unresolved, notEnded, any: unresolved || notEnded };
  }, [preview]);

  const isFrozen = !!contest?.frozen_at;
  const isVerified = !!contest?.verified_at;

  const prizeRows = useMemo(
    () => results.filter((r) => Number(r.prize_amount_usd) > 0),
    [results]
  );
  const paidCount = prizeRows.filter((r) => r.prize_status === "paid").length;
  const disputedCount = results.filter((r) => r.prize_status === "disputed").length;

  /* ----- render ----- */

  if (loading) {
    return (
      <div className="card-pump p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">
          Play Contest
        </div>
        <div className="space-y-2 animate-pulse">
          <div className="h-4 w-40 rounded bg-white/10" />
          <div className="h-3 w-64 rounded bg-white/5" />
          <div className="h-3 w-52 rounded bg-white/5" />
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="card-pump p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          Play Contest
        </div>
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {err}
        </div>
        <button
          onClick={() => void load()}
          className="mt-3 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-sm font-medium hover:bg-white/10 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!contest) {
    return (
      <div className="card-pump p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
          Play Contest
        </div>
        <div className="text-sm text-gray-400">No Play contest configured.</div>

        {!showCreate ? (
          <button
            onClick={() => setShowCreate(true)}
            className="mt-3 px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:opacity-90 transition"
          >
            Create contest
          </button>
        ) : (
          <CreateForm
            form={form}
            setForm={setForm}
            creating={creating}
            error={createErr}
            onCancel={() => setShowCreate(false)}
            onSubmit={doCreate}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ===== Summary ===== */}
      <div className="card-pump p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-gray-500 uppercase tracking-wide">
              Play Contest
            </div>
            <div className="text-lg md:text-xl font-bold text-white mt-1 break-words">
              {contest.name}
            </div>
            <div className="text-xs md:text-sm text-gray-400 mt-1">
              {fmtUtc(contest.starts_at)} → {fmtUtc(contest.ends_at)}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={contestTone(contest.status)}>{contest.status}</Pill>
            {isFrozen ? <Pill tone="active">Frozen</Pill> : <Pill tone="warn">Live preview</Pill>}
            {isVerified ? <Pill tone="ok">Verified</Pill> : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">
              Prize pool
            </div>
            <div className="text-lg font-bold text-white mt-0.5">
              {fmtUsd(contest.prize_pool_usd)}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">
              {fmtUsd(contest.first_prize_usd)} / {fmtUsd(contest.second_prize_usd)} /{" "}
              {fmtUsd(contest.third_prize_usd)}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">
              {notStarted ? "Starts in" : remaining ? "Time remaining" : "State"}
            </div>
            <div className="text-lg font-bold text-white mt-0.5 tabular-nums">
              {notStarted || remaining || "Ended"}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">{contest.timezone}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">
              Frozen at
            </div>
            <div className="text-sm font-semibold text-white mt-1 break-words">
              {contest.frozen_at ? fmtUtc(contest.frozen_at) : "Not frozen"}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">
              Prizes recorded paid
            </div>
            <div className="text-lg font-bold text-white mt-0.5">
              {prizeRows.length ? `${paidCount} / ${prizeRows.length}` : "—"}
            </div>
            {disputedCount > 0 ? (
              <div className="text-[10px] text-[#ff5c73] mt-0.5">
                {disputedCount} disputed
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void refreshPreview()}
            disabled={previewLoading}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-xs md:text-sm font-medium hover:bg-white/10 transition disabled:opacity-50"
          >
            {previewLoading ? "Refreshing…" : "Refresh preview"}
          </button>
          <button
            onClick={() => {
              setFreezeErr(null);
              setFreezeAck(false);
              setFreezeOpen(true);
            }}
            disabled={isFrozen}
            className="px-3 py-2 rounded-lg bg-pump-green text-black text-xs md:text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isFrozen ? "Results frozen" : "Freeze results"}
          </button>
          <button
            onClick={() => {
              setVerifyErr(null);
              setVerifyOpen(true);
            }}
            disabled={!isFrozen || isVerified}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-xs md:text-sm font-medium hover:bg-white/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isVerified ? "Verified" : "Verify results"}
          </button>
        </div>

        {notice ? (
          <div className="mt-3 rounded-lg border border-pump-green/30 bg-pump-green/10 px-3 py-2 text-xs md:text-sm text-pump-green">
            {notice}
          </div>
        ) : null}
      </div>

      {/* ===== Tabs ===== */}
      <div className="flex items-center gap-1 bg-pump-dark-lighter rounded-lg p-1 w-fit max-w-full overflow-x-auto">
        {(
          [
            { id: "preview" as const, label: "Live Preview" },
            { id: "frozen" as const, label: `Frozen Winners${results.length ? ` (${results.length})` : ""}` },
            { id: "audit" as const, label: "Audit" },
          ]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition whitespace-nowrap ${
              tab === t.id ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== Live preview ===== */}
      {tab === "preview" ? (
        <div className="card-pump p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-white">
                Live preview — results may still change.
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Calculated from current Play data. Nothing here is a stored winner.
                {preview ? ` Generated ${fmtUtc(preview.generated_at)}.` : ""}
              </div>
            </div>
            {preview ? (
              <Pill tone="neutral">{preview.total_players} eligible players</Pill>
            ) : null}
          </div>

          {preview?.warnings?.length ? (
            <div className="mt-3 space-y-2">
              {preview.warnings.map((w) => (
                <div
                  key={w}
                  className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300"
                >
                  ⚠ {w}
                </div>
              ))}
            </div>
          ) : null}

          {previewErr ? (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {previewErr}
              <button
                onClick={() => void refreshPreview()}
                className="ml-3 underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          ) : previewLoading && !preview ? (
            <div className="mt-4 space-y-2 animate-pulse">
              <div className="h-8 rounded bg-white/5" />
              <div className="h-8 rounded bg-white/5" />
              <div className="h-8 rounded bg-white/5" />
            </div>
          ) : !preview || preview.rows.length === 0 ? (
            <div className="mt-4 text-sm text-gray-500">
              No eligible settled Play results yet.
            </div>
          ) : (
            <RankingTable rows={preview.rows} contest={contest} />
          )}
        </div>
      ) : null}

      {/* ===== Frozen winners ===== */}
      {tab === "frozen" ? (
        <div className="card-pump p-4">
          {!isFrozen ? (
            <div className="text-sm text-gray-500">
              Nothing frozen yet. Freeze the results to create the snapshot prizes are
              paid against.
            </div>
          ) : (
            <>
              <div className="text-sm font-semibold text-white">
                Results frozen at {fmtUtc(contest.frozen_at)}.
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Immutable. Settlements landing after this timestamp change the live
                preview and the public leaderboard — they do not change one value below.
              </div>

              <div className="mt-4 space-y-3">
                {results.map((row) => (
                  <FrozenWinnerRow
                    key={row.id}
                    row={row}
                    expanded={expanded === row.wallet_address}
                    audit={audits[row.wallet_address] ?? null}
                    auditLoading={auditLoading === row.wallet_address}
                    auditErr={expanded === row.wallet_address ? auditErr : null}
                    edit={
                      edits[row.id] ?? {
                        payment_reference: row.payment_reference ?? "",
                        admin_note: row.admin_note ?? "",
                      }
                    }
                    onEdit={(patch) =>
                      setEdits((prev) => ({
                        ...prev,
                        [row.id]: {
                          ...(prev[row.id] ?? {
                            payment_reference: row.payment_reference ?? "",
                            admin_note: row.admin_note ?? "",
                          }),
                          ...patch,
                        },
                      }))
                    }
                    saving={savingRow === row.id}
                    error={rowErr[row.id] || null}
                    onToggle={() => void toggleAudit(row.wallet_address)}
                    onSave={(status) => void saveRow(row, status)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* ===== Audit ===== */}
      {tab === "audit" ? (
        <div className="card-pump p-4 space-y-4">
          <div>
            <div className="text-sm font-semibold text-white">Contest integrity</div>
            <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
              <AuditFact label="Contest id" value={contest.id} mono />
              <AuditFact label="Ranking window (UTC)" value={`${fmtUtc(contest.starts_at)} → ${fmtUtc(contest.ends_at)}`} />
              <AuditFact label="Eligibility timestamp" value="play_trades.settled_at" mono />
              <AuditFact label="Frozen at" value={contest.frozen_at ? fmtUtc(contest.frozen_at) : "Not frozen"} />
              <AuditFact label="Frozen by" value={contest.frozen_by ? shortAddr(contest.frozen_by) : "—"} mono />
              <AuditFact label="Verified at" value={contest.verified_at ? fmtUtc(contest.verified_at) : "Not verified"} />
              <AuditFact label="Verified by" value={contest.verified_by ? shortAddr(contest.verified_by) : "—"} mono />
              <AuditFact label="Created by" value={contest.created_by ? shortAddr(contest.created_by) : "—"} mono />
              <AuditFact
                label="Preview scan"
                value={preview ? (preview.truncated ? "TRUNCATED — totals partial" : "Complete") : "Not run"}
              />
            </dl>
          </div>

          <div>
            <div className="text-sm font-semibold text-white">
              Unresolved markets with contest-period Play activity
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Markets holding open Play positions placed inside the window. Freezing
              while these are pending permanently excludes those picks.
            </div>

            {!preview ? (
              <div className="mt-3 text-sm text-gray-500">
                Refresh the preview to run this audit.
              </div>
            ) : preview.unresolved_markets.length === 0 ? (
              <div className="mt-3 text-sm text-pump-green">
                None — every contest-period Play position is settled.
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide">
                      <th className="text-left py-2 pr-3">Market</th>
                      <th className="text-right py-2 px-3">Open picks</th>
                      <th className="text-left py-2 px-3">Play state</th>
                      <th className="text-left py-2 pl-3">Real status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.unresolved_markets.map((m) => (
                      <tr key={m.market_address} className="border-b border-white/5">
                        <td className="py-2 pr-3">
                          <div className="text-white truncate max-w-[220px]">
                            {m.market_title || "(Untitled)"}
                          </div>
                          <div className="text-[10px] text-gray-500 font-mono truncate max-w-[220px]">
                            {m.market_address}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-300 tabular-nums">
                          {m.open_trades}
                        </td>
                        <td className="py-2 px-3 text-gray-400">
                          {m.play_state_status || "no state"}
                        </td>
                        <td className="py-2 pl-3 text-gray-400">
                          {m.resolution_status || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ===== Freeze dialog ===== */}
      {freezeOpen ? (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setFreezeOpen(false)} />
          <div className="relative z-[9999] w-full max-w-md card-pump p-5 max-h-[85vh] overflow-y-auto">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              Freeze results
            </div>
            <div className="text-lg font-bold text-white mb-2">{contest.name}</div>
            <p className="text-sm text-gray-400 mb-3">
              This stores the current ranking as an immutable snapshot and moves the
              contest to <span className="text-yellow-400 font-semibold">under review</span>.
              Later settlements will not change it. No prizes are sent.
            </p>

            {preview ? (
              <div className="mb-3 rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-gray-300">
                <div>{preview.total_players} eligible players</div>
                <div className="text-gray-500 mt-0.5">
                  Top {Math.min(preview.rows.length, 3)} shown as the podium; up to 10
                  ranks are stored.
                </div>
              </div>
            ) : null}

            {freezeNeedsOverride.any ? (
              <div className="mb-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
                {freezeNeedsOverride.notEnded ? (
                  <div>⚠ This contest has not ended yet.</div>
                ) : null}
                {freezeNeedsOverride.unresolved ? (
                  <div className="mt-1">
                    ⚠ {preview?.unresolved_markets.length} market(s) with contest-period
                    Play activity are still unresolved. Freezing now permanently excludes
                    those picks.
                  </div>
                ) : null}
                <label className="mt-3 flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={freezeAck}
                    onChange={(e) => setFreezeAck(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-yellow-500"
                  />
                  <span className="text-yellow-200">
                    I understand and want to override this block.
                  </span>
                </label>
              </div>
            ) : null}

            {freezeErr ? (
              <div className="mb-3 text-sm text-red-400">{freezeErr}</div>
            ) : null}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setFreezeOpen(false)}
                disabled={freezing}
                className="px-4 py-2 rounded-lg bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void doFreeze()}
                disabled={freezing || (freezeNeedsOverride.any && !freezeAck)}
                className="px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {freezing ? "Freezing…" : "Freeze results"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== Verify dialog ===== */}
      {verifyOpen ? (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setVerifyOpen(false)} />
          <div className="relative z-[9999] w-full max-w-md card-pump p-5">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
              Verify results
            </div>
            <p className="text-sm text-gray-300 mb-4">
              Verify these frozen results? This confirms the winner ranking but does not
              send prizes.
            </p>

            {verifyErr ? (
              <div className="mb-3 text-sm text-red-400">{verifyErr}</div>
            ) : null}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setVerifyOpen(false)}
                disabled={verifying}
                className="px-4 py-2 rounded-lg bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void doVerify()}
                disabled={verifying}
                className="px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                {verifying ? "Verifying…" : "Verify results"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ========= Ranking table (live preview) ========= */

function RankingTable({ rows, contest }: { rows: RankingRow[]; contest: Contest }) {
  function prizeFor(rank: number) {
    if (rank === 1) return contest.first_prize_usd;
    if (rank === 2) return contest.second_prize_usd;
    if (rank === 3) return contest.third_prize_usd;
    return null;
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs md:text-sm">
        <thead>
          <tr className="border-b border-white/10 text-[10px] md:text-xs text-gray-500 uppercase tracking-wide">
            <th className="text-left py-2 pr-2 w-10">#</th>
            <th className="text-left py-2 px-2">Player</th>
            <th className="text-right py-2 px-2">Profit</th>
            <th className="text-right py-2 px-2">Picks</th>
            <th className="text-right py-2 px-2">W / L</th>
            <th className="text-right py-2 px-2">Win rate</th>
            <th className="text-right py-2 px-2">Staked</th>
            <th className="text-right py-2 pl-2">Prize</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const prize = prizeFor(r.rank);
            const pnl = Number(r.realized_pnl_usd);
            return (
              <tr
                key={r.wallet_address}
                className={`border-b border-white/5 ${
                  r.rank <= 3 ? "bg-pump-green/[0.04]" : ""
                }`}
              >
                <td className="py-2 pr-2 text-gray-400 tabular-nums font-semibold">
                  {r.rank}
                </td>
                <td className="py-2 px-2">
                  <PlayerCell row={r} />
                </td>
                <td
                  className={`py-2 px-2 text-right tabular-nums font-semibold ${
                    pnl > 0 ? "text-pump-green" : pnl < 0 ? "text-[#ff5c73]" : "text-gray-300"
                  }`}
                >
                  {fmtSignedUsd(r.realized_pnl_usd)}
                </td>
                <td className="py-2 px-2 text-right text-gray-300 tabular-nums">
                  {r.settled_picks}
                </td>
                <td className="py-2 px-2 text-right text-gray-300 tabular-nums">
                  {r.wins} / {r.losses}
                </td>
                <td className="py-2 px-2 text-right text-gray-300 tabular-nums">
                  {fmtPct(r.win_rate)}
                </td>
                <td className="py-2 px-2 text-right text-gray-400 tabular-nums">
                  {fmtUsd(r.total_settled_stake_usd)}
                </td>
                <td className="py-2 pl-2 text-right tabular-nums">
                  {prize && Number(prize) > 0 ? (
                    <span className="text-pump-green font-semibold">{fmtUsd(prize)}</span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ========= Frozen winner row + audit + prize tracking ========= */

function FrozenWinnerRow({
  row,
  expanded,
  audit,
  auditLoading,
  auditErr,
  edit,
  onEdit,
  saving,
  error,
  onToggle,
  onSave,
}: {
  row: ContestResult;
  expanded: boolean;
  audit: WinnerAudit | null;
  auditLoading: boolean;
  auditErr: string | null;
  edit: { payment_reference: string; admin_note: string };
  onEdit: (patch: Partial<{ payment_reference: string; admin_note: string }>) => void;
  saving: boolean;
  error: string | null;
  onToggle: () => void;
  onSave: (status?: PrizeStatus) => void;
}) {
  const pnl = Number(row.realized_pnl_usd);
  const hasPrize = Number(row.prize_amount_usd) > 0;

  return (
    <div
      className={`rounded-xl border bg-black/25 ${
        row.rank <= 3 ? "border-pump-green/25" : "border-white/10"
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left p-3 flex flex-wrap items-center gap-3 hover:bg-white/[0.03] transition rounded-xl"
      >
        <div className="text-lg font-bold text-white w-7 shrink-0 tabular-nums">
          {row.rank}
        </div>
        <div className="flex-1 min-w-0">
          <PlayerCell row={row} />
        </div>
        <div className="text-right">
          <div
            className={`text-sm font-semibold tabular-nums ${
              pnl > 0 ? "text-pump-green" : pnl < 0 ? "text-[#ff5c73]" : "text-gray-300"
            }`}
          >
            {fmtSignedUsd(row.realized_pnl_usd)}
          </div>
          <div className="text-[10px] text-gray-500">
            {row.wins}W / {row.losses}L · {row.settled_picks} picks
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasPrize ? (
            <Pill tone="ok">{fmtUsd(row.prize_amount_usd)}</Pill>
          ) : (
            <Pill tone="neutral">No prize</Pill>
          )}
          <Pill tone={prizeTone(row.prize_status)}>{row.prize_status}</Pill>
          <span className="text-gray-500 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-white/10 p-3 space-y-4">
          {/* --- frozen values --- */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">
              Frozen ranking values
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <Fact label="Wallet" value={row.wallet_address} mono />
              <Fact label="Realized Profit" value={fmtSignedUsd(row.realized_pnl_usd)} />
              <Fact label="Settled picks" value={String(row.settled_picks)} />
              <Fact label="Wins / Losses" value={`${row.wins} / ${row.losses}`} />
              <Fact label="Win rate" value={fmtPct(row.win_rate)} />
              <Fact label="Total staked" value={fmtUsd(row.total_settled_stake_usd)} />
              <Fact label="Prize amount" value={fmtUsd(row.prize_amount_usd)} />
              <Fact label="Prize status" value={row.prize_status} />
              <Fact label="Frozen at" value={fmtUtc(row.frozen_at)} />
            </div>
          </div>

          {/* --- contributing positions --- */}
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">
              Positions that produced this Profit
            </div>
            {auditLoading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-8 rounded bg-white/5" />
                <div className="h-8 rounded bg-white/5" />
              </div>
            ) : auditErr ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {auditErr}
              </div>
            ) : !audit ? (
              <div className="text-xs text-gray-500">No audit data.</div>
            ) : audit.positions.length === 0 ? (
              <div className="text-xs text-gray-500">
                No settled positions inside this contest window.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[11px]">
                    <thead>
                      <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide">
                        <th className="text-left py-2 pr-2">Market</th>
                        <th className="text-left py-2 px-2">Pick</th>
                        <th className="text-left py-2 px-2">Winner</th>
                        <th className="text-right py-2 px-2">Staked</th>
                        <th className="text-right py-2 px-2">Payout</th>
                        <th className="text-right py-2 px-2">Profit</th>
                        <th className="text-left py-2 px-2">Result</th>
                        <th className="text-left py-2 pl-2">Settled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.positions.map((p) => {
                        const ppnl = Number(p.realized_pnl_usd);
                        return (
                          <tr
                            key={`${p.market_address}|${p.outcome_index}`}
                            className="border-b border-white/5"
                          >
                            <td className="py-2 pr-2">
                              <div className="text-white truncate max-w-[200px]">
                                {p.market_title || "(Untitled)"}
                              </div>
                              <div className="text-[10px] text-gray-500 font-mono truncate max-w-[200px]">
                                {p.market_address}
                              </div>
                            </td>
                            <td className="py-2 px-2 text-gray-300">
                              {p.outcome_name || `#${p.outcome_index}`}
                              {p.trade_count > 1 ? (
                                <span className="text-gray-600"> ×{p.trade_count}</span>
                              ) : null}
                            </td>
                            <td className="py-2 px-2 text-gray-400">
                              {p.winning_outcome_name ||
                                (p.winning_outcome != null ? `#${p.winning_outcome}` : "—")}
                            </td>
                            <td className="py-2 px-2 text-right text-gray-300 tabular-nums">
                              {fmtUsd(p.total_stake_usd)}
                            </td>
                            <td className="py-2 px-2 text-right text-gray-300 tabular-nums">
                              {fmtUsd(p.payout_usd)}
                            </td>
                            <td
                              className={`py-2 px-2 text-right tabular-nums font-semibold ${
                                ppnl > 0
                                  ? "text-pump-green"
                                  : ppnl < 0
                                  ? "text-[#ff5c73]"
                                  : "text-gray-300"
                              }`}
                            >
                              {fmtSignedUsd(p.realized_pnl_usd)}
                            </td>
                            <td className="py-2 px-2">
                              <Pill
                                tone={
                                  p.status === "won"
                                    ? "ok"
                                    : p.status === "lost"
                                    ? "pink"
                                    : "neutral"
                                }
                              >
                                {p.status}
                              </Pill>
                            </td>
                            <td className="py-2 pl-2 text-gray-500 whitespace-nowrap">
                              {fmtUtc(p.settled_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-[10px] text-gray-500">
                  Recomputed totals: {fmtSignedUsd(audit.totals.realized_pnl_usd)} ·{" "}
                  {audit.totals.wins}W / {audit.totals.losses}L ·{" "}
                  {audit.totals.settled_picks} picks ·{" "}
                  {fmtUsd(audit.totals.total_settled_stake_usd)} staked
                  {audit.truncated ? " · TRUNCATED" : ""}
                </div>
              </>
            )}
          </div>

          {/* --- prize tracking --- */}
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">
              Prize tracking
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              Marking as paid only records the payment. It does not send funds.
            </p>

            <div className="flex flex-wrap gap-2 mb-3">
              {PRIZE_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => onSave(s)}
                  disabled={saving || s === row.prize_status}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    s === row.prize_status
                      ? "border-white/30 bg-white/10 text-white"
                      : "border-white/10 text-gray-300 hover:border-white/30 hover:bg-white/5"
                  }`}
                >
                  {s === "paid" ? "Mark as paid" : `Mark ${s}`}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">
                  Payment reference
                </label>
                <input
                  type="text"
                  value={edit.payment_reference}
                  onChange={(e) => onEdit({ payment_reference: e.target.value })}
                  placeholder="e.g. transfer id, invoice, ticket"
                  className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-xs placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-pump-green/50"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">
                  Internal note
                </label>
                <input
                  type="text"
                  value={edit.admin_note}
                  onChange={(e) => onEdit({ admin_note: e.target.value })}
                  placeholder="e.g. user disputed market X; reviewed play_trades"
                  className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-xs placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-pump-green/50"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={() => onSave()}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-200 text-xs font-medium hover:bg-white/10 transition disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save reference & note"}
              </button>
              {row.paid_at ? (
                <span className="text-[10px] text-gray-500">
                  Recorded paid {fmtUtc(row.paid_at)}
                </span>
              ) : null}
            </div>

            {error ? <div className="mt-2 text-xs text-red-400">{error}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-gray-200 break-all ${mono ? "font-mono text-[10px]" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function AuditFact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 py-0.5 border-b border-white/5">
      <dt className="text-gray-500 uppercase tracking-wide text-[10px] shrink-0">
        {label}
      </dt>
      <dd className={`text-gray-200 break-all ${mono ? "font-mono text-[10px]" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

/* ========= Create form ========= */

type ContestForm = {
  name: string;
  starts_at: string;
  ends_at: string;
  prize_pool_usd: string;
  first_prize_usd: string;
  second_prize_usd: string;
  third_prize_usd: string;
};

/** Monday 00:00 UTC of the current week → the following Monday. */
function defaultForm(): ContestForm {
  const now = new Date();
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const dow = (monday.getUTCDay() + 6) % 7; // 0 = Monday
  monday.setUTCDate(monday.getUTCDate() - dow);
  const next = new Date(monday.getTime() + 7 * 86400_000);
  return {
    name: "Weekly Play Contest",
    starts_at: utcIsoToLocalInput(monday.toISOString()),
    ends_at: utcIsoToLocalInput(next.toISOString()),
    prize_pool_usd: "50.00",
    first_prize_usd: "25.00",
    second_prize_usd: "15.00",
    third_prize_usd: "10.00",
  };
}

function CreateForm({
  form,
  setForm,
  creating,
  error,
  onCancel,
  onSubmit,
}: {
  form: ContestForm;
  setForm: React.Dispatch<React.SetStateAction<ContestForm>>;
  creating: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const sum =
    Number(form.first_prize_usd || 0) +
    Number(form.second_prize_usd || 0) +
    Number(form.third_prize_usd || 0);
  const pool = Number(form.prize_pool_usd || 0);
  const sumOk = Math.abs(sum - pool) < 0.005;
  const datesOk =
    !!form.starts_at && !!form.ends_at && form.ends_at > form.starts_at;

  const set = (patch: Partial<ContestForm>) => setForm((p) => ({ ...p, ...patch }));

  const field =
    "w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-pump-green/50";

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">
        New contest
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="md:col-span-2">
          <label className="text-[10px] text-gray-500 block mb-1">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            className={field}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">Starts (UTC)</label>
          <input
            type="datetime-local"
            value={form.starts_at}
            onChange={(e) => set({ starts_at: e.target.value })}
            className={field}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">Ends (UTC)</label>
          <input
            type="datetime-local"
            value={form.ends_at}
            onChange={(e) => set({ ends_at: e.target.value })}
            className={field}
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 block mb-1">Prize pool ($)</label>
          <input
            type="text"
            inputMode="decimal"
            value={form.prize_pool_usd}
            onChange={(e) => set({ prize_pool_usd: e.target.value })}
            className={field}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">1st</label>
            <input
              type="text"
              inputMode="decimal"
              value={form.first_prize_usd}
              onChange={(e) => set({ first_prize_usd: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">2nd</label>
            <input
              type="text"
              inputMode="decimal"
              value={form.second_prize_usd}
              onChange={(e) => set({ second_prize_usd: e.target.value })}
              className={field}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">3rd</label>
            <input
              type="text"
              inputMode="decimal"
              value={form.third_prize_usd}
              onChange={(e) => set({ third_prize_usd: e.target.value })}
              className={field}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 text-[11px]">
        {!datesOk ? (
          <div className="text-yellow-400">End must be after start.</div>
        ) : null}
        {!sumOk ? (
          <div className="text-yellow-400">
            Prizes sum to {sum.toFixed(2)} but the pool is {pool.toFixed(2)}.
          </div>
        ) : (
          <div className="text-gray-500">
            Both timestamps are read and stored as UTC.
          </div>
        )}
      </div>

      {error ? <div className="mt-2 text-sm text-red-400">{error}</div> : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onSubmit}
          disabled={creating || !sumOk || !datesOk || !form.name.trim()}
          className="px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {creating ? "Creating…" : "Create contest"}
        </button>
        <button
          onClick={onCancel}
          disabled={creating}
          className="px-4 py-2 rounded-lg bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
