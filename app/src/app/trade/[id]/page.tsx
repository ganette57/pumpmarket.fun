"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import { useProgram } from "@/hooks/useProgram";

import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";
import MarketActions from "@/components/MarketActions";
import CreatorSocialLinks from "@/components/CreatorSocialLinks";
import CommentsSection from "@/components/CommentsSection";
import TradingPanel from "@/components/TradingPanel";
import OddsHistoryChart from "@/components/OddsHistoryChart";
import MarketActivityTab from "@/components/MarketActivity";
import ResolutionPanel from "@/components/ResolutionPanel";

import { supabase } from "@/lib/supabaseClient";
import { buildOddsSeries, downsample } from "@/lib/marketHistory";
import { getMarketByAddress, recordTransaction, applyTradeToMarketInSupabase } from "@/lib/markets";

import { lamportsToSol, solToLamports, getUserPositionPDA, PLATFORM_WALLET } from "@/utils/solana";

import type { SocialLinks } from "@/components/SocialLinksForm";

type SupabaseMarket = any;

type UiMarket = {
  dbId?: string;
  publicKey: string;
  question: string;
  description: string;
  category?: string;
  imageUrl?: string;
  creator: string;

  totalVolume: number;
  resolutionTime: number;
  creatorResolveDeadline?: string | null;
  resolved: boolean;

  winningOutcome?: number | null;
  resolvedAt?: string | null;
  resolutionProofUrl?: string | null;
  resolutionProofImage?: string | null;
  resolutionProofNote?: string | null;

  resolutionStatus?: "open" | "proposed" | "finalized" | "cancelled";
  proposedOutcome?: number | null;
  proposedAt?: string | null;
  contestDeadline?: string | null;
  contested?: boolean;
  contestCount?: number;

  proposedProofUrl?: string | null;
  proposedProofImage?: string | null;
  proposedProofNote?: string | null;

  socialLinks?: SocialLinks;

  marketType: 0 | 1;
  outcomeNames?: string[];
  outcomeSupplies?: number[];

  yesSupply?: number;
  noSupply?: number;
};

type Derived = {
  marketType: 0 | 1;
  names: string[];
  supplies: number[];
  percentages: number[];
  totalSupply: number;
  isBinaryStyle: boolean;
  missingOutcomes: boolean;
};

type OddsRange = "24h" | "7d" | "30d" | "all";
type BottomTab = "discussion" | "activity";

function useIsMobile(breakpointPx = 1024) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${breakpointPx - 1}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [breakpointPx]);
  return isMobile;
}

function safeParamId(p: unknown): string | null {
  if (!p) return null;
  if (typeof p === "string") return p;
  if (Array.isArray(p) && typeof p[0] === "string") return p[0];
  return null;
}

function toNumberArray(x: any): number[] | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x.map((v) => Number(v) || 0);
  if (typeof x === "string") {
    try {
      const parsed = JSON.parse(x);
      if (Array.isArray(parsed)) return parsed.map((v) => Number(v) || 0);
    } catch {}
  }
  return undefined;
}

function toStringArray(x: any): string[] | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x.map((v) => String(v)).filter(Boolean);
  if (typeof x === "string") {
    try {
      const parsed = JSON.parse(x);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
    } catch {}
  }
  return undefined;
}

function formatVol(volLamports: number) {
  const sol = lamportsToSol(Number(volLamports) || 0);
  if (sol >= 1000) return `${(sol / 1000).toFixed(0)}k`;
  if (sol >= 100) return `${sol.toFixed(0)}`;
  return sol.toFixed(2);
}

function clampInt(n: number, min: number, max: number) {
  const v = Math.floor(Number(n) || 0);
  return Math.max(min, Math.min(max, v));
}

function toResolutionStatus(x: any): "open" | "proposed" | "finalized" | "cancelled" {
  const s = String(x || "").toLowerCase().trim();
  if (s === "proposed" || s === "finalized" || s === "cancelled") return s;
  return "open";
}

function formatMsToHhMm(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / (60 * 1000)));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function addHoursIso(ms: number, hours: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const t = ms + hours * 60 * 60 * 1000;
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Parse end_date safely:
 * - "YYYY-MM-DD" => end of day UTC
 * - ISO with timezone => parse as-is
 * - ISO without timezone => parse as local
 * - Postgres "YYYY-MM-DD HH:mm:ss" => local
 */
function parseEndDateMs(raw: any): number {
  if (!raw) return NaN;

  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  const s = String(raw).trim();
  if (!s) return NaN;

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);

  if (isDateOnly) {
    const t = new Date(`${s}T23:59:59Z`).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?/.test(s) ? s.replace(" ", "T") : s;
  const t = new Date(normalized).getTime();
  return Number.isFinite(t) ? t : NaN;
}

export default function TradePage() {
  const params = useParams();
  const id = safeParamId((params as any)?.id);

  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();

  const isMobile = useIsMobile(1024);

  const [market, setMarket] = useState<UiMarket | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [positionShares, setPositionShares] = useState<number[] | null>(null);
  const [marketBalanceLamports, setMarketBalanceLamports] = useState<number | null>(null);

  const [oddsRange, setOddsRange] = useState<OddsRange>("24h");
  const [oddsPoints, setOddsPoints] = useState<{ t: number; pct: number[] }[]>([]);
  const [bottomTab, setBottomTab] = useState<BottomTab>("discussion");

  // Mobile drawer state
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false);
  const [mobileOutcomeIndex, setMobileOutcomeIndex] = useState(0);
  const [mobileDefaultSide, setMobileDefaultSide] = useState<"buy" | "sell">("buy");

  useEffect(() => {
    if (!id) return;
    void loadMarket(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadMarket(marketAddress: string) {
    setLoading(true);
    try {
      const supabaseMarket: SupabaseMarket = await getMarketByAddress(marketAddress);
      if (!supabaseMarket) {
        setMarket(null);
        return;
      }

      const mt = (typeof supabaseMarket.market_type === "number" ? supabaseMarket.market_type : 0) as 0 | 1;

      const names = toStringArray(supabaseMarket.outcome_names) ?? [];
      const supplies = toNumberArray(supabaseMarket.outcome_supplies) ?? [];

      const endMs = parseEndDateMs(supabaseMarket?.end_date);
      const resolutionTime = Number.isFinite(endMs) ? Math.floor(endMs / 1000) : 0;
      const creatorResolveDeadline = addHoursIso(endMs, 48);

      const transformed: UiMarket = {
        dbId: supabaseMarket.id,
        publicKey: supabaseMarket.market_address,
        question: supabaseMarket.question || "",
        description: supabaseMarket.description || "",
        category: supabaseMarket.category || "other",
        imageUrl: supabaseMarket.image_url || undefined,
        creator: String(supabaseMarket.creator || ""),
        creatorResolveDeadline,
        totalVolume: Number(supabaseMarket.total_volume) || 0,
        resolutionTime,
        resolved: !!supabaseMarket.resolved,

        winningOutcome:
          supabaseMarket.winning_outcome === null || supabaseMarket.winning_outcome === undefined
            ? null
            : Number(supabaseMarket.winning_outcome),
        resolvedAt: supabaseMarket.resolved_at ?? null,

        resolutionProofUrl: supabaseMarket.resolution_proof_url ?? null,
        resolutionProofImage: supabaseMarket.resolution_proof_image ?? null,
        resolutionProofNote: supabaseMarket.resolution_proof_note ?? null,

        resolutionStatus: toResolutionStatus(supabaseMarket.resolution_status),
        proposedOutcome:
          supabaseMarket.proposed_winning_outcome === null || supabaseMarket.proposed_winning_outcome === undefined
            ? null
            : Number(supabaseMarket.proposed_winning_outcome),
        proposedAt: supabaseMarket.resolution_proposed_at ?? null,
        contestDeadline: supabaseMarket.contest_deadline ?? null,
        contested: !!supabaseMarket.contested,
        contestCount:
          supabaseMarket.contest_count === null || supabaseMarket.contest_count === undefined
            ? 0
            : Number(supabaseMarket.contest_count) || 0,

        proposedProofUrl: supabaseMarket.proposed_proof_url ?? null,
        proposedProofImage: supabaseMarket.proposed_proof_image ?? null,
        proposedProofNote: supabaseMarket.proposed_proof_note ?? null,

        socialLinks: supabaseMarket.social_links || undefined,

        marketType: mt,
        outcomeNames: names.slice(0, 10),
        outcomeSupplies: supplies.slice(0, 10),

        yesSupply: Number(supabaseMarket.yes_supply) || 0,
        noSupply: Number(supabaseMarket.no_supply) || 0,
      };

      setMarket(transformed);
    } catch (err) {
      console.error("Error loading market:", err);
      setMarket(null);
    } finally {
      setLoading(false);
    }
  }

  const derived: Derived | null = useMemo(() => {
    if (!market) return null;

    const marketType = (market.marketType ?? 0) as 0 | 1;

    let names = (market.outcomeNames || []).map(String).filter(Boolean);
    const missingOutcomes = marketType === 1 && names.length < 2;

    if (marketType === 0) {
      if (names.length !== 2) names = ["YES", "NO"];
    }

    const safeNames = missingOutcomes ? ["Loading…", "Loading…"] : names.slice(0, 10);

    let supplies = Array.isArray(market.outcomeSupplies) ? market.outcomeSupplies.map((x) => Number(x || 0)) : [];

    if (!supplies.length && safeNames.length === 2) {
      supplies = [Number(market.yesSupply || 0), Number(market.noSupply || 0)];
    }

    const targetLen = safeNames.length || (marketType === 0 ? 2 : 0);

    if (targetLen > 0) {
      if (supplies.length < targetLen) supplies = [...supplies, ...Array(targetLen - supplies.length).fill(0)];
      else if (supplies.length > targetLen) supplies = supplies.slice(0, targetLen);
    }

    const totalSupply = supplies.reduce((sum, s) => sum + (Number(s) || 0), 0);

    const percentages =
      supplies.length > 0
        ? supplies.map((s) => (totalSupply > 0 ? ((Number(s) || 0) / totalSupply) * 100 : 100 / supplies.length))
        : [];

    return {
      marketType,
      names: safeNames,
      supplies,
      percentages,
      totalSupply,
      isBinaryStyle: safeNames.length === 2,
      missingOutcomes,
    };
  }, [market]);

  const userSharesForUi = useMemo(() => {
    const len = derived?.names?.length ?? 0;
    const out = Array(len).fill(0);
    for (let i = 0; i < len; i++) out[i] = Math.floor(Number(positionShares?.[i] || 0));
    return out;
  }, [positionShares, derived?.names?.length]);

  const filteredOddsPoints = useMemo(() => {
    if (!oddsPoints.length) return [];
    if (oddsRange === "all") return oddsPoints;

    const now = Date.now();
    const cutoff =
      oddsRange === "24h"
        ? now - 24 * 60 * 60 * 1000
        : oddsRange === "7d"
        ? now - 7 * 24 * 60 * 60 * 1000
        : now - 30 * 24 * 60 * 60 * 1000;

    const arr = oddsPoints.filter((p) => p.t >= cutoff);
    if (!arr.length) return [oddsPoints[oddsPoints.length - 1]];
    return arr;
  }, [oddsPoints, oddsRange]);

  // Poll ONLY when proposed (so countdown / dispute state updates)
  useEffect(() => {
    if (!id) return;
    if (!market) return;
    const status = market.resolutionStatus ?? "open";
    if (status !== "proposed") return;

    const t = setInterval(() => void loadMarket(id), 25000);
    return () => clearInterval(t);
  }, [id, market]);

  // Market balance
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const marketPk = new PublicKey(id);
        const bal = await connection.getBalance(marketPk);
        setMarketBalanceLamports(bal);
      } catch {
        setMarketBalanceLamports(null);
      }
    })();
  }, [id, connection]);

  // User positions
  useEffect(() => {
    if (!id || !publicKey || !connected || !program) {
      setPositionShares(null);
      return;
    }

    (async () => {
      try {
        const marketPk = new PublicKey(id);
        const [pda] = getUserPositionPDA(marketPk, publicKey);
        const acc = await (program as any).account.userPosition.fetch(pda);
        const sharesArr = Array.isArray(acc?.shares) ? acc.shares.map((x: any) => Number(x) || 0) : [];
        setPositionShares(sharesArr);
      } catch {
        setPositionShares(null);
      }
    })();
  }, [id, publicKey, connected, program]);

  // Odds history
  useEffect(() => {
    if (!market?.dbId) {
      setOddsPoints([]);
      return;
    }
    const outcomesCount = derived?.names?.length ?? 0;
    if (!outcomesCount) {
      setOddsPoints([]);
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase
          .from("transactions")
          .select("created_at,is_buy,amount,outcome_index,is_yes,shares")
          .eq("market_id", market.dbId)
          .order("created_at", { ascending: true });

        if (error) {
          console.error("transactions fetch error:", error);
          setOddsPoints([]);
          return;
        }

        const pts = buildOddsSeries((data as any[]) || [], outcomesCount);
        const lite = downsample(pts, 220).map((p) => ({ t: p.t, pct: p.pct }));
        setOddsPoints(lite);
      } catch (e) {
        console.error("odds history error:", e);
        setOddsPoints([]);
      }
    })();
  }, [market?.dbId, derived?.names?.length]);

  async function handleTrade(shares: number, outcomeIndex: number, side: "buy" | "sell", costSol?: number) {
    if (!connected || !publicKey || !program) {
      if (!publicKey) alert("Please connect your wallet");
      if (!program) alert("Program not loaded");
      return;
    }
    if (!market || !id || !derived) return;

    const safeShares = Math.max(1, Math.floor(shares));
    const safeOutcome = clampInt(outcomeIndex, 0, derived.names.length - 1);

    setSubmitting(true);

    // optimistic UI
    setMarket((prev) => {
      if (!prev) return prev;
      const nextSupplies = Array.isArray(prev.outcomeSupplies) ? prev.outcomeSupplies.slice() : Array(derived.names.length).fill(0);
      while (nextSupplies.length < derived.names.length) nextSupplies.push(0);

      const delta = side === "buy" ? safeShares : -safeShares;
      nextSupplies[safeOutcome] = Math.max(0, Number(nextSupplies[safeOutcome] || 0) + delta);

      return {
        ...prev,
        outcomeSupplies: nextSupplies.slice(0, 10),
        yesSupply: derived.names.length === 2 ? nextSupplies[0] : prev.yesSupply || 0,
        noSupply: derived.names.length === 2 ? nextSupplies[1] : prev.noSupply || 0,
      };
    });

    try {
      const marketPubkey = new PublicKey(id);
      const [positionPDA] = getUserPositionPDA(marketPubkey, publicKey);
      const creatorPubkey = new PublicKey(market.creator);

      const amountBn = new BN(safeShares);

      let txSig: string;
      if (side === "buy") {
        txSig = await (program as any).methods
          .buyShares(amountBn, safeOutcome)
          .accounts({
            market: marketPubkey,
            userPosition: positionPDA,
            platformWallet: PLATFORM_WALLET,
            creator: creatorPubkey,
            trader: publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } else {
        txSig = await (program as any).methods
          .sellShares(amountBn, safeOutcome)
          .accounts({
            market: marketPubkey,
            userPosition: positionPDA,
            platformWallet: PLATFORM_WALLET,
            creator: creatorPubkey,
            trader: publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      const name = derived.names[safeOutcome] || `Outcome #${safeOutcome + 1}`;
      const safeCostSol = typeof costSol === "number" && Number.isFinite(costSol) ? costSol : null;

      if (market.dbId) {
        await recordTransaction({
          market_id: market.dbId,
          market_address: market.publicKey,
          user_address: publicKey.toBase58(),
          tx_signature: txSig,
          is_buy: side === "buy",
          is_yes: derived.names.length === 2 ? safeOutcome === 0 : null,
          amount: safeShares,
          shares: safeShares,
          cost: safeCostSol,
          outcome_index: safeOutcome,
          outcome_name: name,
        } as any);
      }

      const deltaVolLamports = side === "buy" && safeCostSol != null ? solToLamports(safeCostSol) : 0;

      await applyTradeToMarketInSupabase({
        market_address: market.publicKey,
        market_type: market.marketType,
        outcome_index: safeOutcome,
        delta_shares: side === "buy" ? safeShares : -safeShares,
        delta_volume_lamports: deltaVolLamports,
      });

      await loadMarket(id);

      // close drawer on success (mobile)
      if (isMobile) setMobileTradeOpen(false);

      alert(
        `Success! 🎉\n\n${side === "buy" ? "Bought" : "Sold"} ${safeShares} shares of "${name}"\n\nTx: ${txSig.slice(0, 16)}...\n\nhttps://explorer.solana.com/tx/${txSig}?cluster=devnet`
      );
    } catch (error: any) {
      console.error(`${side.toUpperCase()} shares error:`, error);
      await loadMarket(id);
      alert(`Error: ${error?.message || `Failed to ${side}`}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-pump-green" />
          <p className="text-gray-400 mt-4">Loading market...</p>
        </div>
      </div>
    );
  }

  if (!market || !derived) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-xl">Market not found</p>
      </div>
    );
  }

  const { marketType, names, supplies, percentages, isBinaryStyle, missingOutcomes } = derived;

  const nowSec = Math.floor(Date.now() / 1000);
  const hasValidEnd = Number.isFinite(market.resolutionTime) && market.resolutionTime > 0;
  const ended = hasValidEnd ? nowSec >= market.resolutionTime : false;

  const status = market.resolutionStatus ?? "open";
  const isResolvedOnChain = !!market.resolved;

  const isProposed =
    status === "proposed" ||
    market.proposedOutcome != null ||
    !!market.contestDeadline ||
    !!market.proposedProofUrl ||
    !!market.proposedProofImage ||
    !!market.proposedProofNote;

  const showProposedBox = isProposed && !isResolvedOnChain;
  const showResolvedProofBox = isResolvedOnChain;

  const marketClosed = isResolvedOnChain || isProposed || ended;

  const endLabel = hasValidEnd
    ? new Date(market.resolutionTime * 1000).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "No end date";

  const winningLabel =
    market.winningOutcome != null && Number.isFinite(Number(market.winningOutcome))
      ? names[Math.max(0, Math.min(Number(market.winningOutcome), names.length - 1))] || `Option ${Number(market.winningOutcome) + 1}`
      : null;

  const proposedLabel =
    market.proposedOutcome != null && Number.isFinite(Number(market.proposedOutcome))
      ? names[Math.max(0, Math.min(Number(market.proposedOutcome), names.length - 1))] || `Option ${Number(market.proposedOutcome) + 1}`
      : null;

  const deadlineMs = market.contestDeadline ? new Date(market.contestDeadline).getTime() : NaN;
  const contestRemainingMs = Number.isFinite(deadlineMs) ? deadlineMs - Date.now() : NaN;
  const contestOpen = Number.isFinite(contestRemainingMs) ? contestRemainingMs > 0 : false;

  const openMobileTrade = (idx: number) => {
    if (!isMobile) return;
    setMobileOutcomeIndex(Math.max(0, Math.min(idx, names.length - 1)));
    setMobileDefaultSide("buy"); // ✅ always open on BUY
    setMobileTradeOpen(true);
  };

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* LEFT */}
          <div className="lg:col-span-2 space-y-6">
            <div className="card-pump">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-pump-dark">
                  {market.imageUrl ? (
                    <Image src={market.imageUrl} alt={market.question} width={80} height={80} className="object-cover w-full h-full" />
                  ) : (
                    <CategoryImagePlaceholder category={market.category || "crypto"} className="w-full h-full scale-[0.4]" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-3 min-w-0">
  <h1 className="text-2xl md:text-3xl font-bold text-white leading-tight break-words min-w-0">
    {market.question}
  </h1>

  {/* mobile: actions under title -> never overflow */}
  <div className="flex justify-end md:justify-start">
    <MarketActions
      marketAddress={market.publicKey}
      marketDbId={market.dbId ?? null}
      question={market.question}
    />
  </div>
</div>

                  {market.socialLinks && (
                    <div className="mb-0">
                      <CreatorSocialLinks socialLinks={market.socialLinks} />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-4 text-sm text-gray-400 mt-4 pt-4 border-t border-gray-800">
                <div>
                  <span className="text-gray-500">{formatVol(market.totalVolume)} SOL Vol</span>
                </div>
                <div>{endLabel}</div>

                <div className="ml-auto text-xs text-gray-500 flex items-center gap-2">
  {showProposedBox && (
    <span className="px-2 py-1 rounded-full border border-pump-green/40 bg-pump-green/10 text-pump-green">
      Proposed
    </span>
  )}

  {showResolvedProofBox && (
    <span className="px-2 py-1 rounded-full border border-gray-600 bg-gray-800/40 text-green-400">
      Resolved
    </span>
  )}
</div>
              </div>

              <p className="text-gray-400 mt-4 mb-4">{market.description}</p>

              {missingOutcomes && (
                <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                  Outcomes are still indexing… (Supabase/outcomes not ready yet)
                </div>
              )}

              {showProposedBox && (
                <div className="mb-4 rounded-xl border border-pump-green/30 bg-pump-green/10 p-4">
                  <div className="text-sm text-white font-semibold">Resolution proposed — contest window open</div>
                  <div className="text-xs text-gray-300 mt-1">
                    Trading is locked while the resolution is contestable.
                    {contestOpen && Number.isFinite(contestRemainingMs) ? (
                      <>
                        {" "}
                        <span className="text-pump-green font-semibold">{formatMsToHhMm(contestRemainingMs)} remaining</span>
                      </>
                    ) : (
                      <>
                        {" "}
                        <span className="text-yellow-300 font-semibold">contest window may have ended</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Outcomes (click opens drawer on mobile) */}
              {isBinaryStyle ? (
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {names.slice(0, 2).map((outcome, index) => {
                    const pct = (percentages[index] ?? 0).toFixed(1);
                    const supply = supplies[index] || 0;
                    const isYes = index === 0;

                    return (
                      <button
                        key={index}
                        onClick={() => openMobileTrade(index)}
                        disabled={!isMobile || marketClosed}
                        className={`text-left rounded-2xl px-5 py-4 md:px-6 md:py-5 border bg-pump-dark/80 transition ${
                          isYes ? "border-pump-green/60" : "border-[#ff5c73]/60"
                        } ${isMobile && !marketClosed ? "active:scale-[0.99]" : ""}`}
                      >
                        <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                          <span className={`uppercase tracking-wide font-semibold ${isYes ? "text-pump-green" : "text-[#ff5c73]"}`}>
                            {outcome}
                          </span>
                          <span className="text-gray-500">Supply: {supply}</span>
                        </div>

                        <div className={`text-3xl md:text-4xl font-bold tabular-nums ${isYes ? "text-pump-green" : "text-[#ff5c73]"}`}>
                          {pct}%
                        </div>

                        {isMobile && !marketClosed && (
                          <div className="mt-2 text-xs text-gray-500">Tap to trade</div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {names.map((outcome, index) => (
                    <button
                      key={index}
                      onClick={() => openMobileTrade(index)}
                      disabled={!isMobile || marketClosed}
                      className={`text-left rounded-xl p-4 border border-pump-border bg-pump-dark/60 transition ${
                        isMobile && !marketClosed ? "active:scale-[0.99]" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-white truncate">{outcome}</div>
                        <div className="text-pump-green font-bold">{(percentages[index] ?? 0).toFixed(1)}%</div>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">Supply: {supplies[index] || 0}</div>
                      {isMobile && !marketClosed && <div className="mt-2 text-xs text-gray-500">Tap to trade</div>}
                    </button>
                  ))}
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-700 mt-6">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Volume</div>
                  <div className="text-lg font-semibold text-white">{lamportsToSol(market.totalVolume).toFixed(2)} SOL</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Outcomes</div>
                  <div className="text-lg font-semibold text-white">{names.length}</div>
                </div>
              </div>
            </div>

            {/* Odds history */}
            <div className="card-pump">
            <div className="mb-4">
  <h2 className="text-xl font-bold text-white">Odds history</h2>
</div>

{filteredOddsPoints.length ? (
  <>
    <OddsHistoryChart points={filteredOddsPoints} outcomeNames={names} />

    {/* Range buttons UNDER the chart */}
    <div className="mt-4 flex items-center justify-center gap-2">
      {(["24h", "7d", "30d", "all"] as OddsRange[]).map((r) => (
        <button
          key={r}
          onClick={() => setOddsRange(r)}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
            oddsRange === r
              ? "bg-pump-green text-black"
              : "bg-pump-dark/60 text-gray-300 hover:bg-pump-dark"
          }`}
        >
          {r.toUpperCase()}
        </button>
      ))}
    </div>
  </>
) : (
  <div className="text-sm text-gray-400 bg-pump-dark/40 border border-gray-800 rounded-xl p-4">
    No history yet (need transactions for this market).
  </div>
)}
            </div>
          </div>

          {/* RIGHT (desktop only TradingPanel) */}
          <div className="lg:col-span-1 space-y-4">
            {!isMobile && (
              <TradingPanel
                mode="desktop"
                market={{
                  resolved: market.resolved,
                  marketType: market.marketType,
                  outcomeNames: names,
                  outcomeSupplies: supplies,
                  yesSupply: names.length >= 2 ? supplies[0] || 0 : market.yesSupply || 0,
                  noSupply: names.length >= 2 ? supplies[1] || 0 : market.noSupply || 0,
                }}
                connected={connected}
                submitting={submitting}
                onTrade={(s, outcomeIndex, side, costSol) => void handleTrade(s, outcomeIndex, side, costSol)}
                marketBalanceLamports={marketBalanceLamports}
                userHoldings={userSharesForUi}
                marketClosed={marketClosed}
              />
            )}

            <ResolutionPanel
              marketAddress={market.publicKey}
              resolutionStatus={market.resolutionStatus ?? "open"}
              proposedOutcomeLabel={proposedLabel}
              proposedAt={market.proposedAt}
              contestDeadline={market.contestDeadline}
              contestCount={market.contestCount ?? 0}
              proposedProofUrl={market.proposedProofUrl}
              proposedProofImage={market.proposedProofImage}
              proposedProofNote={market.proposedProofNote}
              resolved={!!market.resolved}
              winningOutcomeLabel={winningLabel}
              resolvedAt={market.resolvedAt}
              resolutionProofUrl={market.resolutionProofUrl}
              resolutionProofImage={market.resolutionProofImage}
              resolutionProofNote={market.resolutionProofNote}
              ended={ended}
              creatorResolveDeadline={market.creatorResolveDeadline ?? null}
            />
          </div>
        </div>

        {/* Discussion / Activity */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setBottomTab("discussion")}
              className={`px-4 py-2 rounded-lg border text-sm font-semibold transition ${
                bottomTab === "discussion"
                  ? "bg-pump-green/15 border-pump-green text-pump-green"
                  : "bg-pump-dark/40 border-gray-800 text-gray-300 hover:border-gray-600"
              }`}
            >
              Discussion
            </button>

            <button
              onClick={() => setBottomTab("activity")}
              className={`px-4 py-2 rounded-lg border text-sm font-semibold transition ${
                bottomTab === "activity"
                  ? "bg-pump-green/15 border-pump-green text-pump-green"
                  : "bg-pump-dark/40 border-gray-800 text-gray-300 hover:border-gray-600"
              }`}
            >
              Activity
            </button>
          </div>

          {bottomTab === "discussion" ? (
            <CommentsSection marketId={market.publicKey} />
          ) : (
            <MarketActivityTab marketDbId={market.dbId} marketAddress={market.publicKey} outcomeNames={names} />
          )}
        </div>
      </div>

      {/* Mobile drawer */}
      {isMobile && mobileTradeOpen && !marketClosed && (
        <div className="fixed inset-0 z-50">
          <button
            className="absolute inset-0 bg-black/70"
            onClick={() => setMobileTradeOpen(false)}
            aria-label="Close overlay"
          />

          {/* Drawer: never under top navbar + safe bottom space */}
          <div
            className="
              absolute left-0 right-0 bottom-0
              top-[72px]
              rounded-t-3xl border border-gray-800 bg-black shadow-2xl
              overflow-hidden
            "
          >
            {/* Scroll area so CTA can stay visible if TradingPanel uses sticky footer */}
            <div className="h-full overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+96px)]">
              <TradingPanel
                mode="drawer"
                title="Trade"
                defaultSide={mobileDefaultSide}
                defaultOutcomeIndex={mobileOutcomeIndex}
                onClose={() => setMobileTradeOpen(false)}
                market={{
                  resolved: market.resolved,
                  marketType: market.marketType,
                  outcomeNames: names,
                  outcomeSupplies: supplies,
                  yesSupply: names.length >= 2 ? supplies[0] || 0 : market.yesSupply || 0,
                  noSupply: names.length >= 2 ? supplies[1] || 0 : market.noSupply || 0,
                }}
                connected={connected}
                submitting={submitting}
                onTrade={(s, outcomeIndex, side, costSol) =>
                  void handleTrade(s, outcomeIndex, side, costSol)
                }
                marketBalanceLamports={marketBalanceLamports}
                userHoldings={userSharesForUi}
                marketClosed={marketClosed}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}