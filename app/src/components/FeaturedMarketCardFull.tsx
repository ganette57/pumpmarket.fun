'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { TrendingUp, Clock } from 'lucide-react';
import CategoryImagePlaceholder from './CategoryImagePlaceholder';
import { lamportsToSol } from '@/utils/solana';
import OddsHistoryFromTrades from "@/components/OddsHistoryFromTrades";

interface FeaturedMarket {
  // ✅ on garde id = market_address (pour /trade/:id)
  id: string;

  // ✅ NEW: supabase UUID (pour fetch trades/odds)
  dbId?: string;

  question: string;
  category: string;
  imageUrl?: string;

  volume: number; // lamports
  daysLeft: number;

  creator?: string;
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };

  // binary legacy
  yesSupply: number;
  noSupply: number;

  // multi
  marketType?: number;
  outcomeNames?: string[];
  outcomeSupplies?: number[];
}

interface FeaturedMarketCardFullProps {
  market: FeaturedMarket;
}

export default function FeaturedMarketCardFull({ market }: FeaturedMarketCardFullProps) {
  const [imageError, setImageError] = useState(false);

  const outcomes = useMemo(() => {
    const names = (market.outcomeNames || []).filter(Boolean);
    return names.length >= 2 ? names : ['YES', 'NO'];
  }, [market.outcomeNames]);

  const supplies = useMemo(() => {
    const s = Array.isArray(market.outcomeSupplies) ? market.outcomeSupplies : [];
    if (s.length >= outcomes.length) return s.slice(0, outcomes.length).map((x) => Number(x || 0));
    return [Number(market.yesSupply || 0), Number(market.noSupply || 0)];
  }, [market.outcomeSupplies, market.yesSupply, market.noSupply, outcomes]);

  const totalSupply = supplies.reduce((sum, s) => sum + (s || 0), 0);
  const percentages = supplies.map((s) =>
    totalSupply > 0 ? ((s || 0) / totalSupply) * 100 : 100 / supplies.length
  );

  const volSol = lamportsToSol(market.volume);
  const volLabel = volSol >= 1000 ? `${(volSol / 1000).toFixed(1)}k` : volSol.toFixed(2);

  return (
    <div className="w-full">
      <Link href={`/trade/${market.id}`}>
        <div className="bg-pump-gray border border-gray-700 hover:border-pump-green rounded-xl transition-all duration-300 hover:shadow-2xl cursor-pointer overflow-hidden">
          {/* Desktop */}
          <div className="hidden md:flex h-[500px]">
            {/* Left */}
            <div className="w-1/2 p-8 flex flex-col">
              <div className="flex gap-6 flex-1">
                <div className="flex-shrink-0 w-32 h-32 rounded-xl overflow-hidden bg-pump-dark">
                  {market.imageUrl && !imageError ? (
                    <Image
                      src={market.imageUrl}
                      alt={market.question}
                      width={128}
                      height={128}
                      className="object-cover w-full h-full"
                      onError={() => setImageError(true)}
                    />
                  ) : (
                    <div className="w-full h-full scale-[0.5]">
                      <CategoryImagePlaceholder category={market.category.toLowerCase()} className="w-full h-full" />
                    </div>
                  )}
                </div>

                <div className="flex-1 flex flex-col">
                  <div className="inline-block px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded-full text-blue-400 text-xs font-semibold mb-3 w-fit">
                    {market.category}
                  </div>

                  <h2 className="text-3xl font-bold text-white mb-4 line-clamp-3 leading-tight hover:text-pump-green transition">
                    {market.question}
                  </h2>

                  {market.creator && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-400">
                        Created by <span className="text-white font-semibold">{market.creator.slice(0, 8)}...</span>
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-6 text-sm text-gray-400 mb-6">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-pump-green" />
                      <span className="font-semibold text-white">{volLabel} SOL Vol</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{market.daysLeft}d left</span>
                    </div>
                  </div>

                  {/* Outcomes */}
                  <div className="space-y-3 mt-auto">
                    {outcomes.slice(0, 2).map((outcome, index) => (
                      <div key={index} className="flex items-center gap-4">
                        <span
                          className={`text-sm font-semibold uppercase w-36 text-left ${
                            index === 0 ? 'text-blue-400' : 'text-red-400'
                          }`}
                        >
                          {outcome.length > 10 ? outcome.slice(0, 10) + '...' : outcome}
                        </span>

                        <div
                          className={`flex-1 flex items-center justify-between p-3 rounded-lg ${
                            index === 0
                              ? 'bg-blue-500/10 border border-blue-500/30'
                              : 'bg-red-500/10 border border-red-500/30'
                          }`}
                        >
                          <span className={`text-3xl font-bold ${index === 0 ? 'text-blue-400' : 'text-red-400'}`}>
                            {percentages[index]?.toFixed(0)}%
                          </span>
                          <span className="text-xs text-gray-500">
                            {(supplies[index] || 0).toLocaleString()} shares
                          </span>
                        </div>
                      </div>
                    ))}
                    {outcomes.length > 2 && (
                      <div className="text-sm text-gray-400 text-center">+{outcomes.length - 2} more options</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right (chart) */}
            <div className="w-1/2 bg-pump-dark/50 p-6 border-l border-gray-800 flex items-center">
              <div className="w-full">
                <h3 className="text-sm font-semibold text-gray-400 mb-4">Odds history</h3>

                {/* ✅ IMPORTANT: pass dbId (supabase UUID), sinon "not enough trades" */}
                <OddsHistoryFromTrades
  marketId={market.dbId}
  marketAddress={market.id}
  outcomeNames={outcomes}
  outcomesCount={outcomes.length}
  outcomeSupplies={supplies}   // ✅ AJOUT
  hours={24}
  height={170}
/>
              </div>
            </div>
          </div>

          {/* Mobile */}
          <div className="md:hidden">
            <div className="p-5">
              <div className="flex gap-4 mb-4">
                <div className="flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden bg-pump-dark">
                  {market.imageUrl && !imageError ? (
                    <Image
                      src={market.imageUrl}
                      alt={market.question}
                      width={96}
                      height={96}
                      className="object-cover w-full h-full"
                      onError={() => setImageError(true)}
                    />
                  ) : (
                    <div className="w-full h-full scale-[0.4]">
                      <CategoryImagePlaceholder category={market.category.toLowerCase()} className="w-full h-full" />
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <div className="inline-block px-2 py-1 bg-blue-500/20 border border-blue-500/30 rounded-full text-blue-400 text-xs font-semibold mb-2">
                    {market.category}
                  </div>
                  <h2 className="text-lg font-bold text-white line-clamp-2 leading-tight">{market.question}</h2>
                  <div className="mt-2 text-xs text-gray-400">
                    {volLabel} SOL Vol • {market.daysLeft}d left
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {outcomes.slice(0, 2).map((outcome, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <span
                      className={`text-xs font-semibold uppercase w-20 text-left ${
                        index === 0 ? 'text-blue-400' : 'text-red-400'
                      }`}
                    >
                      {outcome.length > 8 ? outcome.slice(0, 8) + '...' : outcome}
                    </span>
                    <div
                      className={`flex-1 flex items-center justify-between p-3 rounded-lg ${
                        index === 0
                          ? 'bg-blue-500/10 border border-blue-500/30'
                          : 'bg-red-500/10 border border-red-500/30'
                      }`}
                    >
                      <span className={`text-2xl font-bold ${index === 0 ? 'text-blue-400' : 'text-red-400'}`}>
                        {percentages[index]?.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
                {outcomes.length > 2 && <div className="text-xs text-gray-400">+{outcomes.length - 2} more</div>}
              </div>

              {/* ✅ Mobile odds chart */}
              <div className="bg-pump-dark/40 border border-gray-800 rounded-xl p-4">
  <div className="text-xs font-semibold text-gray-400 mb-3">Odds history</div>
  <OddsHistoryFromTrades
  marketId={market.dbId}
  marketAddress={market.id}
  outcomeNames={outcomes}
  outcomeSupplies={supplies}   // ✅ AJOUTE ÇA
  outcomesCount={outcomes.length}
  hours={24}
  height={170}
/>
</div>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}