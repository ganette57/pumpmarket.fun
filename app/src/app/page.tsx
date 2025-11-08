'use client';

import { useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import MarketCard from '@/components/MarketCard';
import MarketCarousel from '@/components/MarketCarousel';
import CategoryMenu from '@/components/CategoryMenu';
import GeoblockModal from '@/components/GeoblockModal';
import Link from 'next/link';
import { CategoryId } from '@/utils/categories';

interface Market {
  publicKey: string;
  question: string;
  description: string;
  category: string;
  yesSupply: number;
  noSupply: number;
  totalVolume: number;
  resolutionTime: number;
  resolved: boolean;
}

export default function Home() {
  const { connection } = useConnection();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('active');
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | 'all'>('all');

  useEffect(() => {
    loadMarkets();
  }, []);

  async function loadMarkets() {
    try {
      // TODO: Fetch markets from program
      // For now, show example markets with categories
      const exampleMarkets: Market[] = [
        {
          publicKey: 'example1',
          question: 'Will SOL reach $500 in 2025?',
          description: 'Market resolves when SOL/USD hits $500 or on Dec 31, 2025',
          category: 'crypto',
          yesSupply: 1000,
          noSupply: 800,
          totalVolume: 50_000_000_000,
          resolutionTime: Math.floor(Date.now() / 1000) + 86400 * 30,
          resolved: false,
        },
        {
          publicKey: 'example2',
          question: 'Will Bitcoin ETF approval pump BTC above $100k?',
          description: 'Resolves YES if BTC/USD > $100k within 60 days of ETF approval',
          category: 'crypto',
          yesSupply: 2000,
          noSupply: 500,
          totalVolume: 120_000_000_000,
          resolutionTime: Math.floor(Date.now() / 1000) + 86400 * 60,
          resolved: false,
        },
        {
          publicKey: 'example3',
          question: 'Will Trump win 2024 election?',
          description: 'Presidential election results',
          category: 'politics',
          yesSupply: 5000,
          noSupply: 4800,
          totalVolume: 250_000_000_000,
          resolutionTime: Math.floor(Date.now() / 1000) + 86400 * 120,
          resolved: false,
        },
        {
          publicKey: 'example4',
          question: 'Will Lakers win NBA championship?',
          description: 'NBA Finals 2024-2025 season',
          category: 'sports',
          yesSupply: 800,
          noSupply: 1200,
          totalVolume: 35_000_000_000,
          resolutionTime: Math.floor(Date.now() / 1000) + 86400 * 90,
          resolved: false,
        },
      ];
      setMarkets(exampleMarkets);
    } catch (error) {
      console.error('Error loading markets:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredMarkets = markets.filter((market) => {
    // Filter by status
    const statusMatch =
      filter === 'all' ||
      (filter === 'active' && !market.resolved) ||
      (filter === 'resolved' && market.resolved);

    // Filter by category
    const categoryMatch = selectedCategory === 'all' || market.category === selectedCategory;

    return statusMatch && categoryMatch;
  });

  return (
    <>
      {/* Geoblock Modal */}
      <GeoblockModal />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-5xl md:text-6xl font-bold mb-4 bg-gradient-to-r from-pump-green via-blue-400 to-pump-red bg-clip-text text-transparent">
            Degen Prediction Markets
          </h1>
          <p className="text-xl text-gray-400 mb-8">
            Polymarket vibes meets PumpFun energy on Solana 🚀
          </p>
          <Link href="/create">
            <button className="btn-pump text-lg glow-green px-8 py-4">
              Create Market 🎯
            </button>
          </Link>
        </div>

        {/* Featured Markets Carousel */}
        <MarketCarousel />

        {/* Category Menu */}
        <div className="mb-8">
          <CategoryMenu
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />
        </div>

        {/* Status Filters */}
        <div className="flex justify-center space-x-4 mb-8">
          <button
            onClick={() => setFilter('all')}
            className={`px-6 py-2 rounded-lg font-semibold transition ${
              filter === 'all'
                ? 'bg-pump-green text-black'
                : 'bg-pump-gray text-gray-400 hover:text-white'
            }`}
          >
            All Markets
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-6 py-2 rounded-lg font-semibold transition ${
              filter === 'active'
                ? 'bg-pump-green text-black'
                : 'bg-pump-gray text-gray-400 hover:text-white'
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setFilter('resolved')}
            className={`px-6 py-2 rounded-lg font-semibold transition ${
              filter === 'resolved'
                ? 'bg-pump-green text-black'
                : 'bg-pump-gray text-gray-400 hover:text-white'
            }`}
          >
            Resolved
          </button>
        </div>

        {/* Markets Grid */}
        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-pump-green"></div>
            <p className="text-gray-400 mt-4">Loading markets...</p>
          </div>
        ) : filteredMarkets.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🤷</div>
            <p className="text-gray-400 text-xl mb-4">
              No markets found in this category
            </p>
            <Link href="/create">
              <button className="btn-pump">Create the first one!</button>
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredMarkets.map((market) => (
                <MarketCard key={market.publicKey} market={market} />
              ))}
            </div>

            {/* Load More */}
            {filteredMarkets.length >= 6 && (
              <div className="text-center mt-12">
                <button className="px-8 py-3 bg-pump-gray hover:bg-pump-dark border border-gray-700 hover:border-pump-green rounded-lg text-white font-semibold transition">
                  Load More Markets
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
