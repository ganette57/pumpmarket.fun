// app/src/components/FeaturedMarketCardFull.tsx
'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { TrendingUp, Clock } from 'lucide-react';
import CategoryImagePlaceholder from './CategoryImagePlaceholder';
import { lamportsToSol } from '@/utils/solana';
import OddsHistoryFromTrades from '@/components/OddsHistoryFromTrades';

interface FeaturedMarket {
  // market_address (pour /trade/:id)
  id: string;

  // Supabase UUID (pour fetch trades/odds)
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
        <div className="bg-pump-gray border border-gray-800 hover:border-pump-green/80 rounded-2xl transition-all duration-300 hover:shadow-[0_0_40px_rgba(16,185,129,0.25)] cursor-pointer overflow-hidden">
          {/* DESKTOP */}
          <div className="hidden md:flex h-[500px]">
            {/* LEFT */}
            <div className="w-1/2 p-8 flex flex-col">
              <div className="flex gap-6 flex-1">
                {/* Image */}
                <div className="flex-shrink-0 w-32 h-32 rounded-xl overflow-hidden bg-black">
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
                      <CategoryImagePlaceholder
                        category={market.category.toLowerCase()}
                        className="w-full h-full"
                      />
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 flex flex-col">
                  {/* Category pill en haut à gauche sur fond noir */}
                  <div className="inline-flex items-center px-3 py-1 rounded-full bg-black/70 border border-gray-700 text-[11px] uppercase tracking-wide text-gray-200 mb-3 w-fit">
                    {market.category}
                  </div>

                  {/* Titre remonté, très visible */}
                  <h2 className="text-3xl font-bold text-white mb-3 leading-tight hover:text-pump-green transition">
                    {market.question}
                  </h2>

                  {market.creator && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-400">
                        Created by{' '}
                        <span className="text-white font-semibold">
                          {market.creator.length > 12
                            ? `${market.creator.slice(0, 10)}…`
                            : market.creator}
                        </span>
                      </p>
                    </div>
                  )}

                  {/* Volume + time left */}
                  <div className="flex items-center gap-6 text-sm text-gray-400 mb-5">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-pump-green" />
                      <span className="font-semibold text-white">{volLabel} SOL Vol</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{market.daysLeft}d left</span>
                    </div>
                  </div>

                  {/* Outcomes YES / NO (vert / rouge) */}
                  <div className="space-y-3 mt-auto pb-2">
                    {outcomes.slice(0, 2).map((outcome, index) => {
                      const isYes = index === 0;
                      const label =
                        outcome.length > 16 ? outcome.slice(0, 16) + '…' : outcome;

                      return (
                        <div key={index} className="flex items-center gap-4">
                          <span
                            className={`text-xs font-semibold uppercase w-32 text-left ${
                              isYes ? 'text-pump-green' : 'text-red-400'
                            }`}
                          >
                            {label}
                          </span>

                          <div
                            className={`flex-1 flex items-center justify-between p-3 rounded-lg border ${
                              isYes
                                ? 'bg-pump-green/5 border-pump-green/40'
                                : 'bg-red-500/5 border-red-500/40'
                            }`}
                          >
                            <span
                              className={`text-3xl font-extrabold ${
                                isYes ? 'text-pump-green' : 'text-red-400'
                              }`}
                            >
                              {percentages[index]?.toFixed(0)}%
                            </span>
                            <span className="text-xs text-gray-500">
                              {(supplies[index] || 0).toLocaleString()} shares
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {outcomes.length > 2 && (
                      <div className="text-xs text-gray-500 text-left">
                        +{outcomes.length - 2} more outcomes
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT – chart, sans bordures */}
            <div className="w-1/2 bg-[#050608] p-6 flex items-center">
              <div className="w-full">
                {/* Plus de label “Odds history” ici, juste le chart clean */}
                <div className="rounded-xl bg-black/40 px-4 py-3 shadow-inner">
                  <OddsHistoryFromTrades
                    marketId={market.dbId}
                    marketAddress={market.id}
                    outcomeNames={outcomes}
                    outcomeSupplies={supplies}
                    outcomesCount={outcomes.length}
                    hours={24}
                    height={200}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* MOBILE */}
          <div className="md:hidden">
            <div className="p-5 space-y-4">
              {/* Header */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden bg-black">
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
                      <CategoryImagePlaceholder
                        category={market.category.toLowerCase()}
                        className="w-full h-full"
                      />
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-black/70 border border-gray-700 text-[10px] uppercase tracking-wide text-gray-200 mb-2">
                    {market.category}
                  </div>

                  <h2 className="text-lg font-bold text-white leading-tight line-clamp-2">
                    {market.question}
                  </h2>

                  <div className="mt-2 text-xs text-gray-400 flex items-center gap-3">
                    <span>{volLabel} SOL Vol</span>
                    <span>•</span>
                    <span>{market.daysLeft}d left</span>
                  </div>
                </div>
              </div>

              {/* Outcomes */}
              <div className="space-y-2">
                {outcomes.slice(0, 2).map((outcome, index) => {
                  const isYes = index === 0;
                  const label =
                    outcome.length > 12 ? outcome.slice(0, 12) + '…' : outcome;

                  return (
                    <div key={index} className="flex items-center gap-3">
                      <span
                        className={`text-[11px] font-semibold uppercase w-20 text-left ${
                          isYes ? 'text-pump-green' : 'text-red-400'
                        }`}
                      >
                        {label}
                      </span>
                      <div
                        className={`flex-1 flex items-center justify-between px-3 py-2 rounded-lg border ${
                          isYes
                            ? 'bg-pump-green/5 border-pump-green/40'
                            : 'bg-red-500/5 border-red-500/40'
                        }`}
                      >
                        <span
                          className={`text-2xl font-bold ${
                            isYes ? 'text-pump-green' : 'text-red-400'
                          }`}
                        >
                          {percentages[index]?.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
                {outcomes.length > 2 && (
                  <div className="text-[11px] text-gray-500">
                    +{outcomes.length - 2} more outcomes
                  </div>
                )}
              </div>

              {/* Mobile chart, sans bordures */}
              <div className="rounded-xl bg-black/40 px-3 py-3 shadow-inner">
                <OddsHistoryFromTrades
                  marketId={market.dbId}
                  marketAddress={market.id}
                  outcomeNames={outcomes}
                  outcomeSupplies={supplies}
                  outcomesCount={outcomes.length}
                  hours={24}
                  height={180}
                />
              </div>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}