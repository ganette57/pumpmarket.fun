// app/src/app/trade/[id]/page.tsx
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
import BondingCurveChart from "@/components/BondingCurveChart";
import OddsHistoryChart from "@/components/OddsHistoryChart";
import MarketActivityTab from "@/components/MarketActivity";

import { supabase } from "@/lib/supabaseClient";
import { buildOddsSeries, downsample } from "@/lib/marketHistory";

import {
  getMarketByAddress,
  recordTransaction,
  applyTradeToMarketInSupabase,
} from "@/lib/markets";

import {
  lamportsToSol,
  solToLamports,
  getUserPositionPDA,
  PLATFORM_WALLET,
  calculateBuyCost,
} from "@/utils/solana";

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
  resolved: boolean;

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

export default function TradePage() {
  const params = useParams();
  const id = safeParamId((params as any)?.id);

  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();

  const [market, setMarket] = useState<UiMarket | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [bondingOutcomeIndex, setBondingOutcomeIndex] = useState(0);

  const [positionShares, setPositionShares] = useState<number[] | null>(null);
  const [marketBalanceLamports, setMarketBalanceLamports] = useState<number | null>(null);

  const [oddsRange, setOddsRange] = useState<OddsRange>("24h");
  const [oddsPoints, setOddsPoints] = useState<{ t: number; pct: number[] }[]>([]);

  const [bottomTab, setBottomTab] = useState<BottomTab>("discussion");

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

      const mt = (typeof supabaseMarket.market_type === "number"
        ? supabaseMarket.market_type
        : 0) as 0 | 1;

      const names = toStringArray(supabaseMarket.outcome_names);
      const supplies = toNumberArray(supabaseMarket.outcome_supplies);

      const transformed: UiMarket = {
        dbId: supabaseMarket.id,
        publicKey: supabaseMarket.market_address,
        question: supabaseMarket.question || "",
        description: supabaseMarket.description || "",
        category: supabaseMarket.category || "other",
        imageUrl: supabaseMarket.image_url || undefined,
        creator: String(supabaseMarket.creator || ""),

        totalVolume: Number(supabaseMarket.total_volume) || 0,
        resolutionTime: Math.floor(new Date(supabaseMarket.end_date).getTime() / 1000),
        resolved: !!supabaseMarket.resolved,

        socialLinks: supabaseMarket.social_links || undefined,

        marketType: mt,
        outcomeNames: names?.slice(0, 10),
        outcomeSupplies: supplies?.slice(0, 10),

        yesSupply: Number(supabaseMarket.yes_supply) || 0,
        noSupply: Number(supabaseMarket.no_supply) || 0,
      };

      setMarket(transformed);
      setBondingOutcomeIndex(0);
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

    let supplies = Array.isArray(market.outcomeSupplies)
      ? market.outcomeSupplies.map((x) => Number(x || 0))
      : [];

    if (supplies.length !== safeNames.length) {
      if (safeNames.length === 2) {
        supplies = [Number(market.yesSupply || 0), Number(market.noSupply || 0)];
      } else {
        supplies = Array(safeNames.length).fill(0);
      }
    }

    const safeSupplies = supplies.slice(0, safeNames.length);
    const totalSupply = safeSupplies.reduce((sum, s) => sum + (Number(s) || 0), 0);

    const percentages = safeSupplies.map((s) =>
      totalSupply > 0 ? ((Number(s) || 0) / totalSupply) * 100 : 100 / safeSupplies.length
    );

    return {
      marketType,
      names: safeNames,
      supplies: safeSupplies,
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
        const sharesArr = Array.isArray(acc?.shares)
          ? acc.shares.map((x: any) => Number(x) || 0)
          : [];

        setPositionShares(sharesArr);
      } catch {
        setPositionShares(null);
      }
    })();
  }, [id, publicKey, connected, program]);

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
          .select("created_at,is_buy,amount,outcome_index,is_yes")
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

  function estimateCostSol(currentSupply: number, shares: number, side: "buy" | "sell") {
    const s = Math.max(0, Math.floor(currentSupply || 0));
    const q = Math.max(1, Math.floor(shares || 0));

    if (side === "buy") return calculateBuyCost(s, q);

    const start = Math.max(0, s - q);
    return calculateBuyCost(start, q);
  }

  async function handleTrade(shares: number, outcomeIndex: number, side: "buy" | "sell") {
    if (!connected || !publicKey || !program) {
      if (!publicKey) alert("Please connect your wallet");
      if (!program) alert("Program not loaded");
      return;
    }
    if (!market || !id || !derived) return;

    const safeShares = Math.max(1, Math.floor(shares));
    const safeOutcome = clampInt(outcomeIndex, 0, derived.names.length - 1);

    setSubmitting(true);

    // Optimistic update pour l'UI
    setMarket((prev) => {
      if (!prev) return prev;

      const nextSupplies = Array.isArray(prev.outcomeSupplies)
        ? prev.outcomeSupplies.slice()
        : Array(derived.names.length).fill(0);

      while (nextSupplies.length < derived.names.length) nextSupplies.push(0);

      const delta = side === "buy" ? safeShares : -safeShares;
      nextSupplies[safeOutcome] = Math.max(0, Number(nextSupplies[safeOutcome] || 0) + delta);

      const yesSupply = derived.names.length === 2 ? nextSupplies[0] : prev.yesSupply || 0;
      const noSupply = derived.names.length === 2 ? nextSupplies[1] : prev.noSupply || 0;

      const estSolTmp = estimateCostSol(nextSupplies[safeOutcome], safeShares, side);
      const volLamports = solToLamports(Math.abs(estSolTmp));

      return {
        ...prev,
        outcomeSupplies: nextSupplies.slice(0, 10),
        yesSupply,
        noSupply,
        totalVolume: Number(prev.totalVolume || 0) + Number(volLamports || 0),
      };
    });

    try {
      const marketPubkey = new PublicKey(id);
      const [positionPDA] = getUserPositionPDA(marketPubkey, publicKey);
      const creatorPubkey = new PublicKey(market.creator);

      const amountBN = new BN(safeShares);

      let txSig: string;

      if (side === "buy") {
        txSig = await (program as any).methods
          .buyShares(amountBN, safeOutcome)
          .accounts({
            market: marketPubkey,
            userPosition: positionPDA,
            buyer: publicKey,
            creator: creatorPubkey,
            platformWallet: PLATFORM_WALLET,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } else {
        txSig = await (program as any).methods
          .sellShares(amountBN, safeOutcome)
          .accounts({
            market: marketPubkey,
            userPosition: positionPDA,
            seller: publicKey,
            creator: creatorPubkey,
            platformWallet: PLATFORM_WALLET,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      const name = derived.names[safeOutcome] ?? `Outcome #${safeOutcome + 1}`;
      const estSol = estimateCostSol(derived.supplies[safeOutcome] || 0, safeShares, side);
      const estLamports = solToLamports(Math.abs(estSol));

      alert(
        `Success! 🎉\n\n${
          side === "buy" ? "Bought" : "Sold"
        } ${safeShares} shares of "${name}"\n\nTx: ${txSig.slice(
          0,
          16
        )}...\n\nhttps://explorer.solana.com/tx/${txSig}?cluster=devnet`
      );

      if (market.dbId) {
        const outcomeName = derived.names[safeOutcome] ?? `Outcome #${safeOutcome}`;
      
        await recordTransaction({
          market_id: market.dbId,
          market_address: market.publicKey,      // pratique pour le dashboard
          user_address: publicKey.toBase58(),
          tx_signature: txSig,
          is_buy: side === "buy",
      
          // 🟢 pour multi-choice, on laisse is_yes null
          is_yes: derived.names.length === 2 ? safeOutcome === 0 : null,
      
          amount: safeShares,
          shares: safeShares,                    // nouveau
          cost: Number(estSol || 0),
      
          outcome_index: safeOutcome,           // 🟢 clé pour bien mapper
          outcome_name: outcomeName,            // 🟢 évite tout fallback
        } as any);
      }

      await applyTradeToMarketInSupabase({
        market_address: market.publicKey,
        market_type: market.marketType,
        outcome_index: safeOutcome,
        delta_shares: side === "buy" ? safeShares : -safeShares,
        delta_volume_lamports: Number(estLamports || 0),
      });

      await loadMarket(id);

      await applyTradeToMarketInSupabase({
        market_address: market.publicKey,
        market_type: market.marketType,
        outcome_index: safeOutcome,
        delta_shares: side === "buy" ? safeShares : -safeShares,
        delta_volume_lamports: Number(estLamports || 0),
      });

      await loadMarket(id);
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* LEFT */}
        <div className="lg:col-span-2 space-y-6">
          {/* Market card */}
          <div className="card-pump">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-pump-dark">
                {market.imageUrl ? (
                  <Image
                    src={market.imageUrl}
                    alt={market.question}
                    width={80}
                    height={80}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  <CategoryImagePlaceholder
                    category={market.category || "crypto"}
                    className="w-full h-full scale-[0.4]"
                  />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between mb-3 gap-3">
                  <h1 className="text-3xl font-bold text-white flex-1 leading-tight">
                    {market.question}
                  </h1>
                  <MarketActions marketId={market.publicKey} question={market.question} />
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
              <div>
                {new Date(market.resolutionTime * 1000).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
              <div className="ml-auto text-xs text-gray-500">
                {marketType === 1 ? "Multi-choice" : "Binary"}
              </div>
            </div>

            <p className="text-gray-400 mt-4 mb-4">{market.description}</p>

            {missingOutcomes && (
              <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
                Outcomes are still indexing… (Supabase/outcomes not ready yet)
              </div>
            )}

            {/* Outcomes */}
            {isBinaryStyle ? (
              <div className="grid grid-cols-2 gap-4">
                {names.slice(0, 2).map((outcome, index) => (
                  <div
                    key={index}
                    className={`rounded-lg p-4 border ${
                      index === 0
                        ? "bg-blue-500/10 border-blue-500/30"
                        : "bg-red-500/10 border-red-500/30"
                    }`}
                  >
                    <div
                      className={`text-sm mb-1 uppercase ${
                        index === 0 ? "text-blue-400" : "text-red-400"
                      }`}
                    >
                      {outcome}
                    </div>
                    <div
                      className={`text-3xl font-bold ${
                        index === 0 ? "text-blue-400" : "text-red-400"
                      }`}
                    >
                      {(percentages[index] ?? 0).toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      Supply: {supplies[index] || 0}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {names.map((outcome, index) => (
                  <div key={index} className="rounded-lg p-4 border border-gray-700 bg-pump-dark/40">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-white font-semibold truncate">{outcome}</div>
                      <div className="text-pump-green font-bold">
                        {(percentages[index] ?? 0).toFixed(1)}%
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      Supply: {supplies[index] || 0}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-700 mt-6">
              <div>
                <div className="text-xs text-gray-500 mb-1">Volume</div>
                <div className="text-lg font-semibold text-white">
                  {lamportsToSol(market.totalVolume).toFixed(2)} SOL
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Outcomes</div>
                <div className="text-lg font-semibold text-white">{names.length}</div>
              </div>
            </div>
          </div>

          {/* Odds history (main chart) */}
          <div className="card-pump">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">Odds history</h2>
                <p className="text-sm text-gray-400 mt-1"></p>
              </div>

              <div className="flex items-center gap-2">
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
            </div>

            {filteredOddsPoints.length ? (
              <OddsHistoryChart points={filteredOddsPoints} outcomeNames={names} />
            ) : (
              <div className="text-sm text-gray-400 bg-pump-dark/40 border border-gray-800 rounded-xl p-4">
                No history yet (need transactions for this market).
              </div>
            )}
          </div>

        </div>

        {/* RIGHT */}
        <div className="lg:col-span-1">
          <TradingPanel
            market={{
              resolved: market.resolved,
              marketType: market.marketType,
              outcomeNames: names,
              outcomeSupplies: supplies,
              yesSupply: supplies[0] || 0,
              noSupply: supplies[1] || 0,
            }}
            connected={connected}
            submitting={submitting}
            onTrade={(s, outcomeIndex, side) => void handleTrade(s, outcomeIndex, side)}
            marketAddress={market.publicKey}
            marketBalanceLamports={marketBalanceLamports}
            userHoldings={userSharesForUi}
          />

          <div className="mt-4 text-xs text-gray-500">
            {submitting
              ? "Submitting transaction..."
              : connected
              ? `Wallet connected${
                  marketBalanceLamports != null
                    ? ` • pool ${lamportsToSol(marketBalanceLamports).toFixed(4)} SOL`
                    : ""
                }`
              : "Wallet not connected"}
          </div>

          {connected && (
            <div className="mt-2 text-[11px] text-white/30">
              holdings (on-chain): {userSharesForUi.map((x) => x).join(" / ") || "0"}
            </div>
          )}
        </div>
      </div>

      {/* Discussion / Activity tabs (bottom section) */}
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
          <MarketActivityTab
            marketDbId={market.dbId}
            marketAddress={market.publicKey}
            outcomeNames={names}
          />
        )}
      </div>
    </div>
  );
}