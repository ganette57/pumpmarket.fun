"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import FlashMarketCard from "@/components/FlashMarketCard";
import { supabase } from "@/lib/supabaseClient";
import type { FlashMarket } from "@/lib/flashMarkets/types";

interface Market {
  market_address: string;
  question: string;
  category: string;
  image_url: string | null;
  market_type?: number;
  total_volume: number;
  end_date?: string;
  resolution_status?: string;
  resolved?: boolean;
  yes_supply?: number;
  no_supply?: number;
  outcome_supplies?: number[];
}

function lamportsToSol(lamports: number): number {
  return (lamports || 0) / 1_000_000_000;
}

function marketTopPct(m: Market): number {
  const supplies =
    Array.isArray(m.outcome_supplies) && m.outcome_supplies.length
      ? m.outcome_supplies.map((x) => Number(x) || 0)
      : [Number(m.yes_supply) || 0, Number(m.no_supply) || 0];

  const total = supplies.reduce((a: number, b: number) => a + b, 0);
  if (!total) return 0;

  const top = Math.max(...supplies);
  return Math.round((top / total) * 100);
}

type StatusFilter = "open" | "resolved";

export default function ExplorerPage() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";

  const [searchResults, setSearchResults] = useState<Market[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [flashMarkets, setFlashMarkets] = useState<FlashMarket[]>([]);
  const [flashLoading, setFlashLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");

  const fetchFlashMarkets = useCallback(async (filter: StatusFilter) => {
    setFlashLoading(true);
    try {
      const res = await fetch(
        `/api/explorer/flash-markets?limit=20&status=${filter}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`Flash markets fetch failed (${res.status})`);
      const json = await res.json();
      setFlashMarkets((json?.markets as FlashMarket[]) || []);
    } catch (error) {
      console.warn("Flash markets fetch failed:", error);
      setFlashMarkets([]);
    } finally {
      setFlashLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFlashMarkets(statusFilter);
  }, [statusFilter, fetchFlashMarkets]);

  useEffect(() => {
    if (!q) {
      setSearchResults([]);
      return;
    }
    void performSearch(q);
  }, [q]);

  async function performSearch(searchQuery: string) {
    setSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from("markets")
        .select(
          "market_address,question,category,image_url,market_type,total_volume,end_date,resolution_status,yes_supply,no_supply,outcome_supplies",
        )
        .or(`question.ilike.%${searchQuery}%,category.ilike.%${searchQuery}%,creator.ilike.%${searchQuery}%`)
        .order("total_volume", { ascending: false })
        .limit(30);

      if (error) throw error;
      setSearchResults((data as Market[]) || []);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  const isSearchMode = q.length > 0;

  return (
    <div className="min-h-screen bg-black pb-20">
      <div className="max-w-7xl mx-auto px-4 py-4 space-y-8">
        {isSearchMode && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-lg font-semibold text-white">
                Results for &quot;<span className="text-[#61ff9a]">{q}</span>&quot;
              </h1>
              <span className="text-sm text-gray-500">{searchResults.length} markets</span>
            </div>

            {searchLoading ? (
              <LoadingSpinner />
            ) : searchResults.length === 0 ? (
              <EmptyState message="No markets found" subtitle="Try different keywords" />
            ) : (
              <div className="space-y-2">
                {searchResults.map((market) => (
                  <MarketRow key={market.market_address} market={market} />
                ))}
              </div>
            )}
          </section>
        )}

        <section>
          <div className="flex items-end justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl md:text-2xl font-bold text-white">Flash Markets — Sports</h2>
              <p className="text-sm text-gray-400">Live quick markets, updated for instant decisions.</p>
            </div>
          </div>

          {/* ── Filter pills ── */}
          <div className="flex items-center gap-2 mb-4">
            <FilterPill
              label="Open"
              active={statusFilter === "open"}
              onClick={() => setStatusFilter("open")}
            />
            <FilterPill
              label="Resolved"
              active={statusFilter === "resolved"}
              onClick={() => setStatusFilter("resolved")}
            />
          </div>

          {flashLoading ? (
            <LoadingSpinner />
          ) : flashMarkets.length === 0 ? (
            <EmptyState
              message={
                statusFilter === "resolved"
                  ? "No resolved flash markets yet"
                  : "No live flash market right now"
              }
              subtitle={
                statusFilter === "resolved"
                  ? "Resolved markets will appear here."
                  : "Come back in a few minutes."
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {flashMarkets.map((market) => (
                <FlashMarketCard key={market.liveMicroId} market={market} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-800 bg-[#0a0a0a] p-5">
          <h2 className="text-xl md:text-2xl font-bold text-white">Flash Markets — Crypto</h2>
          <p className="text-sm text-gray-400 mt-1">Coming soon</p>
        </section>
      </div>
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
        active
          ? "bg-[#61ff9a] text-black"
          : "bg-white/8 text-gray-400 hover:bg-white/12 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function MarketRow({ market }: { market: Market }) {
  const pct = marketTopPct(market);
  const vol = lamportsToSol(Number(market.total_volume) || 0).toFixed(2);

  return (
    <Link
      href={`/trade/${market.market_address}`}
      className="flex items-center gap-3 rounded-xl border border-gray-800 bg-[#0a0a0a] p-3 hover:border-[#61ff9a]/60 transition"
    >
      <div className="h-10 w-10 rounded-lg overflow-hidden bg-black shrink-0 flex items-center justify-center">
        {market.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={market.image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="text-gray-600 text-lg">?</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white truncate">{market.question}</div>
        <div className="text-xs text-gray-500 truncate">
          {(market.category || "other").toString()} • {vol} SOL
        </div>
      </div>

      <div className="text-sm font-bold text-[#61ff9a] tabular-nums">{pct}%</div>
    </Link>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-2 border-[#61ff9a] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ message, subtitle }: { message: string; subtitle: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-gray-400 font-medium">{message}</p>
      <p className="text-gray-600 text-sm mt-1">{subtitle}</p>
    </div>
  );
}
