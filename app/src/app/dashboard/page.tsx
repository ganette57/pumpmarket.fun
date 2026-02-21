// src/app/dashboard/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { supabase } from "@/lib/supabaseClient";
import { useProgram } from "@/hooks/useProgram";
import { lamportsToSol, getUserPositionPDA } from "@/utils/solana";
import { outcomeLabelFromMarket } from "@/utils/outcomes";
import { uploadResolutionProofImage } from "@/lib/proofs";
import { proposeResolution as proposeResolutionDb } from "@/lib/markets";
import { sendSignedTx } from "@/lib/solanaSend";
import { solanaExplorerAddressUrl, solanaExplorerTxUrl } from "@/utils/explorer";
import { Coins, X, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PLATFORM_WALLET = "xBaRohQaEKaYm57K6yB6pGBVMPiD4jdJkykx5knU3xr";

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

type ResolutionStatus = "open" | "proposed" | "finalized" | "cancelled";
function toResolutionStatus(x: any): ResolutionStatus {
  const s = String(x || "").toLowerCase().trim();
  if (s === "proposed" || s === "finalized" || s === "cancelled") return s;
  return "open";
}

function decodeMarketStatus(status: any): ResolutionStatus {
  if (status && typeof status === "object") {
    if ("open" in status) return "open";
    if ("proposed" in status) return "proposed";
    if ("finalized" in status) return "finalized";
    if ("cancelled" in status) return "cancelled";
  }
  const s = String(status || "").toLowerCase();
  if (s.includes("proposed")) return "proposed";
  if (s.includes("final")) return "finalized";
  if (s.includes("cancel")) return "cancelled";
  return "open";
}

const BI_0 = BigInt(0);
const BI_1 = BigInt(1);
const BI_8 = BigInt(8);
const BI_127 = BigInt(127);
const BI_128 = BigInt(128);

function toBigIntI128(v: any): bigint {
  if (v == null) return BI_0;
  if (typeof v?.toArrayLike === "function") {
    try {
      const buf = v.toArrayLike(Uint8Array, "le", 16);
      return i128FromLeBytes(buf);
    } catch {}
  }
  if (Array.isArray(v?.bytes)) return i128FromLeBytes(Uint8Array.from(v.bytes));
  if (Array.isArray(v)) return i128FromLeBytes(Uint8Array.from(v));
  const s = String(v);
  if (s && s !== "undefined" && s !== "null") {
    try { return BigInt(s); } catch { return BigInt(Math.trunc(Number(s) || 0)); }
  }
  return BI_0;
}

function i128FromLeBytes(le: Uint8Array): bigint {
  let x = BI_0;
  for (let i = 0; i < Math.min(16, le.length); i++) {
    x |= BigInt(le[i]!) << (BI_8 * BigInt(i));
  }
  const sign = BI_1 << BI_127;
  if ((x & sign) !== BI_0) x = x - (BI_1 << BI_128);
  return x;
}

function absBigInt(x: bigint): bigint {
  return x < BI_0 ? -x : x;
}

function bnToNumber(x: any): number {
  if (x == null) return 0;
  if (typeof x === "number") return x;
  if (typeof x?.toNumber === "function") return x.toNumber();
  return Number(x) || 0;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getMultipleAccountsInfoBatched(
  connection: any,
  keys: PublicKey[],
  batchSize = 80
) {
  const res = new Map<string, any>();
  for (const part of chunk(keys, batchSize)) {
    const infos = await connection.getMultipleAccountsInfo(part);
    infos.forEach((info: any, idx: number) => {
      const k = part[idx]!.toBase58();
      res.set(k, info);
    });
  }
  return res;
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type DbMarket = {
  id?: string;
  market_address?: string;
  creator?: string;
  question?: string;
  total_volume?: number;
  end_date?: string;
  resolved?: boolean;
  outcome_names?: string[] | null;
  winning_outcome?: number | null;
  resolved_at?: string | null;
  resolution_proof_url?: string | null;
  resolution_proof_image?: string | null;
  resolution_proof_note?: string | null;
  resolution_status?: ResolutionStatus | string | null;
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
  is_buy?: boolean | null;
  is_yes?: boolean | null;
  amount?: number | null;
  cost?: number | null;
  tx_signature?: string | null;
  outcome_index?: number | null;
  shares?: number | null;
  outcome_name?: string | null;
  tx_type?: string | null;
};

type ClaimHistoryRow = {
  id: string;
  created_at: string;
  market_address: string;
  market_question: string;
  tx_signature: string;
  tx_type: "claim" | "refund" | "claim_fees";
  amount_sol: number;
};

type Claimable = {
  marketAddress: string;
  marketQuestion: string;
  estPayoutLamports?: number;
  winningIndex?: number;
};

type Refundable = {
  marketAddress: string;
  marketQuestion: string;
  estRefundLamports?: number;
};

type CreatorFeeClaimable = {
  marketAddress: string;
  marketQuestion: string;
  feeLamports: number;
};

type BookmarkRow = {
  market_id: string;
  created_at?: string;
};

type ModalState = {
  type: "claim" | "refund" | "claim_fees" | null;
  marketAddress: string;
  marketQuestion: string;
  amount: number;
  step: "confirm" | "processing" | "success" | "error";
  txSignature?: string;
  errorMessage?: string;
};

/* -------------------------------------------------------------------------- */
/* Data fetch                                                                 */
/* -------------------------------------------------------------------------- */

async function safeFetchUserTransactions(walletAddress: string, limit = 50): Promise<DbTx[]> {
  const trySelects = [
    "id,created_at,market_id,market_address,user_address,is_buy,is_yes,amount,cost,tx_signature,outcome_index,shares,outcome_name,tx_type",
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

async function safeFetchClaimHistory(walletAddress: string, limit = 20): Promise<ClaimHistoryRow[]> {
  const { data, error } = await supabase
    .from("transactions")
    .select("id,created_at,market_address,tx_signature,tx_type,cost,outcome_name")
    .eq("user_address", walletAddress)
    .in("tx_type", ["claim", "refund", "claim_fees"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("safeFetchClaimHistory error:", error);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    created_at: row.created_at,
    market_address: row.market_address || "",
    market_question: row.outcome_name || "(Market)",
    tx_signature: row.tx_signature || "",
    tx_type: row.tx_type as "claim" | "refund" | "claim_fees",
    amount_sol: Math.abs(toNum(row.cost)),
  }));
}

async function saveClaimTransaction(params: {
  marketAddress: string;
  marketQuestion: string;
  userAddress: string;
  txSignature: string;
  txType: "claim" | "refund" | "claim_fees";
  amountSol: number;
}): Promise<void> {
  const { error } = await supabase.from("transactions").insert({
    market_address: params.marketAddress,
    user_address: params.userAddress,
    tx_signature: params.txSignature,
    tx_type: params.txType,
    cost: params.amountSol,
    outcome_name: params.marketQuestion,
    is_buy: false,
    is_yes: null,
    amount: 0,
    shares: 0,
  });
  if (error) console.error("saveClaimTransaction error:", error);
}

async function safeFetchMyCreatedMarkets(walletBase58: string): Promise<DbMarket[]> {
  const trySelects = [
    "id,created_at,market_address,creator,question,total_volume,end_date,resolved,outcome_names,winning_outcome,resolved_at,resolution_proof_url,resolution_proof_image,resolution_proof_note,resolution_status,proposed_winning_outcome,resolution_proposed_at,contest_deadline,contested,contest_count,proposed_proof_url,proposed_proof_image,proposed_proof_note,cancelled_at,cancel_reason",
    "id,created_at,market_address,creator,question,total_volume,end_date,resolved,outcome_names",
    "id,market_address,creator,question,total_volume,end_date,resolved",
  ];
  for (const sel of trySelects) {
    const { data, error } = await supabase
      .from("markets")
      .select(sel)
      .eq("creator", walletBase58)
      .order("created_at", { ascending: false });
    if (!error) return ((data as any[]) || []) as DbMarket[];
    const msg = String((error as any)?.message || "");
    if (!msg.includes("does not exist") && !msg.includes("column")) {
      console.error("safeFetchMyCreatedMarkets error:", error);
      return [];
    }
  }
  return [];
}

async function safeFetchMarketsByIds(ids: string[]): Promise<DbMarket[]> {
  if (!ids.length) return [];
  const trySelects = [
    "id,market_address,creator,question,total_volume,end_date,resolved,outcome_names,winning_outcome,resolved_at,resolution_proof_url,resolution_proof_image,resolution_proof_note,resolution_status,proposed_winning_outcome,resolution_proposed_at,contest_deadline,contested,contest_count,proposed_proof_url,proposed_proof_image,proposed_proof_note",
    "id,market_address,creator,question,total_volume,end_date,resolved,outcome_names",
    "id,market_address,question,total_volume,end_date,resolved",
  ];
  for (const sel of trySelects) {
    const { data, error } = await supabase.from("markets").select(sel).in("id", ids.slice(0, 200));
    if (!error) return ((data as any[]) || []) as DbMarket[];
    const msg = String((error as any)?.message || "");
    if (!msg.includes("does not exist") && !msg.includes("column")) {
      console.error("safeFetchMarketsByIds error:", error);
      return [];
    }
  }
  return [];
}

async function safeFetchMarketsByAddresses(addrs: string[]): Promise<DbMarket[]> {
  const uniq = Array.from(new Set(addrs.map(String).filter(Boolean))).slice(0, 200);
  if (!uniq.length) return [];
  const trySelects = [
    "id,market_address,creator,question,total_volume,end_date,resolved,outcome_names,winning_outcome,resolved_at,resolution_proof_url,resolution_proof_image,resolution_proof_note,resolution_status,proposed_winning_outcome,resolution_proposed_at,contest_deadline,contested,contest_count,proposed_proof_url,proposed_proof_image,proposed_proof_note,cancelled_at,cancel_reason",
    "id,market_address,question,total_volume,end_date,resolved,outcome_names,resolution_status,contest_deadline,contest_count,contested",
    "id,market_address,question,total_volume,end_date,resolved,outcome_names",
  ];
  for (const sel of trySelects) {
    const { data, error } = await supabase.from("markets").select(sel).in("market_address", uniq);
    if (!error) return ((data as any[]) || []) as DbMarket[];
    const msg = String((error as any)?.message || "");
    if (!msg.includes("does not exist") && !msg.includes("column")) {
      console.error("safeFetchMarketsByAddresses error:", error);
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
/* UI: Tabs                                                                   */
/* -------------------------------------------------------------------------- */

type TabKey = "activity" | "created" | "bookmarks";

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-semibold transition border",
        active ? "bg-pump-green text-black border-pump-green" : "bg-black/30 text-gray-300 border-white/10 hover:border-white/20",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* UI: Action Modal                                                           */
/* -------------------------------------------------------------------------- */

function ActionModal({
  modal,
  onClose,
  onConfirm,
}: {
  modal: ModalState;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!modal.type) return null;

  const config = {
    claim: {
      title: "Claim Winnings",
      icon: "🏆",
      color: "pump-green",
      buttonText: "Claim Winnings",
      successText: "Winnings claimed!",
    },
    refund: {
      title: "Claim Refund",
      icon: "💸",
      color: "[#ff5c73]",
      buttonText: "Claim Refund",
      successText: "Refund claimed!",
    },
    claim_fees: {
      title: "Claim Creator Fees",
      icon: "💰",
      color: "amber-500",
      buttonText: "Claim Fees",
      successText: "Creator fees claimed!",
    },
  }[modal.type];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-pump-dark border border-white/20 rounded-2xl p-5 md:p-6 max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <span>{config.icon}</span>
            {config.title}
          </h3>
          {modal.step === "confirm" && (
            <button onClick={onClose} className="text-gray-400 hover:text-white transition">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Confirm Step */}
        {modal.step === "confirm" && (
          <>
            <div className="mb-6">
              <div className="text-gray-400 text-sm mb-2">Market</div>
              <div className="text-white font-medium truncate">{modal.marketQuestion}</div>
              <div className="text-xs text-gray-500 mt-1">{shortAddr(modal.marketAddress)}</div>
            </div>

            <div className={`mb-6 p-4 rounded-xl bg-${config.color}/10 border border-${config.color}/30`}>
              <div className="text-gray-400 text-sm mb-1">Amount to receive</div>
              <div className={`text-2xl font-bold text-${config.color}`}>
                {modal.amount.toFixed(4)} SOL
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-3 rounded-xl border border-white/20 text-gray-300 hover:bg-white/10 transition font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className={`flex-1 px-4 py-3 rounded-xl bg-${config.color} text-black font-semibold hover:opacity-90 transition`}
              >
                {config.buttonText}
              </button>
            </div>
          </>
        )}

        {/* Processing Step */}
        {modal.step === "processing" && (
          <div className="py-8 text-center">
            <Loader2 className={`w-12 h-12 text-${config.color} animate-spin mx-auto mb-4`} />
            <div className="text-white font-semibold mb-2">Processing transaction...</div>
            <div className="text-gray-400 text-sm">Please confirm in your wallet</div>
          </div>
        )}

        {/* Success Step */}
        {modal.step === "success" && (
          <div className="py-6 text-center">
            <CheckCircle className={`w-16 h-16 text-${config.color} mx-auto mb-4`} />
            <div className="text-white font-bold text-xl mb-2">{config.successText}</div>
            <div className={`text-${config.color} text-2xl font-bold mb-4`}>
              +{modal.amount.toFixed(4)} SOL
            </div>
            {modal.txSignature && (
              <a
                href={solanaExplorerTxUrl(modal.txSignature)}
                target="_blank"
                rel="noreferrer"
                className="text-pump-green text-sm hover:underline"
              >
                View transaction ↗
              </a>
            )}
            <button
              onClick={onClose}
              className="w-full mt-6 px-4 py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition"
            >
              Close
            </button>
          </div>
        )}

        {/* Error Step */}
        {modal.step === "error" && (
          <div className="py-6 text-center">
            <AlertCircle className="w-16 h-16 text-[#ff5c73] mx-auto mb-4" />
            <div className="text-white font-bold text-xl mb-2">Transaction Failed</div>
            <div className="text-gray-400 text-sm mb-4 break-words">
              {modal.errorMessage || "An error occurred"}
            </div>
            <button
              onClick={onClose}
              className="w-full px-4 py-3 rounded-xl bg-white/10 text-white font-semibold hover:bg-white/20 transition"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function DashboardPage() {
  const { publicKey, connected } = useWallet();
  const anchorWallet = useAnchorWallet();
  const walletBase58 = publicKey?.toBase58() || "";
  const { connection } = useConnection();
  const program = useProgram();

  const [tab, setTab] = useState<TabKey>("activity");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [loadingTxs, setLoadingTxs] = useState(false);
  const [loadingClaimables, setLoadingClaimables] = useState(false);
  const [loadingBookmarks, setLoadingBookmarks] = useState(false);
  const [loadingCreatorFees, setLoadingCreatorFees] = useState(false);
  const [loadingClaimHistory, setLoadingClaimHistory] = useState(false);

  const [myCreatedMarkets, setMyCreatedMarkets] = useState<DbMarket[]>([]);
  const [myTxs, setMyTxs] = useState<DbTx[]>([]);
  const [claimables, setClaimables] = useState<Claimable[]>([]);
  const [refundables, setRefundables] = useState<Refundable[]>([]);
  const [creatorFeeClaimables, setCreatorFeeClaimables] = useState<CreatorFeeClaimable[]>([]);
  const [claimHistory, setClaimHistory] = useState<ClaimHistoryRow[]>([]);
  const [bookmarkIds, setBookmarkIds] = useState<string[]>([]);
  const [bookmarkedMarkets, setBookmarkedMarkets] = useState<DbMarket[]>([]);
  const [txMarkets, setTxMarkets] = useState<DbMarket[]>([]);

  const inFlightRef = useRef<Record<string, boolean>>({});

  // Modal states
  const [actionModal, setActionModal] = useState<ModalState>({
    type: null,
    marketAddress: "",
    marketQuestion: "",
    amount: 0,
    step: "confirm",
  });

  const [resolvingMarket, setResolvingMarket] = useState<DbMarket | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [resolveLoading, setResolveLoading] = useState(false);

  type ProofMode = "upload" | "link";
  const [proofMode, setProofMode] = useState<ProofMode>("upload");
  const [proofUrl, setProofUrl] = useState<string>("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string>("");
  const [proofNote, setProofNote] = useState<string>("");

  const proofOk = proofMode === "link" ? proofUrl.trim().length > 0 : !!proofFile;

  function setMode(m: ProofMode) {
    setProofMode(m);
    setProofUrl("");
    setProofFile(null);
    if (proofPreview) URL.revokeObjectURL(proofPreview);
    setProofPreview("");
  }

  function resetResolveModal() {
    setResolvingMarket(null);
    setSelectedOutcome(null);
    setProofMode("upload");
    setProofUrl("");
    setProofFile(null);
    if (proofPreview) URL.revokeObjectURL(proofPreview);
    setProofPreview("");
    setProofNote("");
  }

  function closeActionModal() {
    setActionModal({
      type: null,
      marketAddress: "",
      marketQuestion: "",
      amount: 0,
      step: "confirm",
    });
  }

  function openClaimModal(c: Claimable) {
    setActionModal({
      type: "claim",
      marketAddress: c.marketAddress,
      marketQuestion: c.marketQuestion,
      amount: lamportsToSol(c.estPayoutLamports || 0),
      step: "confirm",
    });
  }

  function openRefundModal(r: Refundable) {
    setActionModal({
      type: "refund",
      marketAddress: r.marketAddress,
      marketQuestion: r.marketQuestion,
      amount: lamportsToSol(r.estRefundLamports || 0),
      step: "confirm",
    });
  }

  function openClaimFeesModal(c: CreatorFeeClaimable) {
    setActionModal({
      type: "claim_fees",
      marketAddress: c.marketAddress,
      marketQuestion: c.marketQuestion,
      amount: lamportsToSol(c.feeLamports),
      step: "confirm",
    });
  }

  useEffect(() => {
    return () => { if (proofPreview) URL.revokeObjectURL(proofPreview); };
  }, [proofPreview]);

  const marketsByAddress = useMemo(() => {
    const m = new Map<string, DbMarket>();
    for (const mk of [...myCreatedMarkets, ...bookmarkedMarkets, ...txMarkets]) {
      if (mk.market_address) m.set(mk.market_address, mk);
    }
    return m;
  }, [myCreatedMarkets, bookmarkedMarkets, txMarkets]);

  async function reloadDashboardData() {
    if (!connected || !walletBase58) return;
    try {
      const [markets, txs, bms, history] = await Promise.all([
        safeFetchMyCreatedMarkets(walletBase58),
        safeFetchUserTransactions(walletBase58, 80),
        safeFetchBookmarks(walletBase58, 200),
        safeFetchClaimHistory(walletBase58, 20),
      ]);
      setMyCreatedMarkets(markets || []);
      setMyTxs(txs || []);
      setClaimHistory(history || []);
      const txAddrs = Array.from(new Set((txs || []).map((t) => String(t.market_address || "")).filter(Boolean)));
      const related = await safeFetchMarketsByAddresses(txAddrs);
      setTxMarkets(related || []);
      const ids = Array.from(new Set((bms || []).map((x) => String(x.market_id || "")).filter(Boolean)));
      setBookmarkIds(ids);
    } catch (e: any) {
      console.error("reloadDashboardData error:", e);
    }
  }

  useEffect(() => {
    if (!connected || !walletBase58) {
      setErrorMsg(null);
      setMyCreatedMarkets([]);
      setMyTxs([]);
      setClaimables([]);
      setBookmarkIds([]);
      setBookmarkedMarkets([]);
      setRefundables([]);
      setTxMarkets([]);
      setCreatorFeeClaimables([]);
      setClaimHistory([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setErrorMsg(null);
      setLoadingMarkets(true);
      setLoadingTxs(true);
      setLoadingBookmarks(true);
      setLoadingClaimHistory(true);
      try {
        const [markets, txs, bms, history] = await Promise.all([
          safeFetchMyCreatedMarkets(walletBase58),
          safeFetchUserTransactions(walletBase58, 80),
          safeFetchBookmarks(walletBase58, 200),
          safeFetchClaimHistory(walletBase58, 20),
        ]);
        if (cancelled) return;
        setMyCreatedMarkets(markets || []);
        setMyTxs(txs || []);
        setClaimHistory(history || []);
        const txAddrs = Array.from(new Set((txs || []).map((t) => String(t.market_address || "")).filter(Boolean)));
        const related = await safeFetchMarketsByAddresses(txAddrs);
        if (!cancelled) setTxMarkets(related || []);
        const ids = Array.from(new Set((bms || []).map((x) => String(x.market_id || "")).filter(Boolean)));
        setBookmarkIds(ids);
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message || "Failed to load dashboard");
      } finally {
        if (!cancelled) {
          setLoadingMarkets(false);
          setLoadingTxs(false);
          setLoadingBookmarks(false);
          setLoadingClaimHistory(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [connected, walletBase58]);

  useEffect(() => {
    if (!connected || !walletBase58) return;
    let cancelled = false;
    (async () => {
      if (!bookmarkIds.length) { setBookmarkedMarkets([]); return; }
      setLoadingBookmarks(true);
      try {
        const mkts = await safeFetchMarketsByIds(bookmarkIds);
        const byId = new Map<string, DbMarket>();
        for (const m of mkts || []) if (m.id) byId.set(String(m.id), m);
        const ordered = bookmarkIds.map((id) => byId.get(id)).filter(Boolean) as DbMarket[];
        if (!cancelled) setBookmarkedMarkets(ordered);
      } catch { if (!cancelled) setBookmarkedMarkets([]); }
      finally { if (!cancelled) setLoadingBookmarks(false); }
    })();
    return () => { cancelled = true; };
  }, [connected, walletBase58, bookmarkIds]);

  /* ---------------- On-chain scan (claimables + refunds + creator fees) ---------------- */
  useEffect(() => {
    if (!connected || !publicKey || !program) {
      setClaimables([]);
      setRefundables([]);
      setCreatorFeeClaimables([]);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoadingClaimables(true);
      setLoadingCreatorFees(true);

      try {
        const addresses: string[] = [];
        for (const m of myCreatedMarkets) if (m.market_address) addresses.push(String(m.market_address));
        for (const m of bookmarkedMarkets) if (m.market_address) addresses.push(String(m.market_address));
        for (const t of myTxs) if (t.market_address) addresses.push(String(t.market_address));

        const unique = Array.from(new Set(addresses)).slice(0, 25);
        const marketPks: PublicKey[] = [];
        const addrByPk = new Map<string, string>();

        for (const addr of unique) {
          try {
            const pk = new PublicKey(addr);
            marketPks.push(pk);
            addrByPk.set(pk.toBase58(), addr);
          } catch {}
        }

        if (!marketPks.length) {
          if (!cancelled) {
            setClaimables([]);
            setRefundables([]);
            setCreatorFeeClaimables([]);
          }
          return;
        }

        const marketInfos = await getMultipleAccountsInfoBatched(connection, marketPks, 80);
        if (cancelled) return;

        const coder = (program as any).coder;
        const decodedMarkets = new Map<string, { acc: any; lamports: number }>();

        for (const pk of marketPks) {
          const info = marketInfos.get(pk.toBase58());
          if (!info?.data) continue;
          try {
            const m = coder.accounts.decode("market", info.data);
            decodedMarkets.set(pk.toBase58(), { acc: m, lamports: info.lamports ?? 0 });
          } catch {}
        }

        const posPdas: PublicKey[] = [];
        const posByMarket = new Map<string, PublicKey>();

        for (const pk of marketPks) {
          const [posPda] = getUserPositionPDA(pk, publicKey);
          posPdas.push(posPda);
          posByMarket.set(pk.toBase58(), posPda);
        }

        const posInfos = await getMultipleAccountsInfoBatched(connection, posPdas, 80);
        if (cancelled) return;

        const decodedPos = new Map<string, any>();
        for (const pda of posPdas) {
          const info = posInfos.get(pda.toBase58());
          if (!info?.data) continue;
          try {
            const p = coder.accounts.decode("userPosition", info.data);
            decodedPos.set(pda.toBase58(), p);
          } catch {}
        }

        const outClaimables: Claimable[] = [];
        const outRefundables: Refundable[] = [];
        const outFees: CreatorFeeClaimable[] = [];

        for (const pk of marketPks) {
          if (cancelled) return;

          const mkKey = pk.toBase58();
          const marketWrap = decodedMarkets.get(mkKey);
          if (!marketWrap) continue;

          const marketAcc = marketWrap.acc;
          const marketLamports = marketWrap.lamports ?? 0;

          const posPda = posByMarket.get(mkKey);
          const posAcc = posPda ? decodedPos.get(posPda.toBase58()) : null;

          const addr = addrByPk.get(mkKey) || mkKey;
          const mkDb =
            marketsByAddress.get(addr) ||
            myCreatedMarkets.find((x) => x.market_address === addr) ||
            null;
          const marketQuestion = mkDb?.question || "(Market)";

          const resolved = !!marketAcc?.resolved;
          const winningIndex =
            marketAcc?.winningOutcome != null ? bnToNumber(marketAcc.winningOutcome) : null;

          if (resolved && winningIndex != null && posAcc && !posAcc.claimed) {
            const sharesArr = Array.isArray(posAcc?.shares)
              ? posAcc.shares.map((x: any) => bnToNumber(x))
              : [];

            const winningShares = Math.floor(Number(sharesArr[winningIndex] || 0));
            if (winningShares > 0) {
              const qArr = Array.isArray(marketAcc?.q)
                ? marketAcc.q.map((x: any) => bnToNumber(x))
                : [];

              const totalWinningSupply = Number(qArr[winningIndex] || 0);
              if (totalWinningSupply > 0 && marketLamports > 0) {
                const payout =
                  (BigInt(winningShares) * BigInt(marketLamports)) /
                  BigInt(Math.floor(totalWinningSupply));

                outClaimables.push({
                  marketAddress: addr,
                  marketQuestion,
                  estPayoutLamports: Number(payout),
                  winningIndex,
                });
              }
            }
          }

          const isCancelledOnChain =
            !!marketAcc?.cancelled || decodeMarketStatus(marketAcc?.status) === "cancelled";

          if (isCancelledOnChain && posAcc && !posAcc.claimed) {
            const netCost = toBigIntI128(posAcc?.netCostLamports ?? posAcc?.net_cost_lamports);
            const estRefundLamports = Number(absBigInt(netCost));
            if (estRefundLamports > 0) {
              outRefundables.push({
                marketAddress: addr,
                marketQuestion,
                estRefundLamports,
              });
            }
          }

          const status = decodeMarketStatus(marketAcc?.status);
          if (status === "finalized") {
            const onchainCreator = marketAcc?.creator;
            if (onchainCreator?.equals?.(publicKey)) {
              const escrow = bnToNumber(marketAcc?.creatorFeeEscrow ?? marketAcc?.creator_fee_escrow);
              if (escrow > 0) {
                outFees.push({
                  marketAddress: addr,
                  marketQuestion,
                  feeLamports: escrow,
                });
              }
            }
          }
        }

        if (!cancelled) {
          setClaimables(outClaimables);
          setRefundables(outRefundables);
          setCreatorFeeClaimables(outFees);
        }
      } catch (e) {
        console.error("on-chain scan error:", e);
        if (!cancelled) {
          setClaimables([]);
          setRefundables([]);
          setCreatorFeeClaimables([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingClaimables(false);
          setLoadingCreatorFees(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    connected,
    publicKey,
    program,
    connection,
    myTxs,
    myCreatedMarkets,
    bookmarkedMarkets,
    marketsByAddress,
  ]);

  /* ---------------- Stats ---------------- */
  const walletLabel = useMemo(() => shortAddr(walletBase58), [walletBase58]);
  const gainsSol = useMemo(() => (claimables || []).reduce((sum, c) => sum + lamportsToSol(toNum(c.estPayoutLamports)), 0), [claimables]);
  const totalCreatorFeesSol = useMemo(() => creatorFeeClaimables.reduce((sum, c) => sum + lamportsToSol(c.feeLamports), 0), [creatorFeeClaimables]);
  const totalClaimedSol = useMemo(() => claimHistory.reduce((sum, h) => sum + h.amount_sol, 0), [claimHistory]);
  const stats = useMemo(() => {
    const created = myCreatedMarkets.length;
    const volLamports = myCreatedMarkets.reduce((sum, m) => sum + toNum(m.total_volume), 0);
    const volSol = lamportsToSol(volLamports);
    const creatorFeesSol = volSol * 0.02;
    return { created, volSol, creatorFeesSol };
  }, [myCreatedMarkets]);
  const portfolioStats = useMemo(() => {
    const markets = new Set<string>();
    let tradedVolumeSol = 0;
    for (const t of myTxs) {
      if (t.tx_type && t.tx_type !== "trade") continue;
      if (t.market_address) markets.add(String(t.market_address));
      const c = toNum(t.cost);
      if (c) tradedVolumeSol += Math.abs(c);
    }
    return { positions: markets.size, trades: myTxs.filter(t => !t.tx_type || t.tx_type === "trade").length, tradedVolumeSol };
  }, [myTxs]);
  const txRows = useMemo(() => {
    return myTxs.filter(t => !t.tx_type || t.tx_type === "trade").map((t) => {
      const mk = t.market_address ? marketsByAddress.get(String(t.market_address)) : null;
      const marketAddress = (mk?.market_address || t.market_address || "") as string;
      const marketQuestion = (mk?.question || "(Market)") as string;
      const side = t.is_buy ? "BUY" : "SELL";
      const shares = t.shares != null ? Math.floor(toNum(t.shares)) : Math.floor(toNum(t.amount));
      const names = (mk?.outcome_names || null) as string[] | null;
      const outcomeIndex = t.outcome_index != null ? Number(t.outcome_index) : t.is_yes == null ? null : t.is_yes ? 0 : 1;
      const pseudoMarket = { outcome_names: names };
      const outcomeLabel = outcomeLabelFromMarket(pseudoMarket, { outcomeIndex, isYes: t.is_yes, txOutcomeName: t.outcome_name ?? null });
      const title = `${side} • ${outcomeLabel} • ${shares} shares`;
      const costSol = toNum(t.cost);
      const createdAt = t.created_at ? new Date(t.created_at) : null;
      return { id: String(t.id || t.tx_signature || Math.random()), title, marketAddress, marketQuestion, sig: String(t.tx_signature || ""), costSol, createdAt };
    });
  }, [myTxs, marketsByAddress]);

  /* ---------------- Actions with Modal ---------------- */
  async function executeModalAction() {
    if (!connected || !publicKey || !program || !anchorWallet) return;
    
    const { type, marketAddress, marketQuestion, amount } = actionModal;
    if (!type) return;

    const key = `${type}_${marketAddress}`;
    if (inFlightRef.current[key]) return;
    inFlightRef.current[key] = true;

    setActionModal(prev => ({ ...prev, step: "processing" }));

    try {
      const marketPk = new PublicKey(marketAddress);
      const [posPda] = getUserPositionPDA(marketPk, publicKey);
      
      let tx;
      let txType: "claim" | "refund" | "claim_fees" = type;

      if (type === "claim") {
        tx = await (program as any).methods.claimWinnings()
          .accounts({ market: marketPk, userPosition: posPda, user: publicKey })
          .transaction();
      } else if (type === "refund") {
        tx = await (program as any).methods.claimRefund()
          .accounts({ market: marketPk, userPosition: posPda, user: publicKey })
          .transaction();
      } else {
        tx = await (program as any).methods.claimCreatorFees()
          .accounts({ market: marketPk, creator: publicKey })
          .transaction();
      }

      const sig = await sendSignedTx({
        connection,
        tx,
        signTx: anchorWallet.signTransaction,
        feePayer: publicKey,
        commitment: "confirmed",
      });

      await saveClaimTransaction({
        marketAddress,
        marketQuestion,
        userAddress: walletBase58,
        txSignature: sig,
        txType,
        amountSol: amount,
      });

      // Update local state
      if (type === "claim") {
        setClaimables(prev => prev.filter(c => c.marketAddress !== marketAddress));
      } else if (type === "refund") {
        setRefundables(prev => prev.filter(r => r.marketAddress !== marketAddress));
      } else {
        setCreatorFeeClaimables(prev => prev.filter(c => c.marketAddress !== marketAddress));
      }

      setActionModal(prev => ({ ...prev, step: "success", txSignature: sig }));
      await reloadDashboardData();

    } catch (e: any) {
      console.error(`${type} error:`, e);
      const errMsg = String(e?.message || "");
      
      if (errMsg.toLowerCase().includes("user rejected")) {
        closeActionModal();
        return;
      }
      
      if (errMsg.toLowerCase().includes("already been processed")) {
        setActionModal(prev => ({ ...prev, step: "success" }));
        await reloadDashboardData();
        return;
      }

      setActionModal(prev => ({
        ...prev,
        step: "error",
        errorMessage: errMsg || "Transaction failed",
      }));
    } finally {
      inFlightRef.current[key] = false;
    }
  }

  async function handleClaimAllCreatorFees() {
    if (!creatorFeeClaimables.length) return;
    for (const c of creatorFeeClaimables) {
      openClaimFeesModal(c);
      // Note: This will open modal for first one. For batch, we'd need different UX
      break;
    }
  }

  async function handleProposeResolution() {
    if (resolveLoading) return;
    if (!connected || !publicKey || !program || !resolvingMarket) return;
    if (selectedOutcome === null) return;
    if (!anchorWallet?.signTransaction) { alert("Wallet not ready. Reconnect your wallet."); return; }
    const marketAddress = resolvingMarket.market_address;
    if (!marketAddress) return;
    const key = `propose_${marketAddress}`;
    if (inFlightRef.current[key]) return;
    inFlightRef.current[key] = true;
    if (!proofOk) { inFlightRef.current[key] = false; alert(proofMode === "link" ? "Please provide a proof URL." : "Please upload a proof image."); return; }

    const parseStatus = (statusRaw: any): "open" | "proposed" | "finalized" | "cancelled" | "unknown" => {
      if (!statusRaw) return "unknown";
      if (typeof statusRaw === "string") { const s = statusRaw.toLowerCase(); if (s === "open" || s === "proposed" || s === "finalized" || s === "cancelled") return s; return "unknown"; }
      if (statusRaw.open) return "open"; if (statusRaw.proposed) return "proposed"; if (statusRaw.finalized) return "finalized"; if (statusRaw.cancelled) return "cancelled";
      return "unknown";
    };
    const bnToNum = (x: any) => typeof x?.toNumber === "function" ? x.toNumber() : Number(x ?? 0);

    try {
      setResolveLoading(true);
      const marketPk = new PublicKey(marketAddress);
      const before = await (program as any).account.market.fetch(marketPk);
      const onchainCreator: PublicKey | undefined = before?.creator;
      if (!onchainCreator) throw new Error("On-chain market has no creator");
      if (!onchainCreator.equals(publicKey)) throw new Error(`Wrong creator wallet.\nOn-chain creator = ${onchainCreator.toBase58()}\nYou = ${publicKey.toBase58()}`);
      const statusStr = parseStatus(before?.status);
      const nowSec = Math.floor(Date.now() / 1000);
      const resolutionTimeSec = bnToNum(before?.resolutionTime);
      if (resolutionTimeSec && nowSec < resolutionTimeSec) throw new Error(`Market not ended on-chain yet. Ends in ${resolutionTimeSec - nowSec}s`);
      if (before?.resolved) throw new Error("Market already resolved on-chain.");
      if (before?.cancelled) throw new Error("Market cancelled on-chain.");
      if (statusStr === "finalized") throw new Error("Market already finalized on-chain.");
      if (statusStr === "cancelled") throw new Error("Market cancelled on-chain.");

      const proposedOutcomeOnChain = before?.proposedOutcome != null ? bnToNum(before?.proposedOutcome) : null;
      let effectiveSelectedOutcome = selectedOutcome;
      if (statusStr === "proposed" && proposedOutcomeOnChain != null) { effectiveSelectedOutcome = proposedOutcomeOnChain; if (selectedOutcome !== proposedOutcomeOnChain) setSelectedOutcome(proposedOutcomeOnChain); }
      if (statusStr !== "open" && statusStr !== "proposed") throw new Error(`Invalid on-chain status: ${statusStr}. (Needs: open/proposed)`);

      let proposedProofUrl: string | null = null;
      let proposedProofImage: string | null = null;
      if (proofMode === "link") { proposedProofUrl = proofUrl.trim(); proposedProofImage = null; }
      else { if (!proofFile) throw new Error("Missing proof file"); proposedProofImage = await uploadResolutionProofImage(proofFile, marketAddress); proposedProofUrl = null; }
      const note = proofNote.trim() || null;

      let sig: string | null = null;
      if (statusStr === "open") {
        const tx = await (program as any).methods.proposeResolution(effectiveSelectedOutcome).accounts({ market: marketPk, creator: publicKey }).transaction();
        try { sig = await sendSignedTx({ connection, tx, signTx: anchorWallet!.signTransaction, feePayer: publicKey }); console.log("✅ proposeResolution on-chain tx =", sig); }
        catch (e: any) { const msg = String(e?.message || "").toLowerCase(); if (msg.includes("already been processed")) { console.info("ℹ️ proposeResolution already processed, resyncing from chain"); sig = null; } else throw e; }
      } else { console.log("ℹ️ Market already proposed on-chain, skipping propose tx"); }

      const after = await (program as any).account.market.fetch(marketPk);
      const contestDeadlineSec = bnToNum(after?.contestDeadline);
      const proposedAtSec = bnToNum(after?.proposedAt);
      const deadlineIso = contestDeadlineSec && Number.isFinite(contestDeadlineSec) && contestDeadlineSec > 0 ? new Date(contestDeadlineSec * 1000).toISOString() : new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const proposedAtIso = proposedAtSec && Number.isFinite(proposedAtSec) && proposedAtSec > 0 ? new Date(proposedAtSec * 1000).toISOString() : new Date().toISOString();
      const finalProposedOutcome = after?.proposedOutcome != null ? bnToNum(after?.proposedOutcome) : effectiveSelectedOutcome;

      try { await fetch("/api/admin/market/approve/commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ market_address: marketAddress, proposed_outcome: finalProposedOutcome, proof_url: proposedProofUrl, proof_image: proposedProofImage, proof_note: note, tx_sig: sig }) }); } catch (dbErr) { console.error("DB commit failed (on-chain is source of truth)", dbErr); }
      try { await proposeResolutionDb({ market_address: marketAddress, proposed_winning_outcome: finalProposedOutcome, contest_deadline_iso: deadlineIso, proposed_proof_url: proposedProofUrl, proposed_proof_image: proposedProofImage, proposed_proof_note: note, tx_sig: sig } as any); } catch (dbErr) { console.error("DB commit error (tx still succeeded):", dbErr); }

      setMyCreatedMarkets((prev) => prev.map((m) => m.market_address === marketAddress ? { ...m, resolution_status: "proposed", proposed_winning_outcome: finalProposedOutcome, resolution_proposed_at: proposedAtIso, contest_deadline: deadlineIso, contested: false, contest_count: 0, proposed_proof_url: proposedProofUrl, proposed_proof_image: proposedProofImage, proposed_proof_note: note } : m));
      const labels = resolvingMarket.outcome_names || ["YES", "NO"];
      resetResolveModal();
      await reloadDashboardData();
      alert("Resolution proposed ✅\n\nOutcome: " + (labels[finalProposedOutcome] || `Option ${finalProposedOutcome + 1}`) + (sig ? `\n\nTx: ${sig.slice(0, 16)}…` : "\n\n(On-chain already proposed)") + "\n\nContest window: 24h");
    } catch (e: any) {
      console.error("PROPOSE FAILED", e);
      const errMsg = String(e?.message || "");
      if (errMsg.toLowerCase().includes("already been processed")) { alert("Transaction already processed. Refreshing…"); resetResolveModal(); await reloadDashboardData(); return; }
      if (errMsg.toLowerCase().includes("user rejected")) { alert("Transaction cancelled by user."); return; }
      alert("Propose failed: " + (errMsg || "Unknown error"));
    } finally { inFlightRef.current[key] = false; setResolveLoading(false); }
  }

  /* -------------------------------------------------------------------------- */
  /* Render                                                                     */
  /* -------------------------------------------------------------------------- */

  if (!connected) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-6">Dashboard</h1>
        <div className="card-pump"><p className="text-gray-400">Connect wallet to view your dashboard.</p></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 md:py-10">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white">Balance</h1>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-2">
              <span className="text-sm text-gray-400">Wallet: <span className="font-mono text-white/80">{walletLabel}</span></span>
              <span className="hidden sm:inline text-gray-600">•</span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Profit</span>
                <span className="text-2xl md:text-3xl font-bold text-pump-green">+{gainsSol.toFixed(2)} SOL</span>
              </div>
            </div>
          </div>
          {totalCreatorFeesSol > 0 && (
            <button onClick={handleClaimAllCreatorFees} className={["flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition", "border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20"].join(" ")}>
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="text-amber-400">Claim {totalCreatorFeesSol.toFixed(4)} SOL</span>
              <span className="text-amber-500/60 text-xs">fees</span>
            </button>
          )}
        </div>
      </div>

      {errorMsg && <div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{errorMsg}</div>}

      {/* Summary cards */}
      <div className="mb-6">
        <div className="grid grid-cols-3 gap-3 md:gap-4">
          <div className="card-pump p-3 md:p-4">
            <div className="text-[10px] md:text-xs text-gray-500 uppercase tracking-wide">Positions</div>
            <div className="text-xl md:text-2xl font-bold text-white mt-1">{portfolioStats.positions}</div>
            <div className="text-[10px] md:text-xs text-gray-500 mt-1 hidden sm:block">Markets traded</div>
          </div>
          <div className="card-pump p-3 md:p-4">
            <div className="text-[10px] md:text-xs text-gray-500 uppercase tracking-wide">Traded</div>
            <div className="text-xl md:text-2xl font-bold text-white mt-1">{portfolioStats.tradedVolumeSol.toFixed(2)} <span className="text-sm">SOL</span></div>
            <div className="text-[10px] md:text-xs text-gray-500 mt-1 hidden sm:block">Based on your fills</div>
          </div>
          <div className="card-pump p-3 md:p-4">
            <div className="text-[10px] md:text-xs text-gray-500 uppercase tracking-wide">Created</div>
            <div className="text-xl md:text-2xl font-bold text-white mt-1">{stats.created}</div>
            <div className="text-[10px] md:text-xs text-gray-500 mt-1 hidden sm:block">
              {totalCreatorFeesSol > 0 ? <span className="text-amber-400">{totalCreatorFeesSol.toFixed(4)} SOL claimable</span> : `Fees ~${stats.creatorFeesSol.toFixed(3)} SOL`}
            </div>
            {stats.created > 0 && <a href={solanaExplorerAddressUrl(walletBase58)} target="_blank" rel="noreferrer" className="text-[10px] text-pump-green hover:underline mt-1 hidden sm:inline-block">Verify on Explorer ↗</a>}
          </div>
        </div>
      </div>

      {/* Creator Fees Claimable */}
      {creatorFeeClaimables.length > 1 && (
        <div className="card-pump mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base md:text-xl font-bold text-white">💰 Creator Fees</h2>
            <span className="text-xs text-gray-500">From your finalized markets</span>
          </div>
          <div className="space-y-2">
            {creatorFeeClaimables.map((c) => (
              <div key={c.marketAddress} className="flex items-center justify-between p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm truncate">{c.marketQuestion}</div>
                  <div className="text-xs text-gray-500">{shortAddr(c.marketAddress)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-amber-400 font-semibold">{lamportsToSol(c.feeLamports).toFixed(4)} SOL</span>
                  <button onClick={() => openClaimFeesModal(c)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-amber-500 text-black hover:bg-amber-400">
                    Claim
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Claimables */}
      <div className="card-pump mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base md:text-xl font-bold text-white">🏆 Claimable winnings</h2>
          <span className="hidden md:inline text-xs text-gray-500">Resolved on-chain markets where you hold winning shares</span>
        </div>
        {loadingClaimables ? <p className="text-gray-400 text-sm">Checking claimables…</p> : claimables.length === 0 ? <p className="text-gray-500 text-sm">No claimable winnings yet.</p> : (
          <div className="space-y-3">
            {claimables.map((c) => (
              <div key={c.marketAddress} className="rounded-xl border border-pump-green/40 bg-pump-green/5 p-3 md:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-white font-semibold text-sm md:text-base truncate">{c.marketQuestion}</div>
                  <div className="text-xs text-gray-500 mt-1 truncate">{shortAddr(c.marketAddress)}{typeof c.estPayoutLamports === "number" && <> • <span className="text-pump-green font-semibold">~{lamportsToSol(c.estPayoutLamports).toFixed(4)} SOL</span></>}</div>
                </div>
                <button onClick={() => openClaimModal(c)} className="px-5 py-2 rounded-lg font-semibold transition w-full sm:w-auto bg-pump-green text-black hover:opacity-90">
                  Claim
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Refundables */}
      <div className="card-pump mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base md:text-xl font-bold text-white">💸 Refundable funds</h2>
          <span className="hidden md:inline text-xs text-gray-500">Cancelled on-chain markets where you can claim a refund</span>
        </div>
        {loadingClaimables ? <p className="text-gray-400 text-sm">Checking refunds…</p> : refundables.length === 0 ? <p className="text-gray-500 text-sm">No refundable markets.</p> : (
          <div className="space-y-3">
            {refundables.map((r) => (
              <div key={r.marketAddress} className="rounded-xl border border-[#ff5c73]/40 bg-[#ff5c73]/5 p-3 md:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-white font-semibold text-sm md:text-base truncate">{r.marketQuestion}</div>
                  <div className="text-xs text-gray-500 mt-1 truncate">{shortAddr(r.marketAddress)}{typeof r.estRefundLamports === "number" && <> • <span className="text-[#ff5c73] font-semibold">~{lamportsToSol(r.estRefundLamports).toFixed(4)} SOL</span></>}</div>
                </div>
                <button onClick={() => openRefundModal(r)} className="px-5 py-2 rounded-lg font-semibold transition w-full sm:w-auto bg-[#ff5c73] text-black hover:opacity-90">
                  Refund
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Claim & Refund History */}
      {claimHistory.length > 0 && (
        <div className="card-pump mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base md:text-xl font-bold text-white">📜 Claim & Refund History</h2>
            <span className="text-xs text-gray-500">Total received: <span className="text-pump-green font-semibold">{totalClaimedSol.toFixed(4)} SOL</span></span>
          </div>
          <div className="space-y-2">
            {claimHistory.map((h) => {
              const typeLabel = h.tx_type === "claim" ? "✅ Claim winnings" : h.tx_type === "refund" ? "💸 Refund" : "💰 Claim fees";
              const typeColor = h.tx_type === "claim" ? "text-pump-green" : h.tx_type === "refund" ? "text-[#ff5c73]" : "text-amber-400";
              const borderColor = h.tx_type === "claim" ? "border-pump-green/20" : h.tx_type === "refund" ? "border-[#ff5c73]/20" : "border-amber-500/20";
              const bgColor = h.tx_type === "claim" ? "bg-pump-green/5" : h.tx_type === "refund" ? "bg-[#ff5c73]/5" : "bg-amber-500/5";
              return (
                <div key={h.id} className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border ${borderColor} ${bgColor}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${typeColor}`}>{typeLabel}</span>
                      <span className="text-gray-500">•</span>
                      <span className="text-white text-sm truncate">{h.market_question}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1 flex flex-wrap items-center gap-2">
                      <span>{h.created_at ? new Date(h.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                      {h.tx_signature && <><span className="opacity-40">•</span><a href={solanaExplorerTxUrl(h.tx_signature)} target="_blank" rel="noreferrer" className="text-pump-green hover:underline">tx: {shortSig(h.tx_signature)}</a></>}
                    </div>
                  </div>
                  <div className={`text-sm font-bold ${typeColor} mt-2 sm:mt-0`}>+{h.amount_sol.toFixed(4)} SOL</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-4">
        <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>Activity</TabButton>
        <TabButton active={tab === "created"} onClick={() => setTab("created")}>My markets</TabButton>
        <TabButton active={tab === "bookmarks"} onClick={() => setTab("bookmarks")}>Bookmarked</TabButton>
        <div className="ml-auto text-xs text-gray-500">
          {tab === "activity" && (loadingTxs ? "Loading…" : `${txRows.length} txs`)}
          {tab === "created" && (loadingMarkets ? "Loading…" : `${myCreatedMarkets.length} markets`)}
          {tab === "bookmarks" && (loadingBookmarks ? "Loading…" : `${bookmarkedMarkets.length} saved`)}
        </div>
      </div>

      <div className="card-pump">
        {/* ACTIVITY */}
        {tab === "activity" && (
          <>
            {loadingTxs ? <p className="text-gray-400 text-sm">Loading transactions…</p> : txRows.length === 0 ? <p className="text-gray-500 text-sm">No activity yet.</p> : (
              <div className="space-y-3">
                {txRows.map((r) => (
                  <div key={r.id} className="rounded-xl border border-white/10 bg-pump-dark/40 p-3 md:p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-white font-medium text-sm">{r.title}</div>
                        <div className="text-xs text-gray-400 mt-1 truncate">{r.marketQuestion || shortAddr(r.marketAddress)}</div>
                        <div className="text-[10px] text-gray-500 mt-1 flex flex-wrap items-center gap-1 md:gap-2">
                          <span>{r.createdAt ? r.createdAt.toLocaleString("fr-FR") : ""}</span>
                          {r.sig && <><span className="opacity-40">•</span><a href={solanaExplorerTxUrl(r.sig)} target="_blank" rel="noreferrer" className="text-pump-green hover:underline">tx: {shortSig(r.sig)}</a></>}
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        <div className="text-pump-green font-bold text-sm">{r.costSol > 0 ? `${r.costSol.toFixed(4)} SOL` : "0.0000 SOL"}</div>
                        {r.marketAddress && <Link href={`/trade/${r.marketAddress}`} className="px-3 py-1.5 rounded-lg bg-pump-green text-black text-xs font-semibold hover:opacity-90 transition">View</Link>}
                      </div>
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
            {loadingMarkets ? <p className="text-gray-400 text-sm">Loading markets…</p> : myCreatedMarkets.length === 0 ? <p className="text-gray-500 text-sm">You haven&apos;t created any markets yet.</p> : (
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
                  const endMs = m.end_date ? new Date(m.end_date).getTime() : NaN;
                  const proposeCutoffMs = Number.isFinite(endMs) ? endMs + 24 * 60 * 60 * 1000 : NaN;
                  const withinProposeWindow = Number.isFinite(proposeCutoffMs) ? Date.now() <= proposeCutoffMs : false;
                  const canPropose = ended && withinProposeWindow && !isResolvedFinal && !isProposed && !isCancelled;
                  const feeClaimable = creatorFeeClaimables.find((c) => c.marketAddress === addr);
                  const boxCls = isResolvedFinal ? "border-gray-600 bg-gray-800/30" : isCancelled ? "border-[#ff5c73]/60 bg-[#ff5c73]/5" : isProposed ? "border-pump-green/60 bg-pump-green/5" : canPropose ? "border-yellow-500/60 bg-yellow-500/5" : "border-white/10 bg-pump-dark/40";

                  return (
                    <div key={String(m.id || addr || idx)} className={`rounded-xl border p-3 md:p-4 ${boxCls}`}>
                      <div className="flex flex-col gap-3">
                        <div className="min-w-0">
                          <div className="text-white font-semibold text-sm truncate">{q}</div>
                          <div className="text-[10px] text-gray-500 mt-1 flex flex-wrap items-center gap-1 md:gap-2">
                            <span>{addr ? shortAddr(addr) : ""}</span>
                            <span className="opacity-40">•</span>
                            {isResolvedFinal ? <span className="text-green-400">✓ Finalized</span> : isCancelled ? <span className="text-[#ff5c73]">Cancelled</span> : isProposed ? <span className="text-pump-green">Proposed{Number.isFinite(remainingMs) ? ` (${formatMsToHhMm(Math.max(0, remainingMs))} left)` : ""}</span> : <span className={ended ? "text-yellow-400" : "text-gray-400"}>{timeStatus}</span>}
                            {feeClaimable && <><span className="opacity-40">•</span><span className="text-amber-400">💰 {lamportsToSol(feeClaimable.feeLamports).toFixed(4)} SOL</span></>}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-white font-semibold text-sm">{volSol.toFixed(2)} SOL</div>
                            <div className="text-[10px] text-gray-500">volume</div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap justify-end">
                            {feeClaimable && <button onClick={() => openClaimFeesModal(feeClaimable)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-amber-500 text-black hover:bg-amber-400">Claim fees</button>}
                            {canPropose && <button onClick={() => { setResolvingMarket(m); setSelectedOutcome(null); setMode("upload"); setProofNote(""); }} className="px-3 py-1.5 rounded-lg bg-yellow-500 text-black text-xs font-semibold hover:bg-yellow-400 transition">⚖️ Propose</button>}
                            {toResolutionStatus(m.resolution_status) === "proposed" && addr && <Link href={`/contest/${addr}`} className={["px-3 py-1.5 rounded-lg text-xs font-semibold transition border", Number(m.contest_count || 0) > 0 ? "bg-[#ff5c73]/15 border-[#ff5c73]/40 text-[#ff5c73] hover:bg-[#ff5c73]/20" : "bg-black/30 border-white/10 text-gray-300 hover:border-white/20"].join(" ")} title="Open contest / disputes">Disputes{Number(m.contest_count || 0) > 0 ? ` (${Number(m.contest_count)})` : ""}</Link>}
                            {addr && <Link href={`/trade/${addr}`} className="px-3 py-1.5 rounded-lg bg-pump-green text-black text-xs font-semibold hover:opacity-90 transition">View</Link>}
                          </div>
                        </div>
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
            {loadingBookmarks ? <p className="text-gray-400 text-sm">Loading bookmarks…</p> : bookmarkedMarkets.length === 0 ? <p className="text-gray-500 text-sm">No bookmarked markets yet.</p> : (
              <div className="space-y-3">
                {bookmarkedMarkets.map((m, idx) => {
                  const addr = String(m.market_address || "");
                  const q = String(m.question || "Market");
                  const volSol = lamportsToSol(toNum(m.total_volume));
                  const status = formatTimeStatus(m.end_date);
                  return (
                    <div key={String(m.id || addr || idx)} className="rounded-xl border border-white/10 bg-pump-dark/40 p-3 md:p-4">
                      <div className="flex flex-col gap-3">
                        <div className="min-w-0">
                          <div className="text-white font-semibold text-sm truncate">{q}</div>
                          <div className="text-[10px] text-gray-500 mt-1 flex flex-wrap items-center gap-1 md:gap-2">
                            <span>{shortAddr(addr)}</span>
                            <span className="opacity-40">•</span>
                            <span className="text-gray-400">{status}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-white font-semibold text-sm">{volSol.toFixed(2)} SOL</div>
                            <div className="text-[10px] text-gray-500">volume</div>
                          </div>
                          {addr && <Link href={`/trade/${addr}`} className="px-3 py-1.5 rounded-lg bg-pump-green text-black text-xs font-semibold hover:opacity-90 transition">View</Link>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Action Modal (Claim/Refund/Fees) */}
      {actionModal.type && (
        <ActionModal
          modal={actionModal}
          onClose={closeActionModal}
          onConfirm={executeModalAction}
        />
      )}

      {/* Resolve Modal */}
      {resolvingMarket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-pump-dark border border-white/20 rounded-2xl p-5 md:p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-white mb-2">Propose resolution</h3>
            <p className="text-gray-400 text-sm mb-1 truncate">{resolvingMarket.question}</p>
            <p className="text-[11px] text-gray-500 mb-4">⏳ Contest window: 24h — trading will be locked (UI) during this period.</p>

            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-2 block">Select proposed winning outcome:</label>
              <div className="space-y-2">
                {(resolvingMarket.outcome_names || ["YES", "NO"]).map((label, idx) => (
                  <button key={idx} onClick={() => setSelectedOutcome(idx)} className={["w-full p-3 rounded-lg border text-left transition", selectedOutcome === idx ? "border-pump-green bg-pump-green/20 text-white" : "border-white/20 bg-white/5 text-gray-300 hover:border-white/40"].join(" ")}>
                    <span className="font-semibold">{label}</span>
                    {selectedOutcome === idx && <span className="float-right text-pump-green">✓</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4 space-y-3">
              <div className="flex gap-2">
                <button type="button" onClick={() => setMode("upload")} className={["flex-1 px-3 py-2 rounded-lg border text-sm font-semibold transition", proofMode === "upload" ? "border-pump-green bg-pump-green/20 text-white" : "border-white/20 bg-white/5 text-gray-300 hover:border-white/40"].join(" ")}>Upload image</button>
                <button type="button" onClick={() => setMode("link")} className={["flex-1 px-3 py-2 rounded-lg border text-sm font-semibold transition", proofMode === "link" ? "border-pump-green bg-pump-green/20 text-white" : "border-white/20 bg-white/5 text-gray-300 hover:border-white/40"].join(" ")}>Proof link</button>
              </div>

              {proofMode === "link" ? (
                <div>
                  <label className="text-sm text-gray-400 mb-1 block">Proof URL (required)</label>
                  <input value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="https://..." className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-pump-green/60" />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm text-gray-400 mb-1 block">Upload proof image (required)</label>
                  <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] || null; setProofFile(f); if (proofPreview) URL.revokeObjectURL(proofPreview); if (f) { const url = URL.createObjectURL(f); setProofPreview(url); } else { setProofPreview(""); } }} className="w-full text-sm text-gray-300" />
                  {proofPreview && <div className="rounded-xl overflow-hidden border border-white/10 bg-black/30"><img src={proofPreview} alt="Proof preview" className="w-full h-40 object-cover" /></div>}
                </div>
              )}

              <div>
                <label className="text-sm text-gray-400 mb-1 block">Proof note (optional)</label>
                <textarea value={proofNote} onChange={(e) => setProofNote(e.target.value)} placeholder="Short explanation..." rows={3} className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-pump-green/60" />
              </div>

              {!proofOk && <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-2">{proofMode === "link" ? "Please provide a proof URL." : "Please upload a proof image."}</div>}
            </div>

            <div className="flex gap-3">
              <button onClick={resetResolveModal} className="flex-1 px-4 py-2 rounded-lg border border-white/20 text-gray-300 hover:bg-white/10 transition">Cancel</button>
              <button onClick={handleProposeResolution} disabled={selectedOutcome === null || resolveLoading || !proofOk} className={["flex-1 px-4 py-2 rounded-lg font-semibold transition", selectedOutcome === null || resolveLoading || !proofOk ? "bg-gray-700 text-gray-400 cursor-not-allowed" : "bg-yellow-500 text-black hover:bg-yellow-400"].join(" ")}>
                {resolveLoading ? "Processing…" : "Confirm proposal"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-4 text-center">⚠️ This does NOT finalize on-chain yet. It starts a 24h contest window.</p>
          </div>
        </div>
      )}
    </div>
  );
}
