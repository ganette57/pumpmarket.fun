// app/src/app/search/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import MarketCard from '@/components/MarketCard';

type MarketRow = {
  id: string;
  market_address: string;
  question: string | null;
  description: string | null;
  category: string | null;
  image_url: string | null;
  yes_supply: number | null;
  no_supply: number | null;
  total_volume: number | null;
  end_date: string;
  resolved: boolean;
};

export default function SearchPage() {
  const searchParams = useSearchParams();
  const q = (searchParams.get('q') || '').trim();

  const [loading, setLoading] = useState(true);
  const [markets, setMarkets] = useState<MarketRow[]>([]);

  useEffect(() => {
    if (!q) {
      setMarkets([]);
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      try {
        // 👇 simple search sur question / description / category
        const { data, error } = await supabase
          .from('markets')
          .select(
            `
            id,
            market_address,
            question,
            description,
            category,
            image_url,
            yes_supply,
            no_supply,
            total_volume,
            end_date,
            resolved
          `
          )
          .or(
            `question.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%`
          )
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        setMarkets((data || []) as MarketRow[]);
      } catch (e) {
        console.error('Error searching markets', e);
        setMarkets([]);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [q]);

  return (
    <div className="py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-1">
            Search results
          </h1>
          <p className="text-sm text-gray-400">
            Query: <span className="font-mono text-gray-200">"{q}"</span> •{' '}
            {loading
              ? 'Loading...'
              : `${markets.length} market${
                  markets.length === 1 ? '' : 's'
                } found`}
          </p>
        </div>

        {loading ? (
          <div className="text-gray-400">Loading markets...</div>
        ) : markets.length === 0 ? (
          <div className="text-gray-400">
            No markets match this query. Try another keyword.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
            {markets.map((m) => (
              <MarketCard
                key={m.id}
                market={{
                  publicKey: m.market_address,
                  question: m.question || '',
                  description: m.description || '',
                  category: m.category || 'Other',
                  imageUrl: m.image_url || undefined,
                  yesSupply: Number(m.yes_supply || 0),
                  noSupply: Number(m.no_supply || 0),
                  totalVolume: Number(m.total_volume || 0),
                  resolutionTime: Math.floor(
                    new Date(m.end_date).getTime() / 1000
                  ),
                  resolved: m.resolved,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}