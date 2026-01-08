<<<<<<< HEAD
// app/src/app/admin/overview/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useProgram } from "@/hooks/useProgram";

/* ========= Types ========= */

type Row = {
  market_address: string;
  question: string | null;
  contest_deadline: string | null; // DB deadline (string date)
  contest_count: number; // DB disputes count (debug)
};
=======
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
>>>>>>> 46904d2 (chore(admin): move admin dashboard to app router structure)

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
<<<<<<< HEAD
  proposed_markets: Row[];
  disputed_markets: Row[];
};

type OnchainInfo = {
  status: "open" | "proposed" | "finalized" | "cancelled" | "unknown";
  disputeCount: number;
  contestDeadlineSec: number | null; // unix sec
  proposedOutcome: number | null; // u8
};

/* ========= Config ========= */

const ADMIN_PUBKEY = new PublicKey(
  process.env.NEXT_PUBLIC_FUNMARKET_ADMIN_PUBKEY ||
    "2FuGyidfE3N1tAf6vWFFystFcEVRp4WydHTmFr71pA9Y"
);

/* ========= UI helpers ========= */

function shortAddr(a?: string) {
  if (!a) return "";
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function safeDateMs(x?: string | null) {
  if (!x) return NaN;
  const ms = new Date(x).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function formatDeadline(x?: string | null) {
  if (!x) return "—";
  const d = new Date(x);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatDeadlineFromSec(sec: number | null) {
  if (sec == null) return "—";
  const d = new Date(sec * 1000);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString();
}

function formatRemaining(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ss = s % 60;
  if (h > 0) return `${h}h ${mm}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "ok";
}) {
  const cls =
    tone === "ok"
      ? "border-pump-green/40 bg-pump-green/10 text-pump-green"
      : tone === "warn"
      ? "border-[#ff5c73]/40 bg-[#ff5c73]/10 text-[#ff5c73]"
      : "border-white/10 bg-white/5 text-gray-200";
  return (
    <span className={`px-2 py-1 rounded-full border text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
=======
  recent_proposed: Array<{
    market_address: string;
    question: string | null;
    contest_deadline: string | null;
    contest_count: number | null;
  }>;
};

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
>>>>>>> 46904d2 (chore(admin): move admin dashboard to app router structure)
  return (
    <div className="card-pump p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
      {hint ? <div className="text-xs text-gray-500 mt-1">{hint}</div> : null}
    </div>
  );
}

<<<<<<< HEAD
/* ========= Fetch helpers ========= */

async function postJSON<T>(url: string, body: any): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || j?.message || `HTTP ${r.status}`);
  return j as T;
}

function parseAnchorEnum(v: any): string {
  if (!v) return "unknown";
  if (typeof v === "string") return v.toLowerCase();
  if (typeof v === "object") {
    const k = Object.keys(v)[0];
    return (k || "unknown").toLowerCase();
  }
  return "unknown";
}

function bnToNumberOrNull(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object") {
    if (typeof v.toNumber === "function") return v.toNumber();
    if (typeof v.toString === "function") {
      const n = Number(v.toString());
      return Number.isFinite(n) ? n : null;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function explainError(e: any) {
  const msg = String(e?.message || e || "Unknown error");

  if (msg.toLowerCase().includes("user rejected")) return "User rejected the transaction in the wallet.";
  if (msg.includes("custom program error: 0x")) return msg;

  if (msg.includes("6008") || msg.toLowerCase().includes("invalid state")) {
    return "On-chain rejected: InvalidState (6008). Cause typique: contest window pas terminée on-chain, status pas PROPOSED, ou mauvaise instruction.";
  }

  return msg;
}

/* ========= Page ========= */

export default function AdminOverviewPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const program = useProgram();

=======
export default function AdminOverviewPage() {
>>>>>>> 46904d2 (chore(admin): move admin dashboard to app router structure)
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

<<<<<<< HEAD
  const [now, setNow] = useState(() => Date.now());

  // on-chain cache for disputed markets
  const [onchain, setOnchain] = useState<Record<string, OnchainInfo | null>>({});

  // per-market busy + message
  const [busy, setBusy] = useState<Record<string, "approve" | "cancel" | null>>({});
  const [msg, setMsg] = useState<Record<string, { tone: "ok" | "err" | "info"; text: string } | null>>({});

  // Tx guard: prevent double-submit
  const inFlightRef = useRef<Record<string, boolean>>({});

  const disputes = data?.disputed_markets || [];
  const k = data?.kpi;

  const isAdminWallet = useMemo(() => {
    if (!wallet.publicKey) return false;
    return wallet.publicKey.equals(ADMIN_PUBKEY);
  }, [wallet.publicKey]);

  const showInfo = useCallback((market: string, tone: "ok" | "err" | "info", text: string) => {
    setMsg((p) => ({ ...p, [market]: { tone, text } }));
    window.setTimeout(() => setMsg((p) => ({ ...p, [market]: null })), 9000);
  }, []);

  const load = useCallback(async () => {
=======
  async function load() {
>>>>>>> 46904d2 (chore(admin): move admin dashboard to app router structure)
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/overview", { credentials: "include" });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(t || `HTTP ${r.status}`);
      }
<<<<<<< HEAD
      setData((await r.json()) as Overview);
=======
      const j = (await r.json()) as Overview;
      setData(j);
>>>>>>> 46904d2 (chore(admin): move admin dashboard to app router structure)
    } catch (e: any) {
      setErr(e?.message || "Failed to load overview");
      setData(null);
    } finally {
      setLoading(false);
    }
<<<<<<< HEAD
  }, []);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch on-chain state for disputed markets (best-effort)
  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      if (!program) return;
      if (!disputes.length) return;

      const entries = await Promise.all(
        disputes.map(async (m) => {
          try {
            const pk = new PublicKey(m.market_address);
            const acct: any = await (program as any).account.market.fetch(pk);

            const statusStr = parseAnchorEnum(acct?.status);

            const disputeCount =
              (bnToNumberOrNull(acct?.disputeCount) ??
                bnToNumberOrNull(acct?.dispute_count) ??
                0) || 0;

            const contestDeadlineSec =
              bnToNumberOrNull(acct?.contestDeadline) ??
              bnToNumberOrNull(acct?.contest_deadline) ??
              null;

            const proposedOutcome =
              bnToNumberOrNull(acct?.proposedOutcome) ??
              bnToNumberOrNull(acct?.proposed_outcome) ??
              null;

            const info: OnchainInfo = {
              status: (["open", "proposed", "finalized", "cancelled"].includes(statusStr)
                ? (statusStr as any)
                : "unknown") as OnchainInfo["status"],
              disputeCount,
              contestDeadlineSec,
              proposedOutcome,
            };

            return [m.market_address, info] as const;
          } catch {
            return [m.market_address, null] as const;
          }
        })
      );

      if (cancelled) return;
      setOnchain((prev) => {
        const next = { ...prev };
        for (const [addr, info] of entries) next[addr] = info;
        return next;
      });
    }

    void fetchAll();
    return () => {
      cancelled = true;
    };
  }, [program, disputes]);

  // DB-ready: deadline passed (UI gating)
  function isDbReady(row: Row) {
    const dl = safeDateMs(row.contest_deadline);
    if (!Number.isFinite(dl)) return false;
    return now >= dl;
  }

  // On-chain-ready: status proposed + contest deadline passed
  function isOnchainReady(addr: string) {
    const oc = onchain[addr];
    if (!oc) return false;
    if (oc.status !== "proposed") return false;
    if (oc.contestDeadlineSec == null) return false;
    return now >= oc.contestDeadlineSec * 1000;
  }

  function remainingOnchainMs(addr: string) {
    const oc = onchain[addr];
    if (!oc?.contestDeadlineSec) return NaN;
    return oc.contestDeadlineSec * 1000 - now;
  }

  async function approveMarket(marketAddr: string) {
    if (!program) return showInfo(marketAddr, "err", "Program not ready");
    if (!wallet.publicKey) return showInfo(marketAddr, "err", "Connect admin wallet");
    if (!isAdminWallet) return showInfo(marketAddr, "err", `Wrong wallet. Must be ${ADMIN_PUBKEY.toBase58()}`);

    // Tx guard: prevent double-submit
    const key = `admin_approve_${marketAddr}`;
    if (inFlightRef.current[key]) return;

    const oc = onchain[marketAddr];
    if (!oc) return showInfo(marketAddr, "err", "Cannot read on-chain market (fetch failed).");

    if (!isOnchainReady(marketAddr)) {
      const rem = remainingOnchainMs(marketAddr);
      return showInfo(
        marketAddr,
        "err",
        `Not ready on-chain. status=${oc.status}, on-chain deadline=${formatDeadlineFromSec(oc.contestDeadlineSec)}${
          Number.isFinite(rem) && rem > 0 ? ` (${formatRemaining(rem)} left)` : ""
        }`
      );
    }

    inFlightRef.current[key] = true;
    setBusy((p) => ({ ...p, [marketAddr]: "approve" }));
    showInfo(marketAddr, "info", "Preparing…");

    try {
      // 1) DB prepare gate (optional rules server-side)
      const prep = await postJSON<{
        ok: boolean;
        market: { market_address: string; proposed_winning_outcome: number | null };
      }>("/api/admin/market/approve", { market: marketAddr });

      // 2) choose winning outcome:
      // Prefer on-chain proposedOutcome, fallback DB proposed_winning_outcome
      const wo =
        (Number.isFinite(Number(oc.proposedOutcome)) ? Number(oc.proposedOutcome) : null) ??
        (Number.isFinite(Number(prep?.market?.proposed_winning_outcome))
          ? Number(prep.market.proposed_winning_outcome)
          : null);

      if (wo == null) throw new Error("No proposed outcome (on-chain + DB). Cannot finalize safely.");

      showInfo(marketAddr, "info", "Signing finalize tx…");

      const marketPk = new PublicKey(marketAddr);

      // IMPORTANT: if disputes > 0 => adminFinalize, else => finalizeIfNoDisputes
      let txSig: string;

      if ((oc.disputeCount || 0) > 0) {
        txSig = await (program as any).methods
          .adminFinalize(wo)
          .accounts({ market: marketPk, admin: wallet.publicKey })
          .rpc();
      } else {
        txSig = await (program as any).methods
          .finalizeIfNoDisputes()
          .accounts({ market: marketPk, user: wallet.publicKey })
          .rpc();
      }

      showInfo(marketAddr, "info", `Confirming… tx=${shortAddr(txSig)}`);
      await connection.confirmTransaction(txSig, "confirmed");

      showInfo(marketAddr, "info", "Committing DB…");

      // 3) DB commit (non-fatal if fails)
      try {
        await postJSON("/api/admin/market/approve/commit", {
          market: marketAddr,
          winning_outcome: wo,
          tx_sig: txSig,
        });
      } catch (dbErr) {
        console.error("DB commit error (tx still succeeded):", dbErr);
        // Continue - on-chain is source of truth
      }

      showInfo(marketAddr, "ok", `Approved ✅ tx=${shortAddr(txSig)}`);
      await load();
    } catch (e: any) {
      console.error("approveMarket error:", e);
      const errMsg = String(e?.message || "");

      // Handle "already been processed" gracefully
      if (errMsg.toLowerCase().includes("already been processed")) {
        showInfo(marketAddr, "info", "Transaction already processed. Refreshing…");
        await load();
        return;
      }

      // Handle user rejection
      if (errMsg.toLowerCase().includes("user rejected")) {
        showInfo(marketAddr, "err", "Transaction cancelled by user.");
        return;
      }

      showInfo(marketAddr, "err", explainError(e));
    } finally {
      inFlightRef.current[key] = false;
      setBusy((p) => ({ ...p, [marketAddr]: null }));
    }
  }

  async function cancelMarket(marketAddr: string) {
    if (!program) return showInfo(marketAddr, "err", "Program not ready");
    if (!wallet.publicKey) return showInfo(marketAddr, "err", "Connect admin wallet");
    if (!isAdminWallet) return showInfo(marketAddr, "err", `Wrong wallet. Must be ${ADMIN_PUBKEY.toBase58()}`);

    // Tx guard: prevent double-submit
    const key = `admin_cancel_${marketAddr}`;
    if (inFlightRef.current[key]) return;

    const oc = onchain[marketAddr];
    if (!oc) return showInfo(marketAddr, "err", "Cannot read on-chain market (fetch failed).");

    if (!isOnchainReady(marketAddr)) {
      const rem = remainingOnchainMs(marketAddr);
      return showInfo(
        marketAddr,
        "err",
        `Not ready on-chain. status=${oc.status}, on-chain deadline=${formatDeadlineFromSec(oc.contestDeadlineSec)}${
          Number.isFinite(rem) && rem > 0 ? ` (${formatRemaining(rem)} left)` : ""
        }`
      );
    }

    if ((oc.disputeCount || 0) <= 0) {
      return showInfo(marketAddr, "err", "No on-chain disputes => admin_cancel not allowed (disputeCount=0).");
    }

    inFlightRef.current[key] = true;
    setBusy((p) => ({ ...p, [marketAddr]: "cancel" }));
    showInfo(marketAddr, "info", "Preparing…");

    try {
      // 1) DB prepare gate (optional rules server-side)
      await postJSON("/api/admin/market/cancel", { market: marketAddr });

      showInfo(marketAddr, "info", "Signing cancel tx…");

      const marketPk = new PublicKey(marketAddr);
      const txSig = await (program as any).methods
        .adminCancel()
        .accounts({ market: marketPk, admin: wallet.publicKey })
        .rpc();

      showInfo(marketAddr, "info", `Confirming… tx=${shortAddr(txSig)}`);
      await connection.confirmTransaction(txSig, "confirmed");

      showInfo(marketAddr, "info", "Committing DB…");

      // 3) DB commit (non-fatal if fails)
      try {
        await postJSON("/api/admin/market/cancel/commit", {
          market: marketAddr,
          tx_sig: txSig,
        });
      } catch (dbErr) {
        console.error("DB commit error (tx still succeeded):", dbErr);
        // Continue - on-chain is source of truth
      }

      showInfo(marketAddr, "ok", `Cancelled ✅ tx=${shortAddr(txSig)}`);
      await load();
    } catch (e: any) {
      console.error("cancelMarket error:", e);
      const errMsg = String(e?.message || "");

      // Handle "already been processed" gracefully
      if (errMsg.toLowerCase().includes("already been processed")) {
        showInfo(marketAddr, "info", "Transaction already processed. Refreshing…");
        await load();
        return;
      }

      // Handle user rejection
      if (errMsg.toLowerCase().includes("user rejected")) {
        showInfo(marketAddr, "err", "Transaction cancelled by user.");
        return;
      }

      showInfo(marketAddr, "err", explainError(e));
    } finally {
      inFlightRef.current[key] = false;
      setBusy((p) => ({ ...p, [marketAddr]: null }));
    }
  }
=======
  }

  useEffect(() => {
    void load();
  }, []);

  const k = data?.kpi;
>>>>>>> 46904d2 (chore(admin): move admin dashboard to app router structure)

  const disputesBadge = useMemo(() => {
    const n = k?.disputes_open ?? 0;
    if (n <= 0) return "No open disputes";
    return `${n} open disputes`;
  }, [k?.disputes_open]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
<<<<<<< HEAD
          <h1 className="text-3xl font-bold text-white">Admin Overview</h1>
          <div className="text-sm text-gray-400 mt-1">
            Flow: prepare (API) → sign on-chain → confirm → commit (API).
          </div>

          <div className="text-xs text-gray-500 mt-2">
            Admin required: <span className="font-mono">{ADMIN_PUBKEY.toBase58()}</span>
            {wallet.publicKey ? (
              <>
                {" "}
                • Connected:{" "}
                <span className={`font-mono ${isAdminWallet ? "text-pump-green" : "text-[#ff5c73]"}`}>
                  {wallet.publicKey.toBase58()}
                </span>
              </>
            ) : (
              <>
                {" "}
                • Connected: <span className="font-mono">not connected</span>
              </>
            )}
            {" • "}
            <span>{disputesBadge}</span>
          </div>
=======
          <h1 className="text-3xl font-bold text-white">Admin • Overview</h1>
          <div className="text-sm text-gray-400 mt-1">All KPIs + quick access to disputed markets.</div>
>>>>>>> 46904d2 (chore(admin): move admin dashboard to app router structure)
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
<<<<<<< HEAD
          {/* KPI */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Markets"
              value={`${k.markets_total}`}
              hint={`Open: ${k.markets_open} • Ended: ${k.markets_ended}`}
            />
            <StatCard label="Volume (SOL)" value={k.volume_sol_total.toFixed(2)} hint="DB aggregate" />
            <StatCard label="Transactions" value={`${k.tx_count}`} hint={`Unique traders: ${k.unique_traders}`} />
            <StatCard label="Disputes open" value={`${k.disputes_open}`} hint={`Total disputes: ${k.disputes_total}`} />
          </div>

          {/* Disputes */}
          <div className="card-pump p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-bold text-white">🚨 Disputed markets</div>
                <div className="text-sm text-gray-400">
                  UI shows actions once <span className="text-gray-200">DB deadline</span> passed. Click enforces{" "}
                  <span className="text-gray-200">on-chain</span> status + contestDeadline.
                </div>
              </div>
              <div className="text-xs text-gray-500">{disputes.length} market(s)</div>
            </div>

            <div className="mt-4 space-y-2">
              {disputes.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-pump-dark/40 p-4">
                  <div className="text-white font-semibold">Nothing to do ✅</div>
                  <div className="text-sm text-gray-400 mt-1">No disputes right now.</div>
                </div>
              ) : (
                disputes.map((m) => {
                  const oc = onchain[m.market_address];
                  const uiReadyDb = isDbReady(m);
                  const onchainReady = isOnchainReady(m.market_address);
                  const rem = remainingOnchainMs(m.market_address);

                  const actionBusy = busy[m.market_address];
                  const info = msg[m.market_address];

                  const baseDisabled = !wallet.publicKey || !program || !isAdminWallet || !!actionBusy;
                  const approveDisabled = baseDisabled || !uiReadyDb;
                  const cancelDisabled = baseDisabled || !uiReadyDb;

                  return (
                    <div
                      key={m.market_address}
                      className="rounded-xl border border-[#ff5c73]/40 bg-[#ff5c73]/5 p-4 flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-white font-semibold truncate">{m.question || "(Market)"}</div>

                          <Pill tone="warn">DB disputes: {Number(m.contest_count || 0)}</Pill>
                          {uiReadyDb ? <Pill tone="ok">READY (DB)</Pill> : <Pill tone="neutral">DB window open</Pill>}

                          {oc ? (
                            <>
                              <Pill tone={oc.status === "proposed" ? "ok" : "neutral"}>on-chain status: {oc.status}</Pill>
                              <Pill tone={oc.disputeCount > 0 ? "warn" : "neutral"}>on-chain disputes: {oc.disputeCount}</Pill>
                              <Pill tone={onchainReady ? "ok" : "neutral"}>
                                on-chain deadline: {formatDeadlineFromSec(oc.contestDeadlineSec)}
                                {Number.isFinite(rem) && rem > 0 ? ` • ${formatRemaining(rem)} left` : ""}
                              </Pill>
                            </>
                          ) : (
                            <Pill tone="neutral">on-chain: loading…</Pill>
                          )}
                        </div>

                        <div className="text-xs text-gray-400 mt-2 flex flex-wrap items-center gap-2">
                          <span className="font-mono">{shortAddr(m.market_address)}</span>
                          <span className="opacity-40">•</span>
                          <span>DB deadline: {formatDeadline(m.contest_deadline)}</span>
                        </div>

                        {info ? (
                          <div
                            className={[
                              "mt-3 text-sm rounded-lg px-3 py-2 border",
                              info.tone === "ok"
                                ? "border-pump-green/30 bg-pump-green/10 text-pump-green"
                                : info.tone === "err"
                                ? "border-red-500/30 bg-red-500/10 text-red-200"
                                : "border-white/10 bg-white/5 text-gray-200",
                            ].join(" ")}
                          >
                            {info.text}
                          </div>
                        ) : null}

                        <div className="mt-3 text-xs text-gray-500">
                          Approve = finalize on-chain. Cancel = refund path (admin_cancel). Commit only after TX confirmed.
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        <div className="flex items-center gap-2">
                          <button
                            disabled={cancelDisabled}
                            aria-busy={actionBusy === "cancel"}
                            onClick={() => {
                              if (!confirm("Cancel this market on-chain? (Refund flow)")) return;
                              void cancelMarket(m.market_address);
                            }}
                            className={[
                              "px-4 py-2 rounded-lg text-sm font-semibold transition border",
                              cancelDisabled
                                ? "bg-black/20 border-white/10 text-gray-500 cursor-not-allowed"
                                : "bg-black/30 border-[#ff5c73]/40 text-[#ff5c73] hover:bg-[#ff5c73]/10",
                            ].join(" ")}
                          >
                            {actionBusy === "cancel" ? "Processing…" : "Cancel"}
                          </button>

                          <button
                            disabled={approveDisabled}
                            aria-busy={actionBusy === "approve"}
                            onClick={() => {
                              if (!confirm("Approve this market on-chain? (Finalize)")) return;
                              void approveMarket(m.market_address);
                            }}
                            className={[
                              "px-4 py-2 rounded-lg text-sm font-semibold transition",
                              approveDisabled
                                ? "bg-gray-800/40 text-gray-500 cursor-not-allowed"
                                : "bg-pump-green text-black hover:opacity-90",
                            ].join(" ")}
                          >
                            {actionBusy === "approve" ? "Processing…" : "Approve"}
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <Link
                            href={`/contest/${m.market_address}`}
                            className="px-3 py-2 rounded-lg bg-[#ff5c73] text-black text-xs font-semibold hover:opacity-90 transition"
                          >
                            Open disputes
                          </Link>
                          <Link
                            href={`/trade/${m.market_address}`}
                            className="px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-gray-200 text-xs font-semibold hover:border-white/20 transition"
                          >
                            View market
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })
=======
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
>>>>>>> 46904d2 (chore(admin): move admin dashboard to app router structure)
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}