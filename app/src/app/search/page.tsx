"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

// ============ TYPES ============
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

type BrowseTab = "trending" | "popular";

// ============ HELPERS (same as trade page) ============
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

// ============ MAIN COMPONENT ============
export default function SearchPage() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") || "";

  const [browseTab, setBrowseTab] = useState<BrowseTab>("trending");
  const [browseMarkets, setBrowseMarkets] = useState<Market[]>([]);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [searchResults, setSearchResults] = useState<Market[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Load browse markets (trending/popular) - EXACT SAME LOGIC AS TRADE PAGE
  useEffect(() => {
    if (q) return;
    
    let cancelled = false;

    async function loadBrowseMarkets() {
      setBrowseLoading(true);
      try {
        const baseSelect =
          "market_address,question,category,image_url,yes_supply,no_supply,outcome_supplies,end_date,total_volume,resolved";

        let dbQuery = supabase.from("markets").select(baseSelect).limit(10);

        if (browseTab === "trending") {
          dbQuery = dbQuery.order("total_volume", { ascending: false });
        }

        if (browseTab === "popular") {
          dbQuery = dbQuery.order("end_date", { ascending: true });
        }

        const { data, error } = await dbQuery;
        if (error) throw error;

        if (!cancelled) setBrowseMarkets((data as Market[]) || []);
      } catch (e) {
        console.warn("Browse markets fetch failed:", e);
        if (!cancelled) setBrowseMarkets([]);
      } finally {
        if (!cancelled) setBrowseLoading(false);
      }
    }

    void loadBrowseMarkets();

    return () => {
      cancelled = true;
    };
  }, [browseTab, q]);

  // Load search results when q param exists
  useEffect(() => {
    if (q) {
      performSearch(q);
    } else {
      setSearchResults([]);
    }
  }, [q]);

  async function performSearch(searchQuery: string) {
    setSearchLoading(true);
    try {
      const { data, error } = await supabase
        .from("markets")
        .select("market_address,question,category,image_url,market_type,total_volume,end_date,resolution_status,yes_supply,no_supply,outcome_supplies")
        .or(`question.ilike.%${searchQuery}%,category.ilike.%${searchQuery}%,creator.ilike.%${searchQuery}%`)
        .order("total_volume", { ascending: false })
        .limit(30);

      if (error) throw error;
      setSearchResults((data as Market[]) || []);
    } catch (e) {
      console.error("Search failed:", e);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  // ============ RENDER ============
  const isSearchMode = q.length > 0;

  return (
    <div className="min-h-screen bg-black pb-20">
      <div className="max-w-3xl mx-auto px-4 py-4">
        {/* ========== SEARCH RESULTS MODE ========== */}
        {isSearchMode ? (
          <div>
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
          </div>
        ) : (
          /* ========== BROWSE MODE - Trending / Popular (same as trade page Related block) ========== */
          <div>
            {/* Tabs - EXACT SAME STYLE AS TRADE PAGE */}
            <div className="flex gap-2 mb-4">
              {(["trending", "popular"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setBrowseTab(tab)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                    browseTab === tab
                      ? "bg-[#61ff9a]/15 border-[#61ff9a] text-[#61ff9a]"
                      : "bg-[#0a0a0a] border-gray-800 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Markets List */}
            {browseLoading ? (
              <LoadingSpinner />
            ) : browseMarkets.length === 0 ? (
              <EmptyState message="No markets available" subtitle="Check back later" />
            ) : (
              <div className="space-y-2">
                {browseMarkets.map((market) => (
                  <MarketRow key={market.market_address} market={market} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ MARKET ROW (EXACT SAME AS TRADE PAGE RELATED BLOCK) ============
function MarketRow({ market }: { market: Market }) {
  const pct = marketTopPct(market);
  const vol = lamportsToSol(Number(market.total_volume) || 0).toFixed(2);

  return (
    <Link
      href={`/trade/${market.market_address}`}
      className="flex items-center gap-3 rounded-xl border border-gray-800 bg-[#0a0a0a] p-3 hover:border-[#61ff9a]/60 transition"
    >
      {/* Image - same size as trade page */}
      <div className="h-10 w-10 rounded-lg overflow-hidden bg-black shrink-0 flex items-center justify-center">
        {market.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={market.image_url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-gray-600 text-lg">?</div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white truncate">
          {market.question}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {(market.category || "other").toString()} • {vol} SOL
        </div>
      </div>

      {/* Percentage */}
      <div className="text-sm font-bold text-[#61ff9a] tabular-nums">
        {pct}%
      </div>
    </Link>
  );
}

// ============ LOADING SPINNER ============
function LoadingSpinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-2 border-[#61ff9a] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ============ EMPTY STATE ============
function EmptyState({ message, subtitle }: { message: string; subtitle: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-gray-400 font-medium">{message}</p>
      <p className="text-gray-600 text-sm mt-1">{subtitle}</p>
    </div>
  );
}