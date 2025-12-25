"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import Link from "next/link";

import MarketCard from "@/components/MarketCard";
import FeaturedMarketCardFull from "@/components/FeaturedMarketCardFull";
import CategoryFilters from "@/components/CategoryFilters";
import GeoblockModal from "@/components/GeoblockModal";
import LiveBuysTicker from "@/components/LiveBuysTicker";
import Footer from "@/components/SiteFooter";
import { SkeletonCard, SkeletonFeaturedCard } from "@/components/SkeletonCard";
import { CategoryId } from "@/utils/categories";
import { supabase } from "@/lib/supabaseClient";

type Market = {
  id?: string;
  publicKey: string;
  question: string;
  description: string;
  category: string;
  imageUrl?: string | null;

  yesSupply: number;
  noSupply: number;
  totalVolume: number;

  resolutionTime: number;
  resolved: boolean;
  marketType: 0 | 1;
  outcomeNames?: string[];
  outcomeSupplies?: number[];

  creator?: string | null;
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  } | null;
};

type MarketStatusFilter = "all" | "open" | "resolved";

function isMarketResolved(m: Market) {
  // on garde ton flag + time-based safety
  const nowSec = Date.now() / 1000;
  const endedByTime = !!m.resolutionTime && nowSec >= m.resolutionTime;
  return !!m.resolved || endedByTime;
}

function StatusFilterDropdown({
  value,
  onChange,
}: {
  value: MarketStatusFilter;
  onChange: (v: MarketStatusFilter) => void;
}) {
  const [open, setOpen] = useState(false);

  const label =
    value === "all" ? "All" : value === "open" ? "Open" : "Resolved";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/15 bg-black text-white text-sm font-semibold hover:border-white/25 transition"
      >
        <span className="text-gray-300">Status:</span>
        <span>{label}</span>
        <ChevronDown className="w-4 h-4 text-gray-300" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-44 rounded-2xl border border-white/10 bg-[#0a0d12] shadow-xl overflow-hidden z-50">
          {(["all", "open", "resolved"] as MarketStatusFilter[]).map((k) => (
            <button
              key={k}
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-3 text-sm transition ${
                value === k ? "bg-white/5 text-white" : "text-gray-200 hover:bg-white/5"
              }`}
            >
              {k === "all" ? "All" : k === "open" ? "Open" : "Resolved"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState<CategoryId | "all">(
    "all"
  );

  const [statusFilter, setStatusFilter] = useState<MarketStatusFilter>("open");

  const [currentFeaturedIndex, setCurrentFeaturedIndex] = useState(0);
  const [displayedCount, setDisplayedCount] = useState(12);

  const observerTarget = useRef<HTMLDivElement>(null);

  // ------- LOAD MARKETS FROM SUPABASE -------

  useEffect(() => {
    void loadMarkets();
  }, []);

  async function loadMarkets() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("markets")
        .select(
          `
          id,
          market_address,
          question,
          description,
          category,
          image_url,
          end_date,
          creator,
          social_links,
          yes_supply,
          no_supply,
          total_volume,
          resolved,
          market_type,
          outcome_names,
          outcome_supplies,
          created_at
        `
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) {
        console.error("Error loading markets:", error);
        setMarkets([]);
        return;
      }

      const mapped: Market[] =
        (data || []).map((row: any) => {
          const mt = (row.market_type ?? 0) as 0 | 1;

          const outcomeNames: string[] | undefined = Array.isArray(row.outcome_names)
            ? row.outcome_names.map((x: any) => String(x)).filter(Boolean)
            : undefined;

          const outcomeSupplies: number[] | undefined = Array.isArray(row.outcome_supplies)
            ? row.outcome_supplies.map((x: any) => Number(x) || 0)
            : undefined;

          let yesSupply = Number(row.yes_supply || 0);
          let noSupply = Number(row.no_supply || 0);

          if (mt === 1 && Array.isArray(outcomeSupplies) && outcomeSupplies.length >= 2) {
            yesSupply = Number(outcomeSupplies[0] || 0);
            noSupply = Number(outcomeSupplies[1] || 0);
          }

          const endDate = row.end_date ? new Date(row.end_date) : new Date();

          return {
            id: row.id,
            publicKey: row.market_address,
            question: row.question || "",
            description: row.description || "",
            category: row.category || "other",
            imageUrl: row.image_url ?? null,
            yesSupply,
            noSupply,
            totalVolume: Number(row.total_volume || 0),
            resolutionTime: Math.floor(endDate.getTime() / 1000),
            resolved: !!row.resolved,
            marketType: mt,
            outcomeNames,
            outcomeSupplies,
            creator: row.creator ?? null,
            socialLinks: row.social_links ?? null,
          } as Market;
        }) ?? [];

      setMarkets(mapped);
    } catch (err) {
      console.error("loadMarkets fatal error:", err);
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }

  // ------- FILTERS / DERIVED LISTS -------

  const categoryFiltered = useMemo(() => {
    return markets.filter((m) => {
      const categoryMatch = selectedCategory === "all" || m.category === selectedCategory;
      return categoryMatch;
    });
  }, [markets, selectedCategory]);

  const statusFiltered = useMemo(() => {
    if (statusFilter === "all") return categoryFiltered;
    if (statusFilter === "resolved") return categoryFiltered.filter((m) => isMarketResolved(m));
    return categoryFiltered.filter((m) => !isMarketResolved(m)); // open
  }, [categoryFiltered, statusFilter]);

  // ------- CAROUSEL (AUTO OPEN ONLY) -------

  const featuredMarkets = useMemo(() => {
    const openOnly = categoryFiltered.filter((m) => !isMarketResolved(m));
    const base = openOnly.length ? openOnly : categoryFiltered;

    const binaryLike = base.filter((m) => {
      const isBinary =
        (m.marketType ?? 0) === 0 ||
        (Array.isArray(m.outcomeNames) && m.outcomeNames.length === 2);
      return isBinary;
    });

    const featuredBase = binaryLike.length ? binaryLike : base;

    return [...featuredBase]
      .sort((a, b) => Number(b.totalVolume || 0) - Number(a.totalVolume || 0))
      .slice(0, 3)
      .map((market) => {
        const totalSupply = Number(market.yesSupply || 0) + Number(market.noSupply || 0);
        const yesPercent = totalSupply > 0 ? Math.round((market.yesSupply / totalSupply) * 100) : 50;
        const noPercent = 100 - yesPercent;

        const now = Date.now() / 1000;
        const timeLeft = market.resolutionTime - now;
        const daysLeft = Math.max(0, Math.floor(timeLeft / 86400));

        return {
          id: market.publicKey,
          question: market.question,
          category: market.category,
          imageUrl: market.imageUrl ?? undefined,
          yesPercent,
          noPercent,
          volume: market.totalVolume,
          daysLeft,
          creator: market.creator ?? undefined,
          socialLinks: market.socialLinks ?? undefined,
          yesSupply: market.yesSupply,
          noSupply: market.noSupply,
          outcomeNames: market.outcomeNames,
          outcomeSupplies: market.outcomeSupplies,
          resolved: false,
        };
      });
  }, [categoryFiltered]);

  // reset carousel index if list changes
  useEffect(() => {
    setCurrentFeaturedIndex(0);
  }, [featuredMarkets.length]);

  // ------- LIST FOR GRID -------

  const displayedMarkets = useMemo(() => {
    return statusFiltered.slice(0, displayedCount);
  }, [statusFiltered, displayedCount]);

  // ------- INFINITE SCROLL -------

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && statusFiltered.length > displayedCount) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) observer.observe(currentTarget);

    return () => {
      if (currentTarget) observer.unobserve(currentTarget);
    };
  }, [displayedCount, loading, statusFiltered.length]);

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    setLoadingMore(true);
    setTimeout(() => {
      setDisplayedCount((prev) => prev + 12);
      setLoadingMore(false);
    }, 400);
  }, [loadingMore]);

  // when filters change, reset paging
  useEffect(() => {
    setDisplayedCount(12);
  }, [selectedCategory, statusFilter]);

  // ------- AUTOPLAY CAROUSEL -------

  useEffect(() => {
    if (!featuredMarkets.length) return;

    const id = setInterval(() => {
      setCurrentFeaturedIndex((prev) => (prev === featuredMarkets.length - 1 ? 0 : prev + 1));
    }, 8000);

    return () => clearInterval(id);
  }, [featuredMarkets.length]);

  const handlePrevFeatured = () => {
    setCurrentFeaturedIndex((prev) => (prev === 0 ? featuredMarkets.length - 1 : prev - 1));
  };

  const handleNextFeatured = () => {
    setCurrentFeaturedIndex((prev) => (prev === featuredMarkets.length - 1 ? 0 : prev + 1));
  };

  // ------- RENDER -------

  return (
    <>
      <GeoblockModal />

      {/* Category Filters - sticky */}
      <div className="border-b border-gray-800 bg-pump-dark/50 sticky top-16 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <CategoryFilters selectedCategory={selectedCategory} onSelectCategory={setSelectedCategory} />
        </div>
      </div>

      {/* Featured Carousel */}
      <div className="py-6 bg-gradient-to-b from-pump-dark to-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <h2 className="text-2xl md:text-3xl font-bold text-white">Top markets</h2>
              <p className="text-gray-400 text-sm hidden md:block">
                Trending predictions with high volume
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handlePrevFeatured}
                disabled={!featuredMarkets.length}
                className="p-2 bg-black/70 hover:bg-black border border-white/20 hover:border-white/40 rounded-lg transition disabled:opacity-40"
                aria-label="Previous featured market"
              >
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={handleNextFeatured}
                disabled={!featuredMarkets.length}
                className="p-2 bg-black/70 hover:bg-black border border-white/20 hover:border-white/40 rounded-lg transition disabled:opacity-40"
                aria-label="Next featured market"
              >
                <ChevronRight className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          <div className="relative">
            {loading ? (
              <SkeletonFeaturedCard />
            ) : featuredMarkets.length > 0 ? (
              <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-black">
                <div
                  className="flex transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${currentFeaturedIndex * 100}%)` }}
                >
                  {featuredMarkets.map((market) => (
                    <div key={market.id} className="w-full flex-shrink-0">
                      <FeaturedMarketCardFull market={market} />
                    </div>
                  ))}
                </div>

                <div className="flex justify-center gap-2 mt-4 pb-4">
                  {featuredMarkets.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentFeaturedIndex(index)}
                      className={`h-2 rounded-full transition-all duration-300 ${
                        index === currentFeaturedIndex ? "w-8 bg-white" : "w-2 bg-white/30"
                      }`}
                      aria-label={`Go to featured market ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-20 text-gray-400">
                <p>No featured markets available</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Markets Grid */}
      <div className="py-8 pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-6 gap-3">
            <div>
              <h3 className="text-xl font-bold text-white">All Markets</h3>
              <p className="text-sm text-gray-500">{statusFiltered.length} markets</p>
            </div>

            {/* ✅ dropdown status like your screen */}
            <StatusFilterDropdown value={statusFilter} onChange={setStatusFilter} />
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : displayedMarkets.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-6xl mb-4">🤷</div>
              <p className="text-gray-400 text-xl mb-4">No markets found</p>
              <Link href="/create">
                <button className="btn-pump">Create the first one!</button>
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">
                {displayedMarkets.map((market, index) => {
                  const ended = isMarketResolved(market);

                  return (
                    <motion.div
                      key={market.publicKey}
                      initial={{ opacity: 0, y: 40 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: "-50px" }}
                      transition={{ duration: 0.35, delay: index * 0.03 }}
                      className="h-full"
                    >
                      {/* ✅ ended badge via prop (add ended prop in MarketCard) */}
                      <MarketCard market={market as any} ended={ended} />
                    </motion.div>
                  );
                })}
              </div>

              {displayedCount < statusFiltered.length && (
                <div ref={observerTarget} className="text-center py-12">
                  {loadingMore ? (
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-pump-green" />
                  ) : (
                    <button
                      onClick={loadMore}
                      className="px-8 py-3 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg text-white font-semibold transition"
                    >
                      Load More Markets
                    </button>
                  )}
                </div>
              )}

              {displayedCount >= statusFiltered.length && statusFiltered.length > 12 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8 text-gray-500 text-sm">
                  You&apos;ve reached the end 🎉
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ✅ Footer like your screen */}
      <Footer />

      {/* ✅ Live buys ticker (20 latest BUY) */}
      <LiveBuysTicker variant="breaking" />    </>
  );
}