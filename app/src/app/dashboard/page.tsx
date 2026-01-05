// src/app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { supabase } from "@/lib/supabaseClient";
import { useProgram } from "@/hooks/useProgram";
import { lamportsToSol, getUserPositionPDA } from "@/utils/solana";
import { outcomeLabelFromMarket } from "@/utils/outcomes";

import { uploadResolutionProofImage } from "@/lib/proofs";
import { proposeResolution } from "@/lib/markets";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function shortSig(sig?: string) {
  if (!sig) return "";
  if (sig.length <= 12) return sig;
  return `${sig.slice(0, 6)}…${sig.slice(-4)}`;
}

function shortAddr(a?: string) {
  if (!a) return "";
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function toNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isMarketEnded(endDate?: string): boolean {
  if (!endDate) return false;
  const end = new Date(endDate);
  return end.getTime() <= Date.now();
}

function formatTimeStatus(endDate?: string): string {
  if (!endDate) return "No end date";
  const end = new Date(endDate);
  const now = Date.now();
  if (end.getTime() <= now) return "Ended";

  const diff = end.getTime() - now;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;
  return "< 1h left";
}

function formatMsToHhMm(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / (60 * 1000)));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function toResolutionStatus(x: any): "open" | "proposed" | "finalized" | "cancelled" {
  const s = String(x || "").toLowerCase().trim();
  if (s === "proposed" || s === "finalized" || s === "cancelled") return s;
  return "open";
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type DbMarket = {
  id?: string;
  market_address?: string;
  creator?: string;
  question?: string;
  total_volume?: number; // lamports
  end_date?: string;
  resolved?: boolean;
  outcome_names?: string[] | null;

  // legacy resolved fields
  winning_outcome?: number | null;
  resolved_at?: string | null;
  resolution_proof_url?: string | null;
  resolution_proof_image?: string | null;
  resolution_proof_note?: string | null;

  // off-chain contest flow
  resolution_status?: "open" | "proposed" | "finalized" | "cancelled" | string | null;
  proposed_winning_outcome?: number | null;
  resolution_proposed_at?: string | null;
  contest_deadline?: string | null;
  contested?: boolean | null;
  contest_count?: number | null;

  proposed_proof_url?: string | null;
  proposed_proof_image?: string | null;
  proposed_proof_note?: string | null;
};

type DbTx = {
  id?: string;
  created_at?: string;

  market_id?: string | null;
  market_address?: string | null;
  user_address?: string | null;

  // legacy
  is_buy?: boolean | null;
  is_yes?: boolean | null;
  amount?: number | null;
  cost?: number | null;
  tx_signature?: string | null;

  // new
  outcome_index?: number | null;
  shares?: number | null;
  outcome_name?: string | null;
};

type Claimable = {
  marketAddress: string;
  marketQuestion: string;
  estPayoutLamports?: number;
  winningIndex?: number;
};

// ✅ bookmarks now store market_id (uuid)
type BookmarkRow = {
  market_id: string;
  created_at?: string;
};

/* -------------------------------------------------------------------------- */
/* Data fetch (schema-resilient)                                              */
/* -------------------------------------------------------------------------- */

async function safeFetchUserTransactions(walletAddress: string, limit = 50): Promise<DbTx[]> {
  const trySelects = [
    "id,created_at,market_id,market_address,user_address,is_buy,is_yes,amount,cost,tx_signature,outcome_index,shares,outcome_name",
    "id,created_at,market_id,market_address,user_address,is_buy,is_yes,amount,cost,tx_signature",
  ];

  for (const sel of trySelects) {
    const { data, error } = await supabase
      .from("transactions")
      .select(sel)
      .eq("user_address", walletAddress)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!error) return (data as any[]) || [];
    const msg = String((error as any)?.message || "");
    if (!msg.includes("does not exist")) {
      console.error("safeFetchUserTransactions error:", error);
      return [];
    }
  }
  return [];
}

async function safeFetchMyCreatedMarkets(walletBase58: string): Promise<DbMarket[]> {
  const trySelects = [
    [
      "id",
      "created_at",
      "market_address",
      "creator",
      "question",
      "total_volume",
      "end_date",
      "resolved",
      "outcome_names",

      "winning_outcome",
      "resolved_at",
      "resolution_proof_url",
      "resolution_proof_image",
      "resolution_proof_note",

      "resolution_status",
      "proposed_winning_outcome",
      "resolution_proposed_at",
      "contest_deadline",
      "contested",
      "contest_count",
      "proposed_proof_url",
      "proposed_proof_image",
      "proposed_proof_note",
      "cancelled_at",
      "cancel_reason",
    ].join(","),
    "id,created_at,market_address,creator,question,total_volume,end_date,resolved,outcome_names",
    "id,market_address,creator,question,total_volume,end_date,resolved",
  ];

  for (const sel of trySelects) {
    const { data, error } = await supabase
      .from("markets")
      .select(sel)
      .eq("creator", walletBase58)
      .order("created_at", { ascending: false });

    if (!error) return (((data as any[]) || []) as DbMarket[]) || [];
    const msg = String((error as any)?.message || "");
    if (!msg.includes("does not exist") && !msg.includes("column")) {
      console.error("safeFetchMyCreatedMarkets error:", error);
      return [];
    }
  }
  return [];
}

// ✅ local-only helper: fetch bookmarked markets by DB ids (uuid)
async function safeFetchMarketsByIds(ids: string[]): Promise<DbMarket[]> {
  if (!ids.length) return [];
  const trySelects = [
    [
      "id",
      "market_address",
      "creator",
      "question",
      "total_volume",
      "end_date",
      "resolved",
      "outcome_names",

      "winning_outcome",
      "resolved_at",
      "resolution_proof_url",
      "resolution_proof_image",
      "resolution_proof_note",

      "resolution_status",
      "proposed_winning_outcome",
      "resolution_proposed_at",
      "contest_deadline",
      "contested",
      "contest_count",
      "proposed_proof_url",
      "proposed_proof_image",
      "proposed_proof_note",
    ].join(","),
    "id,market_address,creator,question,total_volume,end_date,resolved,outcome_names",
    "id,market_address,question,total_volume,end_date,resolved",
  ];

  for (const sel of trySelects) {
    const { data, error } = await supabase
      .from("markets")
      .select(sel)
      .in("id", ids.slice(0, 200));

    if (!error) return (((data as any[]) || []) as DbMarket[]) || [];
    const msg = String((error as any)?.message || "");
    if (!msg.includes("does not exist") && !msg.includes("column")) {
      console.error("safeFetchMarketsByIds error:", error);
      return [];
    }
  }
  return [];
}

async function safeFetchBookmarks(walletAddress: string, limit = 200): Promise<BookmarkRow[]> {
  const tryTables = ["bookmarks", "market_bookmarks"];

  for (const table of tryTables) {
    const { data, error } = await supabase
      .from(table)
      // ✅ market_id instead of market_address
      .select("market_id,created_at")
      .eq("user_address", walletAddress)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!error) return (data as any[]) || [];
    const msg = String((error as any)?.message || "");
    if (!msg.toLowerCase().includes("does not exist") && !msg.toLowerCase().includes("relation")) {
      console.warn("safeFetchBookmarks error:", error);
      return [];
    }
  }

  return [];
}

/* -------------------------------------------------------------------------- */
/* UI: Tabs                                                                    */
/* -------------------------------------------------------------------------- */

type TabKey = "activity" | "created" | "bookmarks";

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-4 py-2 rounded-xl text-sm font-semibold transition border",
        active
          ? "bg-pump-green text-black border-pump-green"
          : "bg-black/30 text-gray-300 border-white/10 hover:border-white/20",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export default function DashboardPage() {
  const { publicKey, connected } = useWallet();
  const walletBase58 = publicKey?.toBase58() || "";
  const { connection } = useConnection();
  const program = useProgram();

  const [tab, setTab] = useState<TabKey>("activity");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [loadingTxs, setLoadingTxs] = useState(false);
  const [loadingClaimables, setLoadingClaimables] = useState(false);
  const [loadingBookmarks, setLoadingBookmarks] = useState(false);

  const [myCreatedMarkets, setMyCreatedMarkets] = useState<DbMarket[]>([]);
  const [myTxs, setMyTxs] = useState<DbTx[]>([]);
  const [claimables, setClaimables] = useState<Claimable[]>([]);
  const [claimingMarket, setClaimingMarket] = useState<string | null>(null);

  // ✅ bookmarks now track DB ids
  const [bookmarkIds, setBookmarkIds] = useState<string[]>([]);
  const [bookmarkedMarkets, setBookmarkedMarkets] = useState<DbMarket[]>([]);

  // resolve/propose modal
  const [resolvingMarket, setResolvingMarket] = useState<DbMarket | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);

  // proof
  type ProofMode = "upload" | "link";
  const [proofMode, setProofMode] = useState<ProofMode>("upload");
  const [proofUrl, setProofUrl] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string>("");
  const [proofNote, setProofNote] = useState("");

  const proofOk = proofMode === "link" ? proofUrl.trim().length > 0 : !!proofFile;

  function setMode(m: ProofMode) {
    setProofMode(m);
    setProofUrl("");
    setProofFile(null);
    setProofPreview("");
  }

  function resetResolveModal() {
    setResolvingMarket(null);
    setSelectedOutcome(null);

    setProofMode("upload");
    setProofUrl("");
    setProofFile(null);
    setProofPreview("");
    setProofNote("");
  }

  // cleanup preview urls
  useEffect(() => {
    return () => {
      if (proofPreview) URL.revokeObjectURL(proofPreview);
    };
  }, [proofPreview]);

  // derived maps for tx outcome labels
  const marketsByAddress = useMemo(() => {
    const m = new Map<string, DbMarket>();
    for (const mk of [...myCreatedMarkets, ...bookmarkedMarkets]) {
      if (mk.market_address) m.set(mk.market_address, mk);
    }
    return m;
  }, [myCreatedMarkets, bookmarkedMarkets]);

  /* ---------------- Load base dashboard data ---------------- */

  useEffect(() => {
    if (!connected || !walletBase58) {
      setErrorMsg(null);
      setMyCreatedMarkets([]);
      setMyTxs([]);
      setClaimables([]);
      setBookmarkIds([]);
      setBookmarkedMarkets([]);
      return;
    }

    let cancelled = false;

    (async () => {
      setErrorMsg(null);

      setLoadingMarkets(true);
      setLoadingTxs(true);
      setLoadingBookmarks(true);

      try {
        const [markets, txs, bms] = await Promise.all([
          safeFetchMyCreatedMarkets(walletBase58),
          safeFetchUserTransactions(walletBase58, 80),
          safeFetchBookmarks(walletBase58, 200),
        ]);

        if (cancelled) return;

        setMyCreatedMarkets(markets || []);
        setMyTxs(txs || []);

        // ✅ bookmarks -> market_id list
        const ids = Array.from(new Set((bms || []).map((x) => String(x.market_id || "")).filter(Boolean)));
        setBookmarkIds(ids);
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || "Failed to load dashboard");
      } finally {
        if (!cancelled) {
          setLoadingMarkets(false);
          setLoadingTxs(false);
          setLoadingBookmarks(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, walletBase58]);

  /* ---------------- Load bookmarked market rows ---------------- */

  useEffect(() => {
    if (!connected || !walletBase58) return;
    let cancelled = false;

    (async () => {
      if (!bookmarkIds.length) {
        setBookmarkedMarkets([]);
        return;
      }
      setLoadingBookmarks(true);
      try {
        const mkts = await safeFetchMarketsByIds(bookmarkIds);

        // keep bookmark order stable
        const byId = new Map<string, DbMarket>();
        for (const m of mkts || []) if (m.id) byId.set(String(m.id), m);
        const ordered = bookmarkIds.map((id) => byId.get(id)).filter(Boolean) as DbMarket[];

        if (!cancelled) setBookmarkedMarkets(ordered);
      } catch {
        if (!cancelled) setBookmarkedMarkets([]);
      } finally {
        if (!cancelled) setLoadingBookmarks(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, walletBase58, bookmarkIds]);

  /* ---------------- Claimables (on-chain) ---------------- */

  useEffect(() => {
    if (!connected || !publicKey || !program) {
      setClaimables([]);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoadingClaimables(true);
      try {
        // gather candidate markets: created + bookmarked + traded
        const addresses: string[] = [];

        for (const m of myCreatedMarkets) if (m.market_address) addresses.push(String(m.market_address));
        for (const m of bookmarkedMarkets) if (m.market_address) addresses.push(String(m.market_address));
        for (const t of myTxs) if (t.market_address) addresses.push(String(t.market_address));

        const unique = Array.from(new Set(addresses)).slice(0, 60);
        const out: Claimable[] = [];

        for (const addr of unique) {
          if (cancelled) return;

          let marketPk: PublicKey;
          try {
            marketPk = new PublicKey(addr);
          } catch {
            continue;
          }

          let marketAcc: any = null;
          try {
            marketAcc = await (program as any).account.market.fetch(marketPk);
          } catch {
            continue;
          }

          const resolved = !!marketAcc?.resolved;
          const winningOpt = marketAcc?.winningOutcome;

          const winningIndex =
            winningOpt == null
              ? null
              : typeof winningOpt === "number"
              ? winningOpt
              : typeof winningOpt?.toNumber === "function"
              ? winningOpt.toNumber()
              : Number(winningOpt);

          if (!resolved || winningIndex == null || !Number.isFinite(winningIndex)) continue;

          const [posPda] = getUserPositionPDA(marketPk, publicKey);

          let posAcc: any = null;
          try {
            posAcc = await (program as any).account.userPosition.fetch(posPda);
          } catch {
            continue;
          }

          if (posAcc?.claimed) continue;

          const sharesArr = Array.isArray(posAcc?.shares)
            ? posAcc.shares.map((x: any) =>
                typeof x === "number" ? x : typeof x?.toNumber === "function" ? x.toNumber() : Number(x || 0)
              )
            : [];

          const winningShares = Math.floor(Number(sharesArr[winningIndex] || 0));
          if (winningShares <= 0) continue;

          const totalWinningSupply = Array.isArray(marketAcc?.outcomeSupplies)
            ? Number(
                typeof marketAcc.outcomeSupplies[winningIndex] === "number"
                  ? marketAcc.outcomeSupplies[winningIndex]
                  : typeof marketAcc.outcomeSupplies[winningIndex]?.toNumber === "function"
                  ? marketAcc.outcomeSupplies[winningIndex].toNumber()
                  : marketAcc.outcomeSupplies[winningIndex] || 0
              )
            : 0;

          let estPayoutLamports: number | undefined = undefined;
          if (totalWinningSupply > 0) {
            const bal = await connection.getBalance(marketPk);
            const payout = (BigInt(winningShares) * BigInt(bal)) / BigInt(Math.floor(totalWinningSupply));
            estPayoutLamports = Number(payout);
          }

          const mkDb = marketsByAddress.get(addr) || myCreatedMarkets.find((x) => x.market_address === addr) || null;

          out.push({
            marketAddress: addr,
            marketQuestion: mkDb?.question || "(Market)",
            estPayoutLamports,
            winningIndex,
          });
        }

        if (!cancelled) setClaimables(out);
      } catch {
        if (!cancelled) setClaimables([]);
      } finally {
        if (!cancelled) setLoadingClaimables(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, publicKey, program, connection, myTxs, myCreatedMarkets, bookmarkedMarkets, marketsByAddress]);

  /* ---------------- Stats ---------------- */

  const walletLabel = useMemo(() => shortAddr(walletBase58), [walletBase58]);
  const gainsSol = useMemo(() => {
    // Gains = somme des payouts estimés des claimables (0 si none)
    return (claimables || []).reduce((sum, c) => sum + lamportsToSol(toNum(c.estPayoutLamports)), 0);
  }, [claimables]);

  const stats = useMemo(() => {
    const created = myCreatedMarkets.length;
    const volLamports = myCreatedMarkets.reduce((sum, m) => sum + toNum(m.total_volume), 0);
    const volSol = lamportsToSol(volLamports);
    const creatorFeesSol = volSol * 0.01;
    return { created, volSol, creatorFeesSol };
  }, [myCreatedMarkets]);

  const portfolioStats = useMemo(() => {
    const markets = new Set<string>();
    let tradedVolumeSol = 0;

    for (const t of myTxs) {
      if (t.market_address) markets.add(String(t.market_address));
      const c = toNum(t.cost);
      if (c) tradedVolumeSol += Math.abs(c);
    }

    return { positions: markets.size, trades: myTxs.length, tradedVolumeSol };
  }, [myTxs]);

  const txRows = useMemo(() => {
    return myTxs.map((t) => {
      const mk = t.market_address ? marketsByAddress.get(String(t.market_address)) : null;
      const marketAddress = (mk?.market_address || t.market_address || "") as string;
      const marketQuestion = (mk?.question || "(Market)") as string;

      const side = t.is_buy ? "BUY" : "SELL";
      const shares = t.shares != null ? Math.floor(toNum(t.shares)) : Math.floor(toNum(t.amount));

      const names = (mk?.outcome_names || null) as string[] | null;
      const outcomeIndex =
        t.outcome_index != null
          ? Number(t.outcome_index)
          : t.is_yes == null
          ? null
          : t.is_yes
          ? 0
          : 1;

      const pseudoMarket = { outcome_names: names };

      const outcomeLabel = outcomeLabelFromMarket(pseudoMarket, {
        outcomeIndex,
        isYes: t.is_yes,
        txOutcomeName: t.outcome_name ?? null,
      });

      const title = `${side} • ${outcomeLabel} • ${shares} shares`;
      const costSol = toNum(t.cost);
      const createdAt = t.created_at ? new Date(t.created_at) : null;

      return {
        id: String(t.id || t.tx_signature || Math.random()),
        title,
        marketAddress,
        marketQuestion,
        sig: String(t.tx_signature || ""),
        costSol,
        createdAt,
      };
    });
  }, [myTxs, marketsByAddress]);

  /* ---------------- Actions ---------------- */

  async function handleClaim(marketAddress: string) {
    if (!connected || !publicKey || !program) return;

    try {
      setClaimingMarket(marketAddress);

      const marketPk = new PublicKey(marketAddress);
      const [posPda] = getUserPositionPDA(marketPk, publicKey);

      const sig = await (program as any).methods
        .claimWinnings()
        .accounts({
          market: marketPk,
          userPosition: posPda,
          user: publicKey,
        })
        .rpc();

      alert(
        `Claim success 🎉\n\nTx: ${sig.slice(0, 16)}...\n\nhttps://explorer.solana.com/tx/${sig}?cluster=devnet`
      );

      setClaimables((prev) => prev.filter((c) => c.marketAddress !== marketAddress));
    } catch (e: any) {
      alert(`Claim failed: ${e?.message || "Unknown error"}`);
    } finally {
      setClaimingMarket(null);
    }
  }

  async function handleProposeResolution() {
    if (!connected || !publicKey || !resolvingMarket || selectedOutcome === null) return;
    const marketAddress = resolvingMarket.market_address;
    if (!marketAddress) return;

    if (!proofOk) {
      alert(proofMode === "link" ? "Please provide a proof URL." : "Please upload a proof image.");
      return;
    }

    const note = proofNote.trim();

    try {
      setResolveLoading(true);

      let proposedProofUrl: string | null = null;
      let proposedProofImage: string | null = null;

      if (proofMode === "link") {
        proposedProofUrl = proofUrl.trim();
        proposedProofImage = null;
      } else {
        if (!proofFile) throw new Error("Missing proof file");
        proposedProofImage = await uploadResolutionProofImage(proofFile, marketAddress);
        proposedProofUrl = null;
      }

      const now = Date.now();
      const deadlineIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();

      await proposeResolution({
        market_address: marketAddress,
        proposed_winning_outcome: selectedOutcome,
        contest_deadline_iso: deadlineIso,
        proposed_proof_url: proposedProofUrl,
        proposed_proof_image: proposedProofImage,
        proposed_proof_note: note || null,
      });

      // optimistic update
      const proposedAtIso = new Date().toISOString();
      setMyCreatedMarkets((prev) =>
        prev.map((m) =>
          m.market_address === marketAddress
            ? {
                ...m,
                resolution_status: "proposed",
                proposed_winning_outcome: selectedOutcome,
                resolution_proposed_at: proposedAtIso,
                contest_deadline: deadlineIso,
                contested: false,
                contest_count: 0,
                proposed_proof_url: proposedProofUrl,
                proposed_proof_image: proposedProofImage,
                proposed_proof_note: note || null,
              }
            : m
        )
      );

      const labels = resolvingMarket.outcome_names || ["YES", "NO"];
      resetResolveModal();

      alert(
        `Resolution proposed ✅\n\nOutcome: ${labels[selectedOutcome] || `Option ${selectedOutcome + 1}`}\n\nContest window: 24h\n\nTrading is now locked (UI).`
      );
    } catch (e: any) {
      alert(`Propose failed: ${e?.message || "Unknown error"}`);
    } finally {
      setResolveLoading(false);
    }
  }

  /* -------------------------------------------------------------------------- */
  /* Render                                                                     */
  /* -------------------------------------------------------------------------- */

  if (!connected) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-6">Dashboard</h1>
        <div className="card-pump">
          <p className="text-gray-400">Connect wallet to view your dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 md:py-10">
      {/* Header */}
<div className="flex items-start md:items-center justify-between gap-6 mb-5">
  <div>
    <h1 className="text-3xl md:text-4xl font-bold text-white">Balance</h1>

    <div className="text-xs md:text-sm text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
      <span>
        Wallet: <span className="font-mono text-white/80">{walletLabel}</span>
      </span>

      <span className="text-gray-600">•</span>

      <span className="inline-flex items-center gap-2">
        Profit
        <span className="font-semibold text-pump-green">+{gainsSol.toFixed(2)} SOL</span>
      </span>
    </div>
  </div>

  {/* ✅ removed: top-right repeated stats */}
</div>

      {errorMsg && (
        <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {errorMsg}
        </div>
      )}

      {/* Summary cards */}
      <div className="mt-4 mb-6">
        <div className="hidden md:grid grid-cols-3 gap-4">
          <div className="card-pump p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Positions</div>
            <div className="text-2xl font-bold text-white mt-1">{portfolioStats.positions}</div>
            <div className="text-xs text-gray-500 mt-1">Markets traded</div>
          </div>

          <div className="card-pump p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Traded</div>
            <div className="text-2xl font-bold text-white mt-1">{portfolioStats.tradedVolumeSol.toFixed(2)} SOL</div>
            <div className="text-xs text-gray-500 mt-1">Based on your fills</div>
          </div>

          <div className="card-pump p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Created</div>
            <div className="text-2xl font-bold text-white mt-1">{stats.created}</div>
            <div className="text-xs text-gray-500 mt-1">Fees ~{stats.creatorFeesSol.toFixed(3)} SOL</div>
          </div>
        </div>

        {/* Mobile: horizontal scroll cards */}
        <div className="md:hidden flex gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="card-pump p-4 min-w-[220px]">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Positions</div>
            <div className="text-2xl font-bold text-white mt-1">{portfolioStats.positions}</div>
            <div className="text-xs text-gray-500 mt-1">Markets traded</div>
          </div>
          <div className="card-pump p-4 min-w-[220px]">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Traded</div>
            <div className="text-2xl font-bold text-white mt-1">{portfolioStats.tradedVolumeSol.toFixed(2)} SOL</div>
            <div className="text-xs text-gray-500 mt-1">Based on your fills</div>
          </div>
          <div className="card-pump p-4 min-w-[220px]">
            <div className="text-xs text-gray-500 uppercase tracking-wide">Created</div>
            <div className="text-2xl font-bold text-white mt-1">{stats.created}</div>
            <div className="text-xs text-gray-500 mt-1">Fees ~{stats.creatorFeesSol.toFixed(3)} SOL</div>
          </div>
        </div>
      </div>

      {/* Claimables */}
      <div className="card-pump mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg md:text-xl font-bold text-white">🏆 Claimable winnings</h2>
          <span className="hidden md:inline text-xs text-gray-500">
            Resolved on-chain markets where you hold winning shares
          </span>
        </div>

        {loadingClaimables ? (
          <p className="text-gray-400 text-sm">Checking claimables…</p>
        ) : claimables.length === 0 ? (
          <p className="text-gray-500 text-sm">No claimable winnings yet.</p>
        ) : (
          <div className="space-y-3">
            {claimables.map((c) => (
              <div
                key={c.marketAddress}
                className="rounded-xl border border-pump-green/40 bg-pump-green/5 p-4 flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="text-white font-semibold truncate">{c.marketQuestion}</div>
                  <div className="text-xs text-gray-500 mt-1 truncate">
                    {shortAddr(c.marketAddress)}
                    {typeof c.estPayoutLamports === "number" && (
                      <>
                        {" • "}
                        <span className="text-pump-green font-semibold">
                          ~{lamportsToSol(c.estPayoutLamports).toFixed(4)} SOL
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleClaim(c.marketAddress)}
                  disabled={claimingMarket === c.marketAddress}
                  className={[
                    "px-5 py-2 rounded-lg font-semibold transition",
                    claimingMarket === c.marketAddress
                      ? "bg-gray-700 text-gray-300 cursor-not-allowed"
                      : "bg-pump-green text-black hover:opacity-90",
                  ].join(" ")}
                >
                  {claimingMarket === c.marketAddress ? "Claiming…" : "💰 Claim"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tabs (like Trade page) */}
      <div className="flex items-center gap-2 mb-4">
        <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
          Activity
        </TabButton>
        <TabButton active={tab === "created"} onClick={() => setTab("created")}>
          My markets
        </TabButton>
        <TabButton active={tab === "bookmarks"} onClick={() => setTab("bookmarks")}>
          Bookmarked
        </TabButton>
        <div className="ml-auto text-xs text-gray-500">
          {tab === "activity" && (loadingTxs ? "Loading…" : `${txRows.length} txs`)}
          {tab === "created" && (loadingMarkets ? "Loading…" : `${myCreatedMarkets.length} markets`)}
          {tab === "bookmarks" && (loadingBookmarks ? "Loading…" : `${bookmarkedMarkets.length} saved`)}
        </div>
      </div>

      {/* Panels */}
      <div className="card-pump">
        {/* ACTIVITY */}
        {tab === "activity" && (
          <>
            {loadingTxs ? (
              <p className="text-gray-400 text-sm">Loading transactions…</p>
            ) : txRows.length === 0 ? (
              <p className="text-gray-500 text-sm">No activity yet.</p>
            ) : (
              <div className="space-y-3">
                {txRows.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl border border-white/10 bg-pump-dark/40 p-4 flex items-start sm:items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-white font-medium text-sm md:text-base">{r.title}</div>
                      <div className="text-xs text-gray-400 mt-1 truncate">
                        {r.marketQuestion || shortAddr(r.marketAddress)}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap items-center gap-2">
                        <span>{r.createdAt ? r.createdAt.toLocaleString("fr-FR") : ""}</span>
                        {r.sig && (
                          <>
                            <span className="opacity-40">•</span>
                            <a
                              href={`https://explorer.solana.com/tx/${r.sig}?cluster=devnet`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-pump-green hover:underline"
                            >
                              tx: {shortSig(r.sig)}
                            </a>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-pump-green font-bold text-sm md:text-base">
                          {r.costSol > 0 ? `${r.costSol.toFixed(4)} SOL` : "0.0000 SOL"}
                        </div>
                      </div>

                      {r.marketAddress && (
                        <Link
                          href={`/trade/${r.marketAddress}`}
                          className="px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:opacity-90 transition"
                        >
                          View
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* CREATED */}
        {tab === "created" && (
          <>
            {loadingMarkets ? (
              <p className="text-gray-400 text-sm">Loading markets…</p>
            ) : myCreatedMarkets.length === 0 ? (
              <p className="text-gray-500 text-sm">You haven&apos;t created any markets yet.</p>
            ) : (
              <div className="space-y-3">
                {myCreatedMarkets.map((m, idx) => {
                  const addr = String(m.market_address || "");
                  const q = String(m.question || "Market");
                  const volSol = lamportsToSol(toNum(m.total_volume));

                  const ended = isMarketEnded(m.end_date);
                  const status = toResolutionStatus(m.resolution_status);
                  const timeStatus = formatTimeStatus(m.end_date);

                  const isResolvedFinal = !!m.resolved || status === "finalized";
                  const isProposed = status === "proposed";
                  const isCancelled = status === "cancelled";

                  const deadlineMs = m.contest_deadline ? new Date(m.contest_deadline).getTime() : NaN;
                  const remainingMs = Number.isFinite(deadlineMs) ? deadlineMs - Date.now() : NaN;

                  const canPropose = ended && !isResolvedFinal && !isProposed && status !== "cancelled";

                  const boxCls = isResolvedFinal
                    ? "border-gray-600 bg-gray-800/30"
                    : isCancelled
                    ? "border-[#ff5c73]/60 bg-[#ff5c73]/5"
                    : isProposed
                    ? "border-pump-green/60 bg-pump-green/5"
                    : canPropose
                    ? "border-yellow-500/60 bg-yellow-500/5"
                    : "border-white/10 bg-pump-dark/40";

                  return (
                    <div
                      key={String(m.id || addr || idx)}
                      className={`rounded-xl border p-4 flex items-start sm:items-center justify-between gap-4 ${boxCls}`}
                    >
                      <div className="min-w-0">
                        <div className="text-white font-semibold truncate">{q}</div>
                        <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap items-center gap-2">
                          <span>{addr ? shortAddr(addr) : ""}</span>
                          <span className="opacity-40">•</span>

                          {isResolvedFinal ? (
                            <span className="text-green-400">✓ Finalized</span>
                          ) : isCancelled ? (
                            <span className="text-[#ff5c73]">Cancelled • refundable</span>
                          ) : isProposed ? (
                            <span className="text-pump-green">
                              Proposed
                              {Number.isFinite(remainingMs)
                                ? ` (${formatMsToHhMm(Math.max(0, remainingMs))} left)`
                                : ""}
                            </span>
                          ) : (
                            <span className={ended ? "text-yellow-400" : "text-gray-400"}>{timeStatus}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-white font-semibold">{volSol.toFixed(2)} SOL</div>
                          <div className="text-[11px] text-gray-500">volume</div>
                        </div>

                        {canPropose && (
                          <button
                            onClick={() => {
                              setResolvingMarket(m);
                              setSelectedOutcome(null);
                              setMode("upload");
                              setProofNote("");
                            }}
                            className="px-4 py-2 rounded-lg bg-yellow-500 text-black text-sm font-semibold hover:bg-yellow-400 transition"
                          >
                            ⚖️ Propose
                          </button>
                        )}

                        {addr && (
                          <Link
                            href={`/trade/${addr}`}
                            className="px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:opacity-90 transition"
                          >
                            View
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* BOOKMARKS */}
        {tab === "bookmarks" && (
          <>
            {loadingBookmarks ? (
              <p className="text-gray-400 text-sm">Loading bookmarks…</p>
            ) : bookmarkedMarkets.length === 0 ? (
              <p className="text-gray-500 text-sm">No bookmarked markets yet.</p>
            ) : (
              <div className="space-y-3">
                {bookmarkedMarkets.map((m, idx) => {
                  const addr = String(m.market_address || "");
                  const q = String(m.question || "Market");
                  const volSol = lamportsToSol(toNum(m.total_volume));
                  const status = formatTimeStatus(m.end_date);

                  return (
                    <div
                      key={String(m.id || addr || idx)}
                      className="rounded-xl border border-white/10 bg-pump-dark/40 p-4 flex items-start sm:items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="text-white font-semibold truncate">{q}</div>
                        <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap items-center gap-2">
                          <span>{shortAddr(addr)}</span>
                          <span className="opacity-40">•</span>
                          <span className="text-gray-400">{status}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-white font-semibold">{volSol.toFixed(2)} SOL</div>
                          <div className="text-[11px] text-gray-500">volume</div>
                        </div>

                        {addr && (
                          <Link
                            href={`/trade/${addr}`}
                            className="px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:opacity-90 transition"
                          >
                            View
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Resolve Modal */}
      {resolvingMarket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-pump-dark border border-white/20 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2">Propose resolution</h3>
            <p className="text-gray-400 text-sm mb-1 truncate">{resolvingMarket.question}</p>
            <p className="text-[11px] text-gray-500 mb-4">
              ⏳ Contest window: 24h — trading will be locked (UI) during this period.
            </p>

            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-2 block">Select proposed winning outcome:</label>
              <div className="space-y-2">
                {(resolvingMarket.outcome_names || ["YES", "NO"]).map((label, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedOutcome(idx)}
                    className={[
                      "w-full p-3 rounded-lg border text-left transition",
                      selectedOutcome === idx
                        ? "border-pump-green bg-pump-green/20 text-white"
                        : "border-white/20 bg-white/5 text-gray-300 hover:border-white/40",
                    ].join(" ")}
                  >
                    <span className="font-semibold">{label}</span>
                    {selectedOutcome === idx && <span className="float-right text-pump-green">✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Proof inputs (LINK OR UPLOAD) */}
            <div className="mb-4 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("upload")}
                  className={[
                    "flex-1 px-3 py-2 rounded-lg border text-sm font-semibold transition",
                    proofMode === "upload"
                      ? "border-pump-green bg-pump-green/20 text-white"
                      : "border-white/20 bg-white/5 text-gray-300 hover:border-white/40",
                  ].join(" ")}
                >
                  Upload image
                </button>

                <button
                  type="button"
                  onClick={() => setMode("link")}
                  className={[
                    "flex-1 px-3 py-2 rounded-lg border text-sm font-semibold transition",
                    proofMode === "link"
                      ? "border-pump-green bg-pump-green/20 text-white"
                      : "border-white/20 bg-white/5 text-gray-300 hover:border-white/40",
                  ].join(" ")}
                >
                  Proof link
                </button>
              </div>

              {proofMode === "link" ? (
                <div>
                  <label className="text-sm text-gray-400 mb-1 block">Proof URL (required)</label>
                  <input
                    value={proofUrl}
                    onChange={(e) => setProofUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-pump-green/60"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm text-gray-400 mb-1 block">Upload proof image (required)</label>

                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setProofFile(f);
                      if (proofPreview) URL.revokeObjectURL(proofPreview);
                      if (f) {
                        const url = URL.createObjectURL(f);
                        setProofPreview(url);
                      } else {
                        setProofPreview("");
                      }
                    }}
                    className="w-full text-sm text-gray-300"
                  />

                  {proofPreview && (
                    <div className="rounded-xl overflow-hidden border border-white/10 bg-black/30">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={proofPreview} alt="Proof preview" className="w-full h-40 object-cover" />
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-sm text-gray-400 mb-1 block">Proof note (optional)</label>
                <textarea
                  value={proofNote}
                  onChange={(e) => setProofNote(e.target.value)}
                  placeholder="Short explanation..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-pump-green/60"
                />
              </div>

              {!proofOk && (
                <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                  {proofMode === "link" ? "Please provide a proof URL." : "Please upload a proof image."}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={resetResolveModal}
                className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-gray-300 hover:bg-white/10 transition"
              >
                Cancel
              </button>

              <button
                onClick={handleProposeResolution}
                disabled={selectedOutcome === null || resolveLoading || !proofOk}
                className={[
                  "flex-1 px-4 py-2 rounded-lg font-semibold transition",
                  selectedOutcome === null || resolveLoading || !proofOk
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-yellow-500 text-black hover:bg-yellow-400",
                ].join(" ")}
              >
                {resolveLoading ? "Proposing…" : "Confirm proposal"}
              </button>
            </div>

            <p className="text-xs text-gray-400 mt-4 text-center">
              ⚠️ This does NOT finalize on-chain yet. It starts a 24h contest window.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}