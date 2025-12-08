'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MarketCard from '@/components/MarketCard';
import FeaturedMarketCardFull from '@/components/FeaturedMarketCardFull';
import CategoryFilters from '@/components/CategoryFilters';
import GeoblockModal from '@/components/GeoblockModal';
import { SkeletonCard, SkeletonFeaturedCard } from '@/components/SkeletonCard';
import Link from 'next/link';
import { CategoryId } from '@/utils/categories';
import { getAllMarkets } from '@/lib/markets';

interface Market {
  publicKey: string;
  question: string;
  description: string;
  category: string;
  imageUrl?: string;
  yesSupply: number;
  noSupply: number;
  totalVolume: number;
  resolutionTime: number;
  resolved: boolean;
  creator?: string;
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
}

export default function Home() {
  const { connection } = useConnection();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');
  const [currentFeaturedIndex, setCurrentFeaturedIndex] = useState(0);
  const [displayedCount, setDisplayedCount] = useState(12);

  const observerTarget = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMarkets();
  }, []);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && filteredMarkets.length > displayedCount) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [displayedCount, loading]);

  async function loadMarkets() {
    try {
      // Fetch markets from Supabase
      const supabaseMarkets = await getAllMarkets();
      
      // Transform Supabase format to component format
      const transformedMarkets: Market[] = supabaseMarkets.map((m) => ({
        publicKey: m.market_address,
        question: m.question,
        description: m.description || '',
        category: m.category || 'other',
        imageUrl: m.image_url || undefined,
        yesSupply: m.yes_supply,
        noSupply: m.no_supply,
        totalVolume: m.total_volume,
        resolutionTime: Math.floor(new Date(m.end_date).getTime() / 1000),
        resolved: m.resolved,
        creator: m.creator,
      }));
      
      setMarkets(transformedMarkets);
    } catch (error) {
      console.error('Error loading markets:', error);
    } finally {
      setLoading(false);
    }
  }

  const loadMore = useCallback(() => {
    if (loadingMore) return;
    setLoadingMore(true);
    setTimeout(() => {
      setDisplayedCount((prev) => prev + 12);
      setLoadingMore(false);
    }, 500);
  }, [loadingMore]);

  const filteredMarkets = markets.filter((market) => {
    const categoryMatch = selectedCategory === 'all' || market.category === selectedCategory;
    const statusMatch = !market.resolved; // Only show active markets
    return statusMatch && categoryMatch;
  });

  // Featured markets (top 3 by volume)
  const featuredMarkets = [...markets]
    .sort((a, b) => b.totalVolume - a.totalVolume)
    .slice(0, 3)
    .map((market) => {
      const totalSupply = market.yesSupply + market.noSupply;
      const yesPercent = totalSupply > 0 ? Math.round((market.yesSupply / totalSupply) * 100) : 50;
      const noPercent = 100 - yesPercent;
      const now = Date.now() / 1000;
      const timeLeft = market.resolutionTime - now;
      const daysLeft = Math.max(0, Math.floor(timeLeft / 86400));

      return {
        id: market.publicKey,
        question: market.question,
        category: market.category,
        imageUrl: market.imageUrl,
        yesPercent,
        noPercent,
        volume: market.totalVolume,
        daysLeft,
        creator: market.creator,
        socialLinks: market.socialLinks,
        yesSupply: market.yesSupply,
        noSupply: market.noSupply,
      };
    });

  const handlePrevFeatured = () => {
    setCurrentFeaturedIndex((prev) => (prev === 0 ? featuredMarkets.length - 1 : prev - 1));
  };

  const handleNextFeatured = () => {
    setCurrentFeaturedIndex((prev) => (prev === featuredMarkets.length - 1 ? 0 : prev + 1));
  };

  const displayedMarkets = filteredMarkets.slice(0, displayedCount);

  return (
    <>
      {/* Geoblock Modal */}
      <GeoblockModal />

      {/* Category Filters - Visual buttons */}
      <div className="border-b border-gray-800 bg-pump-dark/50 sticky top-16 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <CategoryFilters selectedCategory={selectedCategory} onSelectCategory={setSelectedCategory} />
        </div>
      </div>

      {/* Featured Markets Carousel - Full Kalshi Style */}
      <div className="py-6 bg-gradient-to-b from-pump-dark to-transparent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <h2 className="text-2xl md:text-3xl font-bold text-white">📈 Featured Markets</h2>
              <p className="text-gray-400 text-sm hidden md:block">Trending predictions with high volume</p>
            </div>

            {/* Navigation arrows */}
            <div className="flex gap-2">
              <button
                onClick={handlePrevFeatured}
                className="p-2 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg transition"
                aria-label="Previous featured market"
              >
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
              <button
                onClick={handleNextFeatured}
                className="p-2 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg transition"
                aria-label="Next featured market"
              >
                <ChevronRight className="w-5 h-5 text-white" />
              </button>
            </div>
          </div>

          {/* Carousel Container - 1 card at a time */}
          <div className="relative">
            {loading ? (
              <SkeletonFeaturedCard />
            ) : featuredMarkets.length > 0 ? (
              <div className="relative overflow-hidden">
                <div
                  className="flex transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${currentFeaturedIndex * 100}%)` }}
                >
                  {featuredMarkets.map((market, index) => (
                    <div key={market.id} className="w-full flex-shrink-0">
                      <FeaturedMarketCardFull market={market} />
                    </div>
                  ))}
                </div>

                {/* Dots indicator */}
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

      {/* Markets Grid with Animations */}
      <div className="py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-white">All Markets</h3>
            <p className="text-sm text-gray-500">{filteredMarkets.length} markets</p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">
              {Array(8)
                .fill(null)
                .map((_, i) => (
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
                {displayedMarkets.map((market, index) => (
                  <motion.div
                    key={market.publicKey}
                    initial={{ opacity: 0, y: 50 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-50px' }}
                    transition={{ duration: 0.4, delay: index * 0.05 }}
                    className="h-full"
                  >
                    <div className="h-full">
                      <MarketCard market={market} />
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Infinite scroll trigger */}
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

              {/* End of results */}
              {displayedCount >= filteredMarkets.length && filteredMarkets.length > 12 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-8 text-gray-500 text-sm"
                >
                  You've reached the end 🎉
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}