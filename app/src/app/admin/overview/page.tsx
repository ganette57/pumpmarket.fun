"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useProgram } from "@/hooks/useProgram";
import { sendSignedTx } from "@/lib/solanaSend";

/* ========= Constants ========= */

const PLATFORM_WALLET = "6szhvTU23WtiKXqPs8vuX5G7JXu2TcUdVJNByNwVGYMV";

/* ========= Types ========= */

type MarketType = "proposed_no_dispute" | "proposed_disputed" | "no_proposal_24h";

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
  // Block fields
  is_blocked?: boolean;
  blocked_reason?: string | null;
  blocked_at?: string | null;
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

type DrawerMode = "approve_only" | "approve_cancel" | "cancel_only_24h" | "block_only" | null;

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

type ActiveMarket = {
  market_address: string;
  question: string | null;
  category: string | null;
  image_url: string | null;
  end_date: string | null;
  total_volume: number | null;
  creator: string | null;
  market_type: number | null;
  outcome_names: any;
  resolution_status: string | null;
  is_blocked: boolean | null;
  blocked_reason: string | null;
  blocked_at: string | null;
  blocked_by: string | null;
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

function StatCard({
  label,
  value,
  hint,
  link,
}: {
  label: string;
  value: string;
  hint?: string;
  link?: { href: string; text: string };
}) {
  return (
    <div className="card-pump p-3 md:p-4">
      <div className="text-[10px] md:text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="text-lg md:text-2xl font-bold text-white mt-1">{value}</div>
      {hint ? <div className="text-[10px] md:text-xs text-gray-500 mt-1">{hint}</div> : null}
      {link ? (
        <a
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] md:text-xs text-pump-green hover:underline mt-1 inline-block"
        >
          {link.text} ↗
        </a>
      ) : null}
    </div>
  );
}

function formatWinningOutcomeLabel(row: { market_type?: number | null; outcome_names?: any; winning_outcome?: number | null }) {
  const idx = row.winning_outcome;
  if (idx == null) return "—";
  const mt = Number(row.market_type ?? 0);
  if (mt === 0) return idx === 0 ? "YES" : idx === 1 ? "NO" : String(idx);
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

  const [filter, setFilter] = useState<"inbox" | "resolved" | "blocked" | "active" | "all">("inbox");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  const [onchain, setOnchain] = useState<Record<string, OnchainInfo | null>>({});

  const [drawerMarket, setDrawerMarket] = useState<ActionableMarket | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [flowStep, setFlowStep] = useState<FlowStep>("idle");
  const [flowMsg, setFlowMsg] = useState<string>("");
  const [flowError, setFlowError] = useState<string>("");
  const [resolvedRows, setResolvedRows] = useState<ResolvedRow[]>([]);
  const [resolvedLoading, setResolvedLoading] = useState(false);
  const [resolvedErr, setResolvedErr] = useState<string | null>(null);

  // Block state
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockReason, setBlockReason] = useState("");

  // Active markets state
  const [activeMarkets, setActiveMarkets] = useState<ActiveMarket[]>([]);
  const [activeLoading, setActiveLoading] = useState(false);
  const [activeErr, setActiveErr] = useState<string | null>(null);

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

  // Calculate platform fees (1% of total volume)
  const platformFeesSol = useMemo(() => {
    if (!k) return 0;
    return k.volume_sol_total * 0.01;
  }, [k]);

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

  // Load resolved markets
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

  // Load active markets
  useEffect(() => {
    let cancelled = false;
    async function fetchActive() {
      if (filter !== "active") return;
      setActiveLoading(true);
      setActiveErr(null);
      try {
        const r = await fetch("/api/admin/active-markets", { credentials: "include", cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || j?.message || `HTTP ${r.status}`);
        if (!cancelled) setActiveMarkets((j?.markets || []) as ActiveMarket[]);
      } catch (e: any) {
        if (!cancelled) setActiveErr(e?.message || "Failed to load active markets");
      } finally {
        if (!cancelled) setActiveLoading(false);
      }
    }
    void fetchActive();
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

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      if (!program) return;
      if (!markets.length) return;
      const entries = await Promise.all(
        markets.map(async (m) => {
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
    return () => { cancelled = true; };
  }, [program, markets]);

  function isResolved(m: ActionableMarket) {
    const oc = onchain[m.market_address];
    return oc?.status === "finalized" || oc?.status === "cancelled";
  }

  const filteredMarkets = useMemo(() => {
    let list = [...markets];
    
    if (filter === "inbox") {
      list = list.filter((m) => m.is_actionable && !isResolved(m) && !m.is_blocked);
    } else if (filter === "resolved") {
      list = list.filter((m) => isResolved(m));
    } else if (filter === "blocked") {
      // ✅ FIX: Combine blocked from inbox + active markets
      const blockedFromInbox = markets.filter((m) => m.is_blocked);
      const blockedFromActive = activeMarkets
        .filter((m) => m.is_blocked)
        .map((m) => ({
          market_address: m.market_address,
          question: m.question,
          contest_deadline: null,
          contest_count: 0,
          end_date: m.end_date,
          proposed_winning_outcome: null,
          type: "proposed_no_dispute" as MarketType,
          is_actionable: false,
          due_date: m.end_date,
          is_blocked: true,
          blocked_reason: m.blocked_reason,
          blocked_at: m.blocked_at,
        }));
      
      // Dedupe by market_address
      const seen = new Set<string>();
      list = [];
      for (const m of [...blockedFromInbox, ...blockedFromActive]) {
        if (!seen.has(m.market_address)) {
          seen.add(m.market_address);
          list.push(m);
        }
      }
    }
    // "active" is handled separately
    // "all" shows everything
    
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.question?.toLowerCase().includes(q) ||
          m.market_address.toLowerCase().includes(q)
      );
    }
    
    list.sort((a, b) => {
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return sortDir === "asc" ? ad - bd : bd - ad;
    });
    
    return list;
  }, [markets, activeMarkets, filter, search, sortDir]);

  // Filter active markets by search
  const filteredActiveMarkets = useMemo(() => {
    if (!search.trim()) return activeMarkets;
    const q = search.toLowerCase();
    return activeMarkets.filter(
      (m) =>
        m.question?.toLowerCase().includes(q) ||
        m.market_address.toLowerCase().includes(q)
    );
  }, [activeMarkets, search]);

  // Count blocked markets (from actionable + active)
  const blockedCount = useMemo(() => {
    const fromActionable = markets.filter((m) => m.is_blocked).length;
    const fromActive = activeMarkets.filter((m) => m.is_blocked).length;
    return fromActionable + fromActive;
  }, [markets, activeMarkets]);

  // Count active markets
  const activeCount = useMemo(() => activeMarkets.length, [activeMarkets]);

  function getTypeBadge(m: ActionableMarket) {
    if (m.is_blocked) {
      return <Pill tone="blocked">🚫 Blocked</Pill>;
    }
    if (isResolved(m)) {
      return <Pill tone="ok">Resolved</Pill>;
    }
    if (m.type === "no_proposal_24h") {
      return <Pill tone="warn">No proposal 24h</Pill>;
    }
    if (m.type === "proposed_disputed") {
      return <Pill tone="pink">{m.contest_count} dispute{m.contest_count > 1 ? "s" : ""}</Pill>;
    }
    return <Pill tone="neutral">0 dispute</Pill>;
  }

  function getActionStatus(m: ActionableMarket) {
    if (m.is_blocked) {
      return <Pill tone="blocked">BLOCKED</Pill>;
    }
    if (m.is_actionable) {
      return <Pill tone="ok">READY</Pill>;
    }
    return <Pill tone="warn">WAIT</Pill>;
  }

  function openDrawer(m: ActionableMarket) {
    setDrawerMarket(m);
    setFlowStep("idle");
    setFlowMsg("");
    setFlowError("");
    setBlockReason(m.blocked_reason || "");
    if (m.type === "no_proposal_24h") {
      setDrawerMode("cancel_only_24h");
    } else if (m.type === "proposed_no_dispute") {
      setDrawerMode("approve_only");
    } else {
      setDrawerMode("approve_cancel");
    }
  }

  // Open drawer for active market (block/unblock only)
  function openDrawerForActive(m: ActiveMarket) {
    const fakeActionable: ActionableMarket = {
      market_address: m.market_address,
      question: m.question,
      contest_deadline: null,
      contest_count: 0,
      end_date: m.end_date,
      proposed_winning_outcome: null,
      type: "proposed_no_dispute",
      is_actionable: false,
      due_date: m.end_date,
      is_blocked: !!m.is_blocked,
      blocked_reason: m.blocked_reason,
      blocked_at: m.blocked_at,
    };
    setDrawerMarket(fakeActionable);
    setDrawerMode("block_only");
    setFlowStep("idle");
    setFlowMsg("");
    setFlowError("");
    setBlockReason(m.blocked_reason || "");
  }

  function closeDrawer() {
    setDrawerMarket(null);
    setDrawerMode(null);
    setFlowStep("idle");
    setFlowMsg("");
    setFlowError("");
    setBlockReason("");
  }

  // Helper: Fresh fetch on-chain state
  async function fetchFreshOnchainState(marketAddr: string): Promise<{
    status: string;
    disputeCount: number;
    proposedOutcome: number | null;
  }> {
    if (!program) throw new Error("Program not ready");
    
    const marketPk = new PublicKey(marketAddr);
    const acct: any = await (program as any).account.market.fetch(marketPk);
    
    const status = parseAnchorEnum(acct?.status);
    const disputeCount =
      (bnToNumberOrNull(acct?.disputeCount) ??
        bnToNumberOrNull(acct?.dispute_count) ??
        0) || 0;
    const proposedOutcome =
      bnToNumberOrNull(acct?.proposedOutcome) ??
      bnToNumberOrNull(acct?.proposed_outcome) ??
      null;

    console.log(`[fetchFreshOnchainState] ${marketAddr}: status=${status}, disputeCount=${disputeCount}, proposedOutcome=${proposedOutcome}`);
    
    return { status, disputeCount, proposedOutcome };
  }

  // Block/Unblock handler
  async function doToggleBlock() {
    if (!drawerMarket) return;
    if (!isAdminWallet) {
      setFlowError(`Wrong wallet. Must be ${ADMIN_PUBKEY.toBase58()}`);
      return;
    }

    const isCurrentlyBlocked = !!drawerMarket.is_blocked;
    const action = isCurrentlyBlocked ? "unblock" : "block";

    setBlockLoading(true);
    setFlowError("");

    try {
      const res = await postJSON<{ ok: boolean; action: string }>("/api/admin/market/block", {
        market_address: drawerMarket.market_address,
        action,
        reason: blockReason || "Blocked by admin",
        admin_wallet: publicKey?.toBase58(),
      });

      if (res.ok) {
        setFlowMsg(`Market ${action}ed successfully!`);
        // Refresh data
        setTimeout(() => {
          closeDrawer();
          load();
          // Also refresh active markets if we're on that tab
          if (filter === "active") {
            setActiveMarkets([]);
            // Trigger re-fetch
            setFilter("inbox");
            setTimeout(() => setFilter("active"), 100);
          }
        }, 1500);
      }
    } catch (e: any) {
      setFlowError(e?.message || `Failed to ${action} market`);
    } finally {
      setBlockLoading(false);
    }
  }

  // APPROVE FLOW
  async function doApprove() {
    if (!drawerMarket) return;
    if (!program) return setFlowError("Program not ready");
    if (!publicKey || !signTransaction) return setFlowError("Connect wallet");
    if (!isAdminWallet) return setFlowError(`Wrong wallet. Must be ${ADMIN_PUBKEY.toBase58()}`);

    if (drawerMarket.is_blocked) {
      setFlowError("Cannot approve a blocked market. Unblock it first.");
      return;
    }

    const marketAddr = drawerMarket.market_address;
    const marketPk = new PublicKey(marketAddr);

    setFlowStep("checking");
    setFlowMsg("Checking on-chain state...");
    setFlowError("");

    try {
      let onchainState: { status: string; disputeCount: number; proposedOutcome: number | null };
      
      try {
        onchainState = await fetchFreshOnchainState(marketAddr);
      } catch (fetchErr) {
        console.warn("[doApprove] Could not fetch on-chain state:", fetchErr);
        const oc = onchain[marketAddr];
        onchainState = {
          status: oc?.status ?? "unknown",
          disputeCount: oc?.disputeCount ?? 0,
          proposedOutcome: oc?.proposedOutcome ?? null,
        };
      }

      if (onchainState.status === "finalized") {
        setFlowStep("done");
        setFlowMsg("Market already finalized on-chain!");
        setTimeout(() => { closeDrawer(); load(); }, 2000);
        return;
      }

      if (onchainState.status === "cancelled") {
        setFlowStep("error");
        setFlowError("Market already cancelled on-chain. Cannot approve.");
        return;
      }

      setFlowMsg("Checking server...");
      const prep = await postJSON<{
        ok: boolean;
        market: { market_address: string; proposed_winning_outcome: number | null; contest_count: number };
      }>("/api/admin/market/approve", { market: marketAddr });

      if (!prep.ok) throw new Error("Server check failed");

      const onchainDisputes = onchainState.disputeCount;
      const wo =
        (Number.isFinite(Number(onchainState.proposedOutcome)) ? Number(onchainState.proposedOutcome) : null) ??
        (Number.isFinite(Number(prep?.market?.proposed_winning_outcome))
          ? Number(prep.market.proposed_winning_outcome)
          : null);

      setFlowStep("signing");
      setFlowMsg("Signing on-chain tx...");

      let txSig: string;

      if (onchainDisputes > 0) {
        if (wo == null) throw new Error("No winning outcome for disputed market");
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
        const tx = await (program as any).methods
          .adminFinalizeNoDisputes()
          .accounts({ market: marketPk, admin: publicKey })
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

      const finalWo = wo ?? (onchainState.proposedOutcome ?? drawerMarket.proposed_winning_outcome ?? 0);
      await postJSON("/api/admin/market/approve/commit", {
        market: marketAddr,
        winning_outcome: finalWo,
        tx_sig: txSig,
      });

      setFlowStep("done");
      setFlowMsg(`Approved! tx=${shortAddr(txSig)}`);

      setTimeout(() => {
        closeDrawer();
        load();
      }, 2000);
    } catch (e: unknown) {
      setFlowStep("error");
      setFlowError(explainError(e));
    }
  }

  // CANCEL FLOW (disputed)
  async function doCancel() {
    if (!drawerMarket) return;
    if (!program) return setFlowError("Program not ready");
    if (!publicKey || !signTransaction) return setFlowError("Connect wallet");
    if (!isAdminWallet) return setFlowError(`Wrong wallet. Must be ${ADMIN_PUBKEY.toBase58()}`);

    const marketAddr = drawerMarket.market_address;
    const marketPk = new PublicKey(marketAddr);

    setFlowStep("checking");
    setFlowMsg("Checking on-chain state...");
    setFlowError("");

    try {
      let onchainState: { status: string; disputeCount: number; proposedOutcome: number | null };

      try {
        onchainState = await fetchFreshOnchainState(marketAddr);
      } catch (fetchErr) {
        console.warn("[doCancel] Could not fetch on-chain state:", fetchErr);
        const oc = onchain[marketAddr];
        onchainState = {
          status: oc?.status ?? "unknown",
          disputeCount: oc?.disputeCount ?? 0,
          proposedOutcome: oc?.proposedOutcome ?? null,
        };
      }

      if (onchainState.status === "cancelled") {
        setFlowStep("committing");
        setFlowMsg("Market already cancelled on-chain. Syncing DB...");

        await postJSON("/api/admin/market/cancel/commit", {
          market: marketAddr,
          tx_sig: "already_cancelled_onchain",
        });

        setFlowStep("done");
        setFlowMsg("DB synced with on-chain state!");

        setTimeout(() => {
          closeDrawer();
          load();
        }, 2000);
        return;
      }

      if (onchainState.status === "finalized") {
        setFlowStep("error");
        setFlowError("Market already finalized on-chain. Cannot cancel.");
        return;
      }

      if (onchainState.disputeCount <= 0) {
        setFlowStep("error");
        setFlowError(`No disputes on-chain (found ${onchainState.disputeCount}). Cannot use admin_cancel.`);
        return;
      }

      setFlowMsg(`Found ${onchainState.disputeCount} dispute(s). Checking server...`);
      await postJSON("/api/admin/market/cancel", { market: marketAddr });

      setFlowStep("signing");
      setFlowMsg("Signing cancel tx...");

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

  // CANCEL 24H FLOW (no proposal)
  async function doCancel24h() {
    if (!drawerMarket) return;
    if (!program) return setFlowError("Program not ready");
    if (!publicKey || !signTransaction) return setFlowError("Connect wallet");
    if (!isAdminWallet) return setFlowError(`Wrong wallet. Must be ${ADMIN_PUBKEY.toBase58()}`);
  
    const marketAddr = drawerMarket.market_address;
    const marketPk = new PublicKey(marketAddr);

    setFlowStep("checking");
    setFlowMsg("Checking on-chain state...");
    setFlowError("");
  
    try {
      let onchainStatus = "unknown";
      
      try {
        const state = await fetchFreshOnchainState(marketAddr);
        onchainStatus = state.status;
      } catch (fetchErr) {
        console.warn("[doCancel24h] Could not fetch on-chain state:", fetchErr);
      }
  
      if (onchainStatus === "cancelled") {
        setFlowStep("committing");
        setFlowMsg("Market already cancelled on-chain. Syncing DB...");
  
        await postJSON("/api/admin/market/cancel/commit", {
          market: marketAddr,
          tx_sig: "already_cancelled_onchain",
          reason: "no_proposal_24h",
        });
  
        setFlowStep("done");
        setFlowMsg("DB synced with on-chain state!");
  
        setTimeout(() => {
          closeDrawer();
          load();
        }, 2000);
        return;
      }
  
      if (onchainStatus === "finalized") {
        setFlowStep("error");
        setFlowError("Market already finalized on-chain. Cannot cancel.");
        return;
      }
  
      setFlowMsg("Checking server...");
  
      await postJSON("/api/admin/market/cancel", {
        market: marketAddr,
        action: "cancel_if_no_proposal",
      });
  
      setFlowStep("signing");
      setFlowMsg("Signing cancel tx...");
  
      const tx = await (program as any).methods
        .adminCancelNoProposal()
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
        reason: "no_proposal_24h",
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

  // RENDER

  const isBusy = flowStep !== "idle" && flowStep !== "done" && flowStep !== "error";

  return (
    <div className="min-h-screen bg-pump-dark">
      <div className="max-w-7xl mx-auto px-4 py-6">
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
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mb-6">
              <StatCard
                label="Markets"
                value={`${k.markets_total}`}
                hint={`open ${k.markets_open} • proposed ${k.markets_proposed}`}
              />
              <StatCard
                label="Volume"
                value={`${k.volume_sol_total.toFixed(2)} SOL`}
                hint="total traded"
              />
              <StatCard
                label="Transactions"
                value={`${k.tx_count}`}
                hint={`${k.unique_traders} traders`}
              />
              <StatCard
                label="Disputes"
                value={`${k.disputes_total}`}
                hint={`open ${k.disputes_open}`}
              />
              <StatCard
                label="Platform Fees"
                value={`${platformFeesSol.toFixed(4)} SOL`}
                hint="1% of volume"
                link={{
                  href: `https://explorer.solana.com/address/${PLATFORM_WALLET}?cluster=devnet`,
                  text: "Verify on Explorer",
                }}
              />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="flex items-center gap-1 bg-pump-dark-lighter rounded-lg p-1">
                <button
                  onClick={() => setFilter("inbox")}
                  className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition ${
                    filter === "inbox" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  Inbox (actionable)
                </button>
                <button
                  onClick={() => setFilter("active")}
                  className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition ${
                    filter === "active" ? "bg-blue-600/20 text-blue-400" : "text-gray-400 hover:text-white"
                  }`}
                >
                  Active {activeCount > 0 ? `(${activeCount})` : ""}
                </button>
                <button
                  onClick={() => setFilter("resolved")}
                  className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition ${
                    filter === "resolved" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  Resolved
                </button>
                <button
                  onClick={() => setFilter("blocked")}
                  className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition ${
                    filter === "blocked" ? "bg-red-600/20 text-red-400" : "text-gray-400 hover:text-white"
                  }`}
                >
                  Blocked {blockedCount > 0 ? `(${blockedCount})` : ""}
                </button>
                <button
                  onClick={() => setFilter("all")}
                  className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition ${
                    filter === "all" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
                  }`}
                >
                  All
                </button>
              </div>

              <button
                onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-pump-dark-lighter text-gray-300 text-xs md:text-sm hover:text-white transition"
              >
                Date {sortDir === "asc" ? "↓" : "↑"}
              </button>

              <div className="flex-1" />

              <input
                type="text"
                placeholder="Search question or address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full md:w-72 px-3 md:px-4 py-2 rounded-lg bg-white text-black placeholder-gray-500 border border-white/20 text-xs md:text-sm focus:outline-none focus:ring-2 focus:ring-pump-green"
              />
            </div>

            {/* Table */}
            <div className="card-pump overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left text-[10px] md:text-xs text-gray-500 uppercase tracking-wide px-3 md:px-4 py-3">
                      Market
                    </th>
                    <th className="text-left text-[10px] md:text-xs text-gray-500 uppercase tracking-wide px-3 md:px-4 py-3">
                      Type
                    </th>
                    <th className="text-left text-[10px] md:text-xs text-gray-500 uppercase tracking-wide px-3 md:px-4 py-3">
                      {filter === "active" ? "Ends" : "Due"}
                    </th>
                    <th className="text-right text-[10px] md:text-xs text-gray-500 uppercase tracking-wide px-3 md:px-4 py-3">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* ACTIVE MARKETS TAB */}
                  {filter === "active" ? (
                    activeLoading ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                          Loading active markets...
                        </td>
                      </tr>
                    ) : activeErr ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-red-300">
                          {activeErr}
                        </td>
                      </tr>
                    ) : filteredActiveMarkets.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                          No active markets (all markets have ended).
                        </td>
                      </tr>
                    ) : (
                      filteredActiveMarkets.map((m) => (
                        <tr
                          key={m.market_address}
                          className={`border-b border-white/5 hover:bg-white/2 transition ${
                            m.is_blocked ? "bg-red-900/10" : ""
                          }`}
                        >
                          <td className="px-3 md:px-4 py-3">
                            <div className="text-white font-medium truncate max-w-[200px] md:max-w-xs text-sm">
                              {m.question || "(Untitled)"}
                            </div>
                            <div className="text-[10px] md:text-xs text-gray-500 font-mono">
                              {m.market_address}
                            </div>
                            {m.is_blocked && m.blocked_reason && (
                              <div className="text-[10px] text-red-400 mt-1">
                                Blocked: {m.blocked_reason}
                              </div>
                            )}
                          </td>
                          <td className="px-3 md:px-4 py-3">
                            {m.is_blocked ? (
                              <Pill tone="blocked">🚫 Blocked</Pill>
                            ) : (
                              <Pill tone="active">🟢 Active</Pill>
                            )}
                          </td>
                          <td className="px-3 md:px-4 py-3">
                            <span className="text-xs md:text-sm text-gray-400">
                              {formatDate(m.end_date)}
                            </span>
                          </td>
                          <td className="px-3 md:px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={`/trade/${m.market_address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 md:px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition"
                              >
                                View
                              </Link>
                              <button
                                onClick={() => openDrawerForActive(m)}
                                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                                  m.is_blocked
                                    ? "bg-pump-green text-black hover:opacity-90"
                                    : "bg-red-600 text-white hover:bg-red-700"
                                }`}
                              >
                                {m.is_blocked ? "Unblock" : "Block"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )
                  ) : filter === "resolved" ? (
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
                          <td className="px-3 md:px-4 py-3">
                            <div className="text-white font-medium truncate max-w-[200px] md:max-w-xs text-sm">
                              {m.question || "(Untitled)"}
                            </div>
                            <div className="text-[10px] md:text-xs text-gray-500 font-mono break-all">
                              {m.market_address}
                            </div>
                          </td>
                          <td className="px-3 md:px-4 py-3">
                            <div className="flex flex-wrap gap-1 md:gap-2 items-center">
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
                              <div className="text-[10px] text-gray-500 mt-1 font-mono truncate max-w-[150px]">
                                tx: {m.tx_sig}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 md:px-4 py-3">
                            <span className="text-xs md:text-sm text-gray-400">{formatDate(m.resolved_at)}</span>
                          </td>
                          <td className="px-3 md:px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={`/trade/${m.market_address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 md:px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition"
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
                          className={`border-b border-white/5 hover:bg-white/2 transition ${
                            m.is_blocked ? "bg-red-900/10" : ""
                          }`}
                        >
                          <td className="px-3 md:px-4 py-3">
                            <div className="text-white font-medium truncate max-w-[200px] md:max-w-xs text-sm">
                              {m.question || "(Untitled)"}
                            </div>
                            <div className="text-[10px] md:text-xs text-gray-500 font-mono">
                              {m.market_address}
                            </div>
                            {m.is_blocked && m.blocked_reason && (
                              <div className="text-[10px] text-red-400 mt-1">
                                Reason: {m.blocked_reason}
                              </div>
                            )}
                          </td>
                          <td className="px-3 md:px-4 py-3">{getTypeBadge(m)}</td>
                          <td className="px-3 md:px-4 py-3">
                            <div className="flex items-center gap-2">
                              {getActionStatus(m)}
                              <span className="text-xs md:text-sm text-gray-400">{formatDate(m.due_date)}</span>
                            </div>
                          </td>
                          <td className="px-3 md:px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={`/trade/${m.market_address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 md:px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-xs font-medium hover:bg-white/10 transition"
                              >
                                View
                              </Link>
                              <button
                                onClick={() => openDrawer(m)}
                                disabled={!m.is_actionable && !m.is_blocked}
                                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                                  m.is_blocked
                                    ? "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                                    : m.is_actionable
                                    ? "bg-pump-green text-black hover:opacity-90"
                                    : "bg-gray-700 text-gray-500 cursor-not-allowed"
                                }`}
                              >
                                {m.is_blocked ? "Manage" : "Open"}
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
          <div className="flex-1 bg-black/60 z-[9998]" onClick={closeDrawer} />
          <div className="fixed right-0 top-0 z-[9999] h-dvh w-full max-w-md bg-pump-dark border-l border-white/10 flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
              <div className="card-pump p-4 mb-4">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                  Market
                </div>
                <div className="text-base md:text-lg font-bold text-white mb-1">
                  {drawerMarket.question || "(Untitled)"}
                </div>
                <div className="text-[10px] md:text-xs text-gray-400 font-mono mb-3 break-all">
                  {drawerMarket.market_address}
                </div>
                <div className="flex flex-wrap gap-2">
                  {getTypeBadge(drawerMarket)}
                  {drawerMode === "approve_only" && !drawerMarket.is_blocked && (
                    <Pill tone="ok">Approve only</Pill>
                  )}
                  {drawerMode === "approve_cancel" && !drawerMarket.is_blocked && (
                    <Pill tone="ok">Approve / Cancel</Pill>
                  )}
                  {drawerMode === "cancel_only_24h" && !drawerMarket.is_blocked && (
                    <Pill tone="warn">Cancel only</Pill>
                  )}
                  {drawerMode === "block_only" && (
                    <Pill tone="active">Active market</Pill>
                  )}
                </div>
              </div>

              {/* Block/Unblock Section */}
              <div className="card-pump p-4 mb-4 border-red-600/30">
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                  🚫 Market Moderation
                </div>
                
                {drawerMarket.is_blocked ? (
                  <div className="mb-3 p-3 rounded-lg bg-red-600/20 border border-red-600/30">
                    <div className="text-sm text-red-400 font-semibold mb-1">
                      This market is currently BLOCKED
                    </div>
                    <div className="text-xs text-gray-400">
                      Reason: {drawerMarket.blocked_reason || "No reason specified"}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Blocked at: {formatDate(drawerMarket.blocked_at)}
                    </div>
                  </div>
                ) : (
                  <div className="mb-3 text-sm text-gray-400">
                    Block this market to prevent trading. Users will see a blocked message.
                    You can still cancel/refund later via admin_cancel.
                  </div>
                )}

                <div className="mb-3">
                  <label className="text-xs text-gray-400 block mb-1">
                    {drawerMarket.is_blocked ? "Update reason (optional)" : "Block reason"}
                  </label>
                  <input
                    type="text"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    placeholder="e.g., Inappropriate content, TOS violation..."
                    className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                  />
                </div>

                <button
                  onClick={doToggleBlock}
                  disabled={blockLoading || !isAdminWallet}
                  className={`w-full py-2.5 rounded-lg font-semibold text-sm transition ${
                    drawerMarket.is_blocked
                      ? "bg-pump-green text-black hover:opacity-90"
                      : "bg-red-600 text-white hover:bg-red-700"
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {blockLoading
                    ? "Processing..."
                    : drawerMarket.is_blocked
                    ? "✅ Unblock Market"
                    : "🚫 Block Market"}
                </button>

                {!isAdminWallet && (
                  <div className="text-xs text-red-400 mt-2 text-center">
                    Connect admin wallet to manage
                  </div>
                )}
              </div>

              {/* Resolution Flow - only show if NOT block_only mode and NOT blocked */}
              {drawerMode !== "block_only" && !drawerMarket.is_blocked && (
                <div className="card-pump p-4 mb-4">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                    Resolution Flow
                  </div>
                  <ol className="space-y-2 text-xs md:text-sm">
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
                  <div className="mt-3 text-[10px] md:text-xs text-gray-500">
                    step: {flowStep}
                  </div>
                  {flowMsg && (
                    <div className="mt-2 text-xs md:text-sm text-pump-green">{flowMsg}</div>
                  )}
                  {flowError && (
                    <div className="mt-2 text-xs md:text-sm text-red-400">{flowError}</div>
                  )}
                </div>
              )}

              {/* Show messages for block_only mode */}
              {drawerMode === "block_only" && (flowError || flowMsg) && (
                <div className="card-pump p-4 mb-4">
                  {flowMsg && (
                    <div className="text-xs md:text-sm text-pump-green">{flowMsg}</div>
                  )}
                  {flowError && (
                    <div className="text-xs md:text-sm text-red-400">{flowError}</div>
                  )}
                </div>
              )}

              {drawerMode !== "block_only" && (
                <div className="text-[10px] md:text-xs text-gray-500 mt-4">
                  <div className="mb-1">Methods used:</div>
                  <div className="break-words">
                    no-dispute: <strong>adminFinalizeNoDisputes()</strong> •{" "}
                    disputed: <strong>adminFinalize(u8)</strong> •{" "}
                    cancel: <strong>adminCancel()</strong> •{" "}
                    24h cancel: <strong>adminCancelNoProposal()</strong>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-white/10 p-4 flex items-center justify-between gap-3">
              <button
                onClick={closeDrawer}
                disabled={isBusy || blockLoading}
                className="px-4 py-2 rounded-lg bg-white/5 text-white text-xs md:text-sm font-medium hover:bg-white/10 transition disabled:opacity-50"
              >
                Close
              </button>

              {/* Only show resolution buttons if NOT block_only and NOT blocked */}
              {drawerMode !== "block_only" && !drawerMarket.is_blocked && (
                <div className="flex gap-2">
                  {drawerMode === "approve_cancel" && (
                    <button
                      onClick={doCancel}
                      disabled={isBusy || !isAdminWallet}
                      className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-xs md:text-sm font-medium hover:bg-white/10 transition disabled:opacity-50"
                    >
                      {isBusy ? "..." : "Cancel"}
                    </button>
                  )}

                  {drawerMode === "cancel_only_24h" ? (
                    <button
                      onClick={doCancel24h}
                      disabled={isBusy || !isAdminWallet}
                      className="px-4 py-2 rounded-lg bg-pump-green text-black text-xs md:text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
                    >
                      {isBusy ? "Processing..." : "Cancel now"}
                    </button>
                  ) : (
                    <button
                      onClick={doApprove}
                      disabled={isBusy || !isAdminWallet}
                      className="px-4 py-2 rounded-lg bg-pump-green text-black text-xs md:text-sm font-semibold hover:opacity-90 transition disabled:opacity-50"
                    >
                      {isBusy ? "Processing..." : "Approve now"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}