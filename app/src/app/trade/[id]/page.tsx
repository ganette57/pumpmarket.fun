// src/app/trade/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import Image from "next/image";

import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

import { useProgram } from "@/hooks/useProgram";
import CategoryImagePlaceholder from "@/components/CategoryImagePlaceholder";
import MarketActions from "@/components/MarketActions";
import CreatorSocialLinks from "@/components/CreatorSocialLinks";
import CommentsSection from "@/components/CommentsSection";
import TradingPanel from "@/components/TradingPanel";
import BondingCurveChart from "@/components/BondingCurveChart";

import { getMarketByAddress } from "@/lib/markets";
import { lamportsToSol, getUserPositionPDA, PLATFORM_WALLET } from "@/utils/solana";

import type { SocialLinks } from "@/components/SocialLinksForm";

type SupabaseMarket = any;

type UiMarket = {
  publicKey: string;
  question: string;
  description: string;
  category?: string;
  imageUrl?: string;
  creator: string;

  totalVolume: number;
  resolutionTime: number; // unix seconds
  resolved: boolean;

  socialLinks?: SocialLinks;

  // multi-choice support
  marketType: 0 | 1;
  outcomeNames?: string[];
  outcomeSupplies?: number[];

  // legacy binary (fallback)
  yesSupply?: number;
  noSupply?: number;
};

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

function safeParamId(p: unknown): string | null {
  if (!p) return null;
  if (typeof p === "string") return p;
  if (Array.isArray(p) && typeof p[0] === "string") return p[0];
  return null;
}

export default function TradePage() {
  const params = useParams();
  const id = safeParamId((params as any)?.id);

  const { publicKey, connected } = useWallet();
  const program = useProgram();

  const [market, setMarket] = useState<UiMarket | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);

  // multi chart selector
  const [chartOutcomeIndex, setChartOutcomeIndex] = useState(0);

  // outcomes loading (on-chain fallback)
  const [outcomesLoading, setOutcomesLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    void loadMarket(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // If Supabase missing outcomes, fetch on-chain (non-blocking but we show "Loading outcomes")
  useEffect(() => {
    if (!program || !id || !market) return;

    const needsOutcomes =
      !market.outcomeNames?.length ||
      !market.outcomeSupplies?.length ||
      market.outcomeNames.length !== market.outcomeSupplies.length;

    if (!needsOutcomes) return;

    let cancelled = false;

    (async () => {
      try {
        setOutcomesLoading(true);

        const marketPk = new PublicKey(id);

        const fetcher =
          (program as any)?.account?.market?.fetch ||
          (program as any)?.account?.Market?.fetch ||
          null;

        if (typeof fetcher !== "function") return;

        const acct: any = await fetcher(marketPk);

        const onchainNames =
          toStringArray(acct?.outcomeNames) ||
          toStringArray(acct?.outcome_names) ||
          undefined;

        const onchainSupplies =
          toNumberArray(acct?.outcomeSupplies) ||
          toNumberArray(acct?.outcome_supplies) ||
          undefined;

        const onchainTypeRaw =
          typeof acct?.marketType === "number"
            ? acct.marketType
            : typeof acct?.market_type === "number"
            ? acct.market_type
            : market.marketType;

        const onchainType = (Number(onchainTypeRaw) === 1 ? 1 : 0) as 0 | 1;

        if (cancelled) return;

        setMarket((prev) => {
          if (!prev) return prev;

          return {
            ...prev,
            marketType: onchainType,
            outcomeNames: onchainNames?.slice(0, 10) || prev.outcomeNames,
            outcomeSupplies: onchainSupplies?.slice(0, 10) || prev.outcomeSupplies,
          };
        });
      } catch {
        // silent (we'll fall back in derived)
      } finally {
        if (!cancelled) setOutcomesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program, id, market?.publicKey]);

  async function loadMarket(marketAddress: string) {
    setLoading(true);
    try {
      const supabaseMarket: SupabaseMarket = await getMarketByAddress(marketAddress);

      if (!supabaseMarket) {
        setMarket(null);
        return;
      }

      const mt = (typeof supabaseMarket.market_type === "number" ? supabaseMarket.market_type : 0) as 0 | 1;

      const names = toStringArray(supabaseMarket.outcome_names);
      const supplies = toNumberArray(supabaseMarket.outcome_supplies);

      const transformed: UiMarket = {
        publicKey: supabaseMarket.market_address,
        question: supabaseMarket.question || "",
        description: supabaseMarket.description || "",
        category: supabaseMarket.category || "other",
        imageUrl: supabaseMarket.image_url || undefined,
        creator: supabaseMarket.creator || "",

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
      setChartOutcomeIndex(0);
    } catch (err) {
      console.error("Error loading market:", err);
      setMarket(null);
    } finally {
      setLoading(false);
    }
  }

  const derived = useMemo(() => {
    if (!market) return null;

    const marketType = market.marketType ?? 0;

    // names
    let names: string[] | undefined = market.outcomeNames?.filter(Boolean);

    // ✅ IMPORTANT: never fake YES/NO for multi
    if (marketType === 1) {
      if (!names?.length || names.length < 2) {
        return {
          waitingOutcomes: true,
          marketType,
          names: [] as string[],
          supplies: [] as number[],
          percentages: [] as number[],
          totalSupply: 0,
          isBinary: false,
        };
      }
    } else {
      // binary fallback
      if (!names?.length) names = ["YES", "NO"];
      if (names.length !== 2) names = ["YES", "NO"];
    }

    const safeNames = names.slice(0, 10);

    // supplies
    let supplies = market.outcomeSupplies && market.outcomeSupplies.length ? market.outcomeSupplies : undefined;

    if (!supplies || supplies.length !== safeNames.length) {
      if (marketType === 0 && safeNames.length === 2) {
        supplies = [market.yesSupply || 0, market.noSupply || 0];
      } else if (marketType === 1) {
        // multi but missing supplies -> show waiting
        return {
          waitingOutcomes: true,
          marketType,
          names: safeNames,
          supplies: Array(safeNames.length).fill(0),
          percentages: Array(safeNames.length).fill(0),
          totalSupply: 0,
          isBinary: false,
        };
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
      waitingOutcomes: outcomesLoading && marketType === 1 && (!market.outcomeNames?.length || !market.outcomeSupplies?.length),
      marketType,
      names: safeNames,
      supplies: safeSupplies,
      percentages,
      totalSupply,
      isBinary: marketType === 0 && safeNames.length === 2,
    };
  }, [market, outcomesLoading]);

  async function handleTrade(shares: number, outcomeIndex: number) {
    if (!connected || !publicKey || !program) {
      if (!publicKey) alert("Please connect your wallet");
      if (!program) alert("Program not loaded");
      return;
    }
    if (!market || !id) return;

    setBuying(true);
    try {
      const marketPubkey = new PublicKey(id);
      const [positionPDA] = getUserPositionPDA(marketPubkey, publicKey);
      const creatorPubkey = new PublicKey(market.creator);

      const amountBN = new BN(Math.max(1, Math.floor(shares)));

      const tx = await (program as any).methods
        .buyShares(amountBN, outcomeIndex) // u8 outcomeIndex
        .accounts({
          market: marketPubkey,
          userPosition: positionPDA,
          buyer: publicKey,
          creator: creatorPubkey,
          platformWallet: PLATFORM_WALLET,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      alert(
        `Success! 🎉\n\nBought ${amountBN.toString()} shares of "${derived?.names[outcomeIndex] ?? outcomeIndex
        }"\n\nTx: ${tx.slice(0, 16)}...\n\nhttps://explorer.solana.com/tx/${tx}?cluster=devnet`
      );

      // refresh on-chain supplies fast
      try {
        const fetcher =
          (program as any)?.account?.market?.fetch ||
          (program as any)?.account?.Market?.fetch ||
          null;

        if (typeof fetcher === "function") {
          const acct: any = await fetcher(marketPubkey);

          const onchainSupplies =
            toNumberArray(acct?.outcomeSupplies) || toNumberArray(acct?.outcome_supplies);

          const onchainNames =
            toStringArray(acct?.outcomeNames) || toStringArray(acct?.outcome_names);

          const onchainTypeRaw =
            typeof acct?.marketType === "number"
              ? acct.marketType
              : typeof acct?.market_type === "number"
              ? acct.market_type
              : market.marketType;

          const onchainType = (Number(onchainTypeRaw) === 1 ? 1 : 0) as 0 | 1;

          setMarket((prev) =>
            prev
              ? {
                  ...prev,
                  marketType: onchainType,
                  outcomeNames: onchainNames?.slice(0, 10) || prev.outcomeNames,
                  outcomeSupplies: onchainSupplies?.slice(0, 10) || prev.outcomeSupplies,
                }
              : prev
          );
        } else {
          await loadMarket(id);
        }
      } catch {
        await loadMarket(id);
      }
    } catch (error: any) {
      console.error("Buy shares error:", error);
      alert(`Error: ${error?.message || "Failed to buy shares"}`);
    } finally {
      setBuying(false);
    }
  }

  // ---------------- UI guards ----------------

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

  if (!market) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-xl">Market not found</p>
      </div>
    );
  }

  // ✅ prevents: Cannot read properties of null (reading 'waitingOutcomes')
  if (!derived) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (derived.waitingOutcomes) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">Loading outcomes (on-chain)…</p>
      </div>
    );
  }

  const { marketType, names, supplies, percentages, isBinary } = derived;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left */}
        <div className="lg:col-span-2">
          <div className="card-pump mb-6">
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

            <p className="text-gray-400 mt-4 mb-6">{market.description}</p>

            {/* Outcomes */}
            {names.length <= 2 ? (
              <div className="grid grid-cols-2 gap-4">
                {names.map((outcome, index) => (
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
                      {percentages[index]?.toFixed(1)}%
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
                      <div className="text-pump-green font-bold">{percentages[index]?.toFixed(1)}%</div>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">Supply: {supplies[index] || 0}</div>
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

          {/* Bonding curve */}
          <div className="card-pump">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">Bonding Curve</h2>
                <p className="text-sm text-gray-400 mt-1">
                  Price increases as more shares are bought. Early buyers get better prices!
                </p>
              </div>

              {!isBinary && (
                <div className="min-w-[180px]">
                  <label className="block text-xs text-gray-500 mb-1">Chart outcome</label>
                  <select
                    value={chartOutcomeIndex}
                    onChange={(e) => setChartOutcomeIndex(Number(e.target.value))}
                    className="input-pump w-full"
                  >
                    {names.map((n, i) => (
                      <option key={i} value={i}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <BondingCurveChart
              currentSupply={supplies[Math.min(chartOutcomeIndex, supplies.length - 1)] || 0}
              isYes={true}
            />
          </div>
        </div>

        {/* Right */}
        <div className="lg:col-span-1">
          <TradingPanel
            market={{
              resolved: market.resolved,
              yesSupply: supplies[0] || 0,
              noSupply: supplies[1] || 0,
              marketType: market.marketType,
              outcomeNames: names,
              outcomeSupplies: supplies,
            }}
            connected={connected}
            onTrade={(shares, outcomeIndex) => void handleTrade(shares, outcomeIndex)}
          />

          <div className="mt-4 text-xs text-gray-500">
            {buying ? "Submitting transaction..." : connected ? "Wallet connected" : "Wallet not connected"}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <CommentsSection marketId={market.publicKey} />
      </div>
    </div>
  );
}