'use client';

import { useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import MarketCard from '@/components/MarketCard';
import Link from 'next/link';

interface Market {
  publicKey: string;
  question: string;
  description: string;
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

  useEffect(() => {
    loadMarkets();
  }, []);

  async function loadMarkets() {
    try {
      // TODO: Fetch markets from program
      // For now, show example markets
      const exampleMarkets: Market[] = [
        {
          publicKey: 'example1',
          question: 'Will SOL reach $500 in 2025?',
          description: 'Market resolves when SOL/USD hits $500 or on Dec 31, 2025',
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
          yesSupply: 2000,
          noSupply: 500,
          totalVolume: 120_000_000_000,
          resolutionTime: Math.floor(Date.now() / 1000) + 86400 * 60,
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

  const filteredMarkets = markets.filter(market => {
    if (filter === 'active') return !market.resolved;
    if (filter === 'resolved') return market.resolved;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Hero */}
      <div className="text-center mb-16">
        <h1 className="text-5xl md:text-6xl font-bold mb-4">
          <span className="text-pump-green">Degen</span>{' '}
          <span className="text-white">Prediction Markets</span>
        </h1>
        <p className="text-xl text-gray-400 mb-8">
          Polymarket vibes meets PumpFun energy on Solana
        </p>
        <Link href="/create">
          <button className="btn-pump text-lg glow-green">
            Create Market 🚀
          </button>
        </Link>
      </div>

      {/* Filters */}
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
          <p className="text-gray-400 text-xl">No markets found</p>
          <Link href="/create">
            <button className="btn-pump mt-4">Create the first one!</button>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMarkets.map((market) => (
            <MarketCard key={market.publicKey} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
