'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { supabase } from '@/utils/supabase';
import type { Market } from '@/types/database.types';
import MarketCard from '@/components/MarketCard';

export default function DashboardPage() {
  const { publicKey } = useWallet();
  const [bookmarkedMarkets, setBookmarkedMarkets] = useState<Market[]>([]);
  const [createdMarkets, setCreatedMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicKey) {
      setBookmarkedMarkets([]);
      setCreatedMarkets([]);
      setLoading(false);
      return;
    }

    fetchDashboardData();
  }, [publicKey]);

  const fetchDashboardData = async () => {
    if (!publicKey) return;

    setLoading(true);
    try {
      const userAddress = publicKey.toBase58();

      // Fetch bookmarked markets
      const { data: bookmarks } = await supabase
        .from('bookmarks')
        .select('market_id')
        .eq('user_address', userAddress);

      if (bookmarks && bookmarks.length > 0) {
        const marketIds = bookmarks.map((b) => b.market_id);
        const { data: savedMarkets } = await supabase
          .from('markets')
          .select('*')
          .in('id', marketIds)
          .order('created_at', { ascending: false });

        if (savedMarkets) {
          setBookmarkedMarkets(savedMarkets);
        }
      } else {
        setBookmarkedMarkets([]);
      }

      // Fetch created markets
      const { data: created } = await supabase
        .from('markets')
        .select('*')
        .eq('creator', userAddress)
        .order('created_at', { ascending: false });

      if (created) {
        setCreatedMarkets(created);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!publicKey) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <div className="text-6xl mb-4">🔐</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Connect Your Wallet
          </h1>
          <p className="text-gray-600">
            Please connect your wallet to view your dashboard
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <div className="text-4xl mb-4">⏳</div>
          <p className="text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">My Dashboard</h1>
        <p className="text-gray-600">
          Manage your markets and bookmarks
        </p>
      </div>

      {/* Created Markets Section */}
      <section className="mb-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          My Markets ({createdMarkets.length})
        </h2>
        {createdMarkets.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {createdMarkets.map((market) => (
              <MarketCard key={market.id} market={market} showBookmark={false} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <div className="text-4xl mb-2">📊</div>
            <p className="text-gray-600 mb-4">You haven't created any markets yet</p>
            <a
              href="/create"
              className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Create Your First Market
            </a>
          </div>
        )}
      </section>

      {/* Bookmarked Markets Section */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          Bookmarked Markets ({bookmarkedMarkets.length})
        </h2>
        {bookmarkedMarkets.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {bookmarkedMarkets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <div className="text-4xl mb-2">⭐</div>
            <p className="text-gray-600">No bookmarked markets yet</p>
          </div>
        )}
      </section>
    </div>
  );
}
