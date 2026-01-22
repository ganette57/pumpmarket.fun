
// app/src/app/admin/overview/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useProgram } from "@/hooks/useProgram";
import { sendSignedTx } from "@/lib/solanaSend";

/* ========= Types ========= */

type MarketType = "proposed_no_dispute" | "proposed_disputed" | "no_proposal_48h";

type ActionableMarket = {
  market_address: string;
  question: string | null;
  contest_deadline: string | null;
  contest_count: number;
  end_date: string | null;
  proposed_winning_outcome: number | null;
  type: MarketType;
  is_actionable: boolean;
  due_date: string | null;
};

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
  actionable_markets: ActionableMarket[];
};

type OnchainInfo = {
  status: "open" | "proposed" | "finalized" | "cancelled" | "unknown";
  disputeCount: number;
  contestDeadlineSec: number | null;
  proposedOutcome: number | null;
  resolutionTimeSec: number | null;
};

type DrawerMode = "approve_only" | "approve_cancel" | "cancel_only_48h" | null;

type FlowStep = "idle" | "checking" | "signing" | "confirming" | "committing" | "done" | "error";

type ResolvedAction = "approved" | "cancelled";

type ResolvedRow = {
  market_address: string;
  question: string | null;
  resolved_action: ResolvedAction;
  winning_outcome: number | null;
  tx_sig: string | null;
  resolved_at: string | null;

  market_type?: number | null;
  outcome_names?: any;
};


/* ========= Config ========= */

const ADMIN_PUBKEY = new PublicKey(
  process.env.NEXT_PUBLIC_FUNMARKET_ADMIN_PUBKEY ||
    "2FuGyidfE3N1tAf6vWFFystFcEVRp4WydHTmFr71pA9Y"
);

/* ========= UI helpers ========= */

function shortAddr(a?: string) {
  if (!a) return "";
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}...${a.slice(-6)}`;
}

function formatDate(x?: string | null) {
  if (!x) return "—";
  const d = new Date(x);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }) + " " + d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "ok" | "pink";
}) {
  const cls =
    tone === "ok"
      ? "border-pump-green/40 bg-pump-green/10 text-pump-green"
      : tone === "warn"
      ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
      : tone === "pink"
      ? "border-[#ff5c73]/40 bg-[#ff5c73]/10 text-[#ff5c73]"
      : "border-white/10 bg-white/5 text-gray-300";
  return (
    <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${cls}`}>
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
  return (
    <div className="card-pump p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
      {hint ? <div className="text-xs text-gray-500 mt-1">{hint}</div> : null}
    </div>
  );
}

function formatWinningOutcomeLabel(row: { market_type?: number | null; outcome_names?: any; winning_outcome?: number | null }) {
  const idx = row.winning_outcome;
  if (idx == null) return "—";

  const mt = Number(row.market_type ?? 0);

  // market_type 0 = binary (YES/NO)
  if (mt === 0) return idx === 0 ? "YES" : idx === 1 ? "NO" : String(idx);

  // multi-choice: outcome_names is jsonb (likely array)
  const names = row.outcome_names;
  if (Array.isArray(names) && names[idx] != null) return String(names[idx]);

  return String(idx);
}

/* ========= Fetch helpers ========= */

async function postJSON<T>(url: string, body: object): Promise<T> {
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

function parseAnchorEnum(v: unknown): string {
  if (!v) return "unknown";
  if (typeof v === "string") return v.toLowerCase();
  if (typeof v === "object" && v !== null) {
    const k = Object.keys(v)[0];
    return (k || "unknown").toLowerCase();
  }
  return "unknown";
}

function bnToNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "object" && v !== null) {
    const obj = v as { toNumber?: () => number; toString?: () => string };
    if (typeof obj.toNumber === "function") return obj.toNumber();
    if (typeof obj.toString === "function") {
      const n = Number(obj.toString());
      return Number.isFinite(n) ? n : null;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function explainError(e: unknown): string {
  const msg = String((e as { message?: string })?.message || e || "Unknown error");

  if (msg.toLowerCase().includes("user rejected")) return "User rejected the transaction.";
  if (msg.includes("6008") || msg.toLowerCase().includes("invalid state")) {
    return "On-chain rejected: InvalidState. Contest window not finished or wrong status.";
  }
  if (msg.includes("6009") || msg.toLowerCase().includes("too early")) {
    return "On-chain rejected: TooEarly. Wait for deadline.";
  }

  return msg;
}

/* ========= Page ========= */

export default function AdminOverviewPage() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const program = useProgram();

  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());

  // Filters
  const [filter, setFilter] = useState<"inbox" | "resolved" | "all">("inbox");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  // On-chain cache
  const [onchain, setOnchain] = useState<Record<string, OnchainInfo | null>>({});

  // Drawer state
  const [drawerMarket, setDrawerMarket] = useState<ActionableMarket | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [flowStep, setFlowStep] = useState<FlowStep>("idle");
  const [flowMsg, setFlowMsg] = useState<string>("");
  const [flowError, setFlowError] = useState<string>("");
  const [resolvedRows, setResolvedRows] = useState<ResolvedRow[]>([]);
const [resolvedLoading, setResolvedLoading] = useState(false);
const [resolvedErr, setResolvedErr] = useState<string | null>(null);

const resolvedSorted = useMemo(() => {
  const list = [...resolvedRows];

  list.sort((a, b) => {
    const ad = a.resolved_at ? new Date(a.resolved_at).getTime() : 0;
    const bd = b.resolved_at ? new Date(b.resolved_at).getTime() : 0;
    return sortDir === "asc" ? ad - bd : bd - ad;
  });

  return list;
}, [resolvedRows, sortDir]);

const markets = data?.actionable_markets || [];
const k = data?.kpi;

  const isAdminWallet = useMemo(() => {
    if (!publicKey) return false;
    return publicKey.equals(ADMIN_PUBKEY);
  }, [publicKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/overview", { credentials: "include" });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(t || `HTTP ${r.status}`);
      }
      setData((await r.json()) as Overview);
    } catch (e: unknown) {
      setErr((e as { message?: string })?.message || "Failed to load overview");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    let cancelled = false;
  
    async function fetchResolved() {
      if (filter !== "resolved") return;
      setResolvedLoading(true);
      setResolvedErr(null);
  
      try {
        const r = await fetch("/api/admin/resolved", { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || j?.message || `HTTP ${r.status}`);
        if (!cancelled) setResolvedRows((j?.resolved || []) as ResolvedRow[]);
      } catch (e: any) {
        if (!cancelled) setResolvedErr(e?.message || "Failed to load resolved");
      } finally {
        if (!cancelled) setResolvedLoading(false);
      }
    }
  
    void fetchResolved();
    return () => { cancelled = true; };
  }, [filter]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!drawerMarket) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerMarket]);

  // Fetch on-chain state for all markets
  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      if (!program) return;
      if (!markets.length) return;

      const entries = await Promise.all(
        markets.map(async (m) => {
          try {
            const pk = new PublicKey(m.market_address);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

            const resolutionTimeSec =
              bnToNumberOrNull(acct?.resolutionTime) ??
              bnToNumberOrNull(acct?.resolution_time) ??
              null;

            const info: OnchainInfo = {
              status: (["open", "proposed", "finalized", "cancelled"].includes(statusStr)
                ? statusStr
                : "unknown") as OnchainInfo["status"],
              disputeCount,
              contestDeadlineSec,
              proposedOutcome,
              resolutionTimeSec,
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
  }, [program, markets]);

  function isResolved(m: ActionableMarket) {
    const oc = onchain[m.market_address];
    return oc?.status === "finalized" || oc?.status === "cancelled";
  }

  // Filter and sort markets
  const filteredMarkets = useMemo(() => {
    let list = [...markets];

// Filter
if (filter === "inbox") {
  list = list.filter((m) => m.is_actionable && !isResolved(m));
} else if (filter === "resolved") {
  list = list.filter((m) => isResolved(m));
}
// filter === "all" => no-op

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.question?.toLowerCase().includes(q) ||
          m.market_address.toLowerCase().includes(q)
      );
    }

    // Sort by due_date
    list.sort((a, b) => {
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return sortDir === "asc" ? ad - bd : bd - ad;
    });

    return list;
  }, [markets, filter, search, sortDir]);

  // Get type badge
  function getTypeBadge(m: ActionableMarket) {
    if (isResolved(m)) {
      return <Pill tone="ok">Resolved</Pill>;
    }
    if (m.type === "no_proposal_48h") {
      return <Pill tone="warn">No proposal 48h</Pill>;
    }
    if (m.type === "proposed_disputed") {
      return <Pill tone="pink">{m.contest_count} dispute{m.contest_count > 1 ? "s" : ""}</Pill>;
    }
    return <Pill tone="neutral">0 dispute</Pill>;
  }

  // Get actionability status
  function getActionStatus(m: ActionableMarket) {
    if (m.is_actionable) {
      return <Pill tone="ok">READY</Pill>;
    }
    return <Pill tone="warn">WAIT</Pill>;
  }

  // Open drawer
  function openDrawer(m: ActionableMarket) {
    setDrawerMarket(m);
    setFlowStep("idle");
    setFlowMsg("");
    setFlowError("");

    // Determine mode
    if (m.type === "no_proposal_48h") {
      setDrawerMode("cancel_only_48h");
    } else if (m.type === "proposed_no_dispute") {
      setDrawerMode("approve_only");
    } else {
      setDrawerMode("approve_cancel");
    }
  }

  function closeDrawer() {
    setDrawerMarket(null);
    setDrawerMode(null);
    setFlowStep("idle");
    setFlowMsg("");
    setFlowError("");
  }

  // ========= APPROVE FLOW =========
  async function doApprove() {
    if (!drawerMarket) return;
    if (!program) return setFlowError("Program not ready");
    if (!publicKey || !signTransaction) return setFlowError("Connect wallet");
    if (!isAdminWallet) return setFlowError(`Wrong wallet. Must be ${ADMIN_PUBKEY.toBase58()}`);

    const marketAddr = drawerMarket.market_address;
    const oc = onchain[marketAddr];

    setFlowStep("checking");
    setFlowMsg("Checking server...");
    setFlowError("");

    try {
      // 1) Server check
      const prep = await postJSON<{
        ok: boolean;
        market: { market_address: string; proposed_winning_outcome: number | null; contest_count: number };
      }>("/api/admin/market/approve", { market: marketAddr });

      if (!prep.ok) throw new Error("Server check failed");

      // 2) Determine on-chain action
      const onchainDisputes = oc?.disputeCount ?? 0;
      const wo =
        (Number.isFinite(Number(oc?.proposedOutcome)) ? Number(oc?.proposedOutcome) : null) ??
        (Number.isFinite(Number(prep?.market?.proposed_winning_outcome))
          ? Number(prep.market.proposed_winning_outcome)
          : null);

      setFlowStep("signing");
      setFlowMsg("Signing on-chain tx...");

      const marketPk = new PublicKey(marketAddr);
      let txSig: string;

      if (onchainDisputes > 0) {
        // Disputed: use adminFinalize(wo)
        if (wo == null) throw new Error("No winning outcome for disputed market");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = await (program as any).methods
        .adminFinalize(wo)
        .accounts({ market: marketPk, admin: publicKey })
        .transaction();
      
      txSig = await sendSignedTx({
        connection,
        tx,
        signTx: signTransaction!,
        feePayer: publicKey,
      });
      } else {
        // No disputes: use finalizeIfNoDisputes()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = await (program as any).methods
        .finalizeIfNoDisputes()
        .accounts({ market: marketPk, user: publicKey })
        .transaction();
      
      txSig = await sendSignedTx({
        connection,
        tx,
        signTx: signTransaction!,
        feePayer: publicKey,
      });
      }

      setFlowStep("confirming");
      setFlowMsg(`Confirming tx ${shortAddr(txSig)}...`);


      setFlowStep("committing");
      setFlowMsg("Committing to DB...");

      // 3) DB commit
      const finalWo = wo ?? (oc?.proposedOutcome ?? drawerMarket.proposed_winning_outcome ?? 0);
      await postJSON("/api/admin/market/approve/commit", {
        market: marketAddr,
        winning_outcome: finalWo,
        tx_sig: txSig,
      });

      setFlowStep("done");
      setFlowMsg(`Approved! tx=${shortAddr(txSig)}`);

      // Reload after a bit
      setTimeout(() => {
        closeDrawer();
        load();
      }, 2000);
    } catch (e: unknown) {
      setFlowStep("error");
      setFlowError(explainError(e));
    }
  }

  // ========= CANCEL FLOW (disputed) =========
  async function doCancel() {
    if (!drawerMarket) return;
    if (!program) return setFlowError("Program not ready");
    if (!publicKey || !signTransaction) return setFlowError("Connect wallet");
    if (!isAdminWallet) return setFlowError(`Wrong wallet. Must be ${ADMIN_PUBKEY.toBase58()}`);

    const marketAddr = drawerMarket.market_address;
    const oc = onchain[marketAddr];

    // Must have disputes for admin_cancel
    if ((oc?.disputeCount ?? 0) <= 0) {
      return setFlowError("No disputes on-chain. Cannot use admin_cancel.");
    }

    setFlowStep("checking");
    setFlowMsg("Checking server...");
    setFlowError("");

    try {
      // 1) Server check
      await postJSON("/api/admin/market/cancel", { market: marketAddr });

      setFlowStep("signing");
      setFlowMsg("Signing cancel tx...");

      const marketPk = new PublicKey(marketAddr);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program as any).methods
      .adminCancel()
      .accounts({ market: marketPk, admin: publicKey })
      .transaction();
    
    const txSig = await sendSignedTx({
      connection,
      tx,
      signTx: signTransaction!,
      feePayer: publicKey,
    });

      setFlowStep("confirming");
      setFlowMsg(`Confirming tx ${shortAddr(txSig)}...`);


      setFlowStep("committing");
      setFlowMsg("Committing to DB...");

      await postJSON("/api/admin/market/cancel/commit", {
        market: marketAddr,
        tx_sig: txSig,
      });

      setFlowStep("done");
      setFlowMsg(`Cancelled! tx=${shortAddr(txSig)}`);

      setTimeout(() => {
        closeDrawer();
        load();
      }, 2000);
    } catch (e: unknown) {
      setFlowStep("error");
      setFlowError(explainError(e));
    }
  }

  // ========= CANCEL 48H FLOW =========
  async function doCancel48h() {
    if (!drawerMarket) return;
    if (!program) return setFlowError("Program not ready");
    if (!publicKey || !signTransaction) return setFlowError("Connect wallet");
    // Note: cancelIfNoProposal does NOT require admin, any user can call it

    const marketAddr = drawerMarket.market_address;

    setFlowStep("checking");
    setFlowMsg("Checking server...");
    setFlowError("");

    try {
      // 1) Server check (validates 48h condition)
      await postJSON("/api/admin/market/cancel", {
        market: marketAddr,
        action: "cancel_if_no_proposal",
      });

      setFlowStep("signing");
      setFlowMsg("Signing cancel tx...");

      const marketPk = new PublicKey(marketAddr);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = await (program as any).methods
      .cancelIfNoProposal()
      .accounts({ market: marketPk, user: publicKey })
      .transaction();
    
    const txSig = await sendSignedTx({
      connection,
      tx,
      signTx: signTransaction!,
      feePayer: publicKey,
    });

      setFlowStep("confirming");
      setFlowMsg(`Confirming tx ${shortAddr(txSig)}...`);


      setFlowStep("committing");
      setFlowMsg("Committing to DB...");

      await postJSON("/api/admin/market/cancel/commit", {
        market: marketAddr,
        tx_sig: txSig,
        reason: "no_proposal_48h",
      });

      setFlowStep("done");
      setFlowMsg(`Refunded! tx=${shortAddr(txSig)}`);

      setTimeout(() => {
        closeDrawer();
        load();
      }, 2000);
    } catch (e: unknown) {
      setFlowStep("error");
      setFlowError(explainError(e));
    }
  }

  // ========= RENDER =========

  const isBusy = flowStep !== "idle" && flowStep !== "done" && flowStep !== "error";

  return (
    <div className="min-h-screen bg-pump-dark">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-4">
          <div className="text-sm text-gray-400">
            Inbox style • safe actions • on-chain tx + DB commit.
          </div>
        </div>

        {loading ? (
          <div className="card-pump p-4 text-gray-400">Loading...</div>
        ) : err ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">
            {err}
          </div>
        ) : !data || !k ? (
          <div className="card-pump p-4 text-gray-400">No data.</div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <StatCard
                label="Markets"
                value={`${k.markets_total}`}
                hint={`open ${k.markets_open} • proposed ${k.markets_proposed}`}
              />
              <StatCard
                label="Volume"
                value={`${k.volume_sol_total.toFixed(4)} SOL`}
                hint="total traded"
              />
              <StatCard
                label="Transactions"
                value={`${k.tx_count}`}
                hint={`unique traders ${k.unique_traders}`}
              />
              <StatCard
                label="Disputes"
                value={`${k.disputes_total}`}
                hint={`open ${k.disputes_open}`}
              />
            </div>

            {/* Filter Row */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center gap-1 bg-pump-dark-lighter rounded-lg p-1">
  <button
    onClick={() => setFilter("inbox")}
    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
      filter === "inbox" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
    }`}
  >
    Inbox (actionable)
  </button>

  <button
    onClick={() => setFilter("resolved")}
    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
      filter === "resolved" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
    }`}
  >
    Resolved
  </button>

  <button
    onClick={() => setFilter("all")}
    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
      filter === "all" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
    }`}
  >
    All
  </button>
</div>

              <button
                onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-pump-dark-lighter text-gray-300 text-sm hover:text-white transition"
              >
                Date {sortDir === "asc" ? "↓" : "↑"}
              </button>

              <div className="flex-1" />

              <input
                type="text"
                placeholder="Search question or address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full md:w-72 px-4 py-2 rounded-lg bg-white text-black placeholder-gray-500 border border-white/20 text-sm focus:outline-none focus:ring-2 focus:ring-pump-green"              />
            </div>

            {/* Table */}
            <div className="card-pump overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                      Market
                    </th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                      Type
                    </th>
                    <th className="text-left text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                      Due
                    </th>
                    <th className="text-right text-xs text-gray-500 uppercase tracking-wide px-4 py-3">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
  {filter === "resolved" ? (
    resolvedLoading ? (
      <tr>
        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
          Loading resolved...
        </td>
      </tr>
    ) : resolvedErr ? (
      <tr>
        <td colSpan={4} className="px-4 py-8 text-center text-red-300">
          {resolvedErr}
        </td>
      </tr>
    ) : resolvedRows.length === 0 ? (
      <tr>
        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
          No resolved markets yet.
        </td>
      </tr>
    ) : (
      resolvedSorted.map((m) => (
        <tr
          key={m.market_address}
          className="border-b border-white/5 hover:bg-white/2 transition"
        >
          <td className="px-4 py-3">
            <div className="text-white font-medium truncate max-w-xs">
              {m.question || "(Untitled)"}
            </div>
            <div className="text-xs text-gray-500 font-mono break-all">
  {m.market_address}
</div>
          </td>

          <td className="px-4 py-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Pill tone={m.resolved_action === "approved" ? "ok" : "pink"}>
                {m.resolved_action === "approved" ? "Approved" : "Cancelled"}
              </Pill>

              {m.resolved_action === "approved" ? (
                <Pill tone="neutral">Outcome: {formatWinningOutcomeLabel(m as any)}</Pill>
              ) : (
                <Pill tone="neutral">Refund</Pill>
              )}
            </div>

            {m.tx_sig ? (
            <div className="text-xs text-gray-500 mt-1 font-mono break-all">
            tx: {m.tx_sig}
          </div>
            ) : null}
          </td>

          <td className="px-4 py-3">
            <span className="text-sm text-gray-400">{formatDate(m.resolved_at)}</span>
          </td>

          <td className="px-4 py-3 text-right">
            <div className="flex items-center justify-end gap-2">
              <Link
                href={`/trade/${m.market_address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm font-medium hover:bg-white/10 transition"
              >
                View
              </Link>
            </div>
          </td>
        </tr>
      ))
    )
  ) : (
    filteredMarkets.length === 0 ? (
      <tr>
        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
          No markets to display.
        </td>
      </tr>
    ) : (
      filteredMarkets.map((m) => (
        <tr
          key={m.market_address}
          className="border-b border-white/5 hover:bg-white/2 transition"
        >
          <td className="px-4 py-3">
            <div className="text-white font-medium truncate max-w-xs">
              {m.question || "(Untitled)"}
            </div>
            <div className="text-xs text-gray-500 font-mono">
              {shortAddr(m.market_address)}
            </div>
          </td>

          <td className="px-4 py-3">{getTypeBadge(m)}</td>

          <td className="px-4 py-3">
            <div className="flex items-center gap-2">
              {getActionStatus(m)}
              <span className="text-sm text-gray-400">{formatDate(m.due_date)}</span>
            </div>
          </td>

          <td className="px-4 py-3 text-right">
            <div className="flex items-center justify-end gap-2">
              <Link
                href={`/trade/${m.market_address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm font-medium hover:bg-white/10 transition"
              >
                View
              </Link>
              <button
                onClick={() => openDrawer(m)}
                disabled={!m.is_actionable}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  m.is_actionable
                    ? "bg-pump-green text-black hover:opacity-90"
                    : "bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
              >
                Open
              </button>
            </div>
          </td>
        </tr>
      ))
    )
  )}
</tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Right Drawer */}
      {drawerMarket && (
        <div className="fixed inset-0 z-[9998] flex">
          {/* Overlay */}
          <div className="flex-1 bg-black/60 z-[9998]" onClick={closeDrawer} />

          {/* Drawer Panel */}
          <div className="fixed right-0 top-0 z-[9999] h-dvh w-full max-w-md bg-pump-dark border-l border-white/10 flex flex-col">
            <div className="flex-1 overflow-y-auto p-6">
              {/* Market Info */}
              <div className="card-pump p-4 mb-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                  Market
                </div>
                <div className="text-lg font-bold text-white mb-1">
                  {drawerMarket.question || "(Untitled)"}
                </div>
                <div className="text-xs text-gray-400 font-mono mb-3">
                  {drawerMarket.market_address}
                </div>
                <div className="flex flex-wrap gap-2">
                  {getTypeBadge(drawerMarket)}
                  {drawerMode === "approve_only" && (
                    <Pill tone="ok">Approve only</Pill>
                  )}
                  {drawerMode === "approve_cancel" && (
                    <Pill tone="ok">Approve / Cancel</Pill>
                  )}
                  {drawerMode === "cancel_only_48h" && (
                    <Pill tone="warn">Cancel only</Pill>
                  )}
                </div>
              </div>

              {/* Flow Steps */}
              <div className="card-pump p-4 mb-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                  Flow
                </div>
                <ol className="space-y-2 text-sm">
                  <li className={flowStep === "checking" ? "text-white font-medium" : "text-gray-400"}>
                    1. Server check (DB status + deadline)
                  </li>
                  <li className={flowStep === "signing" ? "text-white font-medium" : "text-gray-400"}>
                    2. Wallet signs on-chain tx
                  </li>
                  <li className={flowStep === "confirming" ? "text-white font-medium" : "text-gray-400"}>
                    3. Confirm signature
                  </li>
                  <li className={flowStep === "committing" ? "text-white font-medium" : "text-gray-400"}>
                    4. Commit DB with tx_sig
                  </li>
                </ol>
                <div className="mt-3 text-xs text-gray-500">
                  step: {flowStep}
                </div>
                {flowMsg && (
                  <div className="mt-2 text-sm text-pump-green">{flowMsg}</div>
                )}
                {flowError && (
                  <div className="mt-2 text-sm text-red-400">{flowError}</div>
                )}
              </div>

              {/* Methods Reference */}
              <div className="text-xs text-gray-500 mt-4">
                <div className="mb-1">Methods used:</div>
                <div>
                  no-dispute approve: <strong>finalizeIfNoDisputes()</strong> •{" "}
                  disputed approve: <strong>adminFinalize(u8)</strong> •{" "}
                  disputed cancel: <strong>adminCancel()</strong> •{" "}
                  48h cancel: <strong>cancelIfNoProposal()</strong>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="border-t border-white/10 p-4 flex items-center justify-between gap-3">
              <button
                onClick={closeDrawer}
                disabled={isBusy}
                className="px-4 py-2 rounded-lg bg-white/5 text-white text-sm font-medium hover:bg-white/10 transition disabled:opacity-50"
              >
                Close
              </button>

              <div className="flex gap-2">
                {/* Cancel button for approve_cancel mode */}
                {drawerMode === "approve_cancel" && (
                  <button
                    onClick={doCancel}
                    disabled={isBusy || !isAdminWallet}
                    className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm font-medium hover:bg-white/10 transition disabled:opacity-50"
                  >
                    {isBusy ? "..." : "Cancel"}
                  </button>
                )}

                {/* Primary CTA */}
                {drawerMode === "cancel_only_48h" ? (
                  <button
                    onClick={doCancel48h}
                    disabled={isBusy}
                    className="px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
                  >
                    {isBusy ? "Processing..." : "Cancel now"}
                  </button>
                ) : (
                  <button
                    onClick={doApprove}
                    disabled={isBusy || !isAdminWallet}
                    className="px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
                  >
                    {isBusy ? "Processing..." : "Approve now"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

