'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

import MarketCard from '@/components/MarketCard';
import FeaturedMarketCardFull from '@/components/FeaturedMarketCardFull';
import CategoryFilters from '@/components/CategoryFilters';
import GeoblockModal from '@/components/GeoblockModal';
import { SkeletonCard, SkeletonFeaturedCard } from '@/components/SkeletonCard';

import { CategoryId } from '@/utils/categories';
import { getAllMarkets } from '@/lib/markets';

type SocialLinks = {
  twitter?: string;
  telegram?: string;
  website?: string;
  discord?: string;
};

interface DisplayMarket {
  // ✅ supabase uuid (needed for tx history)
  dbId?: string;

  // ✅ on-chain address (used for /trade/:id)
  publicKey: string;

  question: string;
  description: string;
  category: string;
  imageUrl?: string;

  yesSupply: number;
  noSupply: number;

  totalVolume: number; // lamports (as you already use everywhere)
  resolutionTime: number;
  resolved: boolean;
  creator: string;
  socialLinks?: SocialLinks;

  marketType: number; // 0=binary, 1=multi
  outcomeNames?: string[] | null;
  outcomeSupplies?: number[] | null;
}

type FeaturedMarket = {
  id: string; // market_address (for /trade/:id)
  dbId?: string; // supabase uuid (for tx queries)
  question: string;
  category: string;
  imageUrl?: string;

  volume: number; // lamports
  daysLeft: number;

  creator?: string;
  socialLinks?: SocialLinks;

  yesSupply: number;
  noSupply: number;

  marketType?: number;
  outcomeNames?: string[];
  outcomeSupplies?: number[];
};

function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeJsonParse(v: any) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

function safeStringArray(v: any): string[] | null {
  if (!v) return null;
  const vv = safeJsonParse(v);
  if (Array.isArray(vv)) return vv.map(String).map((s) => s.trim()).filter(Boolean);
  return null;
}

function safeNumberArray(v: any): number[] | null {
  if (!v) return null;
  const vv = safeJsonParse(v);
  if (Array.isArray(vv)) return vv.map((x) => toNum(x, 0));
  return null;
}

export default function HomePage() {
  const [markets, setMarkets] = useState<DisplayMarket[]>([]);
  const [filteredMarkets, setFilteredMarkets] = useState<DisplayMarket[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');

  const [loading, setLoading] = useState(true);
  const [displayedCount, setDisplayedCount] = useState(12);
  const [loadingMore, setLoadingMore] = useState(false);

  const [currentFeaturedIndex, setCurrentFeaturedIndex] = useState(0);
  const observerTarget = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    setLoadingMore(true);
    setTimeout(() => {
      setDisplayedCount((prev) => Math.min(prev + 12, filteredMarkets.length));
      setLoadingMore(false);
    }, 350);
  }, [loadingMore, filteredMarkets.length]);

  useEffect(() => {
    void loadMarkets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedCategory === 'all') setFilteredMarkets(markets);
    else setFilteredMarkets(markets.filter((m) => m.category === selectedCategory));

    setDisplayedCount(12);
    setCurrentFeaturedIndex(0);
  }, [selectedCategory, markets]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading && displayedCount < filteredMarkets.length) {
          loadMore();
        }
      },
      { threshold: 0.5 }
    );

    const node = observerTarget.current;
    if (node) observer.observe(node);

    return () => observer.disconnect();
  }, [displayedCount, loading, filteredMarkets.length, loadMore]);

  async function loadMarkets() {
    setLoading(true);
    try {
      const supabaseMarkets = await getAllMarkets();

      const transformed: DisplayMarket[] = (supabaseMarkets || [])
        .map((m: any) => {
          const mt =
            typeof m.market_type === 'number'
              ? m.market_type
              : toNum(m.market_type ?? 0, 0);

          const publicKey = String(m.market_address || '').trim();
          if (!publicKey) return null;

          return {
            dbId: m.id ?? undefined,
            publicKey,

            question: m.question || '',
            description: m.description || '',
            category: m.category || 'other',
            imageUrl: m.image_url || undefined,

            yesSupply: toNum(m.yes_supply ?? 0, 0),
            noSupply: toNum(m.no_supply ?? 0, 0),

            totalVolume: toNum(m.total_volume ?? 0, 0),
            resolutionTime: Math.floor(new Date(m.end_date).getTime() / 1000),
            resolved: !!m.resolved,
            creator: m.creator || '',

            socialLinks: (m.social_links as SocialLinks) || undefined,

            marketType: mt,
            outcomeNames: safeStringArray(m.outcome_names),
            outcomeSupplies: safeNumberArray(m.outcome_supplies),
          } as DisplayMarket;
        })
        .filter(Boolean) as DisplayMarket[];

      setMarkets(transformed);
    } catch (error) {
      console.error('Error loading markets:', error);
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }

  const featuredMarkets: FeaturedMarket[] = useMemo(() => {
    // (optionnel) tu peux filtrer resolved si tu veux
    const top = [...markets].sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 3);

    return top.map((m) => {
      const isMulti = m.marketType === 1 && (m.outcomeNames?.length || 0) >= 2;

      const names = isMulti ? (m.outcomeNames as string[]) : ['YES', 'NO'];

      const supplies = isMulti
        ? (m.outcomeSupplies && m.outcomeSupplies.length === names.length
            ? m.outcomeSupplies
            : Array(names.length).fill(0))
        : [m.yesSupply, m.noSupply];

      const now = Date.now() / 1000;
      const timeLeft = m.resolutionTime - now;
      const daysLeft = Math.max(0, Math.floor(timeLeft / 86400));

      return {
        id: m.publicKey,
        dbId: m.dbId,

        question: m.question,
        category: m.category,
        imageUrl: m.imageUrl,

        volume: m.totalVolume,
        daysLeft,

        creator: m.creator,
        socialLinks: m.socialLinks,

        yesSupply: m.yesSupply,
        noSupply: m.noSupply,

        marketType: m.marketType,

        // ✅ IMPORTANT: always provide consistent names/supplies for charts
        outcomeNames: names,
        outcomeSupplies: supplies.map((x) => toNum(x, 0)),
      };
    });
  }, [markets]);

  const handlePrevFeatured = () => {
    setCurrentFeaturedIndex((prev) => (prev === 0 ? featuredMarkets.length - 1 : prev - 1));
  };

  const handleNextFeatured = () => {
    setCurrentFeaturedIndex((prev) => (prev === featuredMarkets.length - 1 ? 0 : prev + 1));
  };

  const displayedMarkets = filteredMarkets.slice(0, displayedCount);

  return (
    <>
      <GeoblockModal />

      <div className="border-b border-gray-800 bg-pump-dark/50 sticky top-16 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <CategoryFilters selectedCategory={selectedCategory} onSelectCategory={setSelectedCategory} />
        </div>
      </div>

      <div className="py-6 bg-gradient-to-b from-pump-dark to-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <h2 className="text-2xl md:text-3xl font-bold text-white">📈 Featured Markets</h2>
              <p className="text-gray-400 text-sm hidden md:block">Trending predictions with high volume</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handlePrevFeatured}
                className="p-2 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg transition"
                aria-label="Previous featured market"
                disabled={featuredMarkets.length <= 1}
              >
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={handleNextFeatured}
                className="p-2 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg transition"
                aria-label="Next featured market"
                disabled={featuredMarkets.length <= 1}
              >
                <ChevronRight className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          <div className="relative">
            {loading ? (
              <SkeletonFeaturedCard />
            ) : featuredMarkets.length > 0 ? (
              <div className="relative overflow-hidden">
                <div
                  className="flex transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${currentFeaturedIndex * 100}%)` }}
                >
                  {featuredMarkets.map((mkt) => (
                    <div key={mkt.id} className="w-full flex-shrink-0">
                      <FeaturedMarketCardFull market={mkt as any} />
                    </div>
                  ))}
                </div>

                <div className="flex justify-center gap-2 mt-4">
                  {featuredMarkets.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentFeaturedIndex(index)}
                      className={`h-2 rounded-full transition-all duration-300 ${
                        index === currentFeaturedIndex ? 'w-8 bg-pump-green' : 'w-2 bg-gray-600'
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

      <div className="py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-white">All Markets</h3>
            <p className="text-sm text-gray-500">{filteredMarkets.length} markets</p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">
              {Array(8).fill(null).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : displayedMarkets.length === 0 ? (
            <div className="text-center py-20">
              <div className="text-6xl mb-4">🤷</div>
              <p className="text-gray-400 text-xl mb-4">No markets found in this category</p>
              <Link href="/create">
                <button className="btn-pump">Create the first one!</button>
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">
                {displayedMarkets.map((mkt, index) => (
                  <motion.div
                    key={mkt.publicKey}
                    initial={{ opacity: 0, y: 50 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-50px' }}
                    transition={{ duration: 0.4, delay: index * 0.05 }}
                    className="h-full"
                  >
                    <div className="h-full">
                      <MarketCard market={mkt as any} />
                    </div>
                  </motion.div>
                ))}
              </div>

              {displayedCount < filteredMarkets.length && (
                <div ref={observerTarget} className="text-center py-12">
                  {loadingMore ? (
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-pump-green"></div>
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

              {displayedCount >= filteredMarkets.length && filteredMarkets.length > 12 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-8 text-gray-500 text-sm"
                >
                  You&apos;ve reached the end 🎉
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}