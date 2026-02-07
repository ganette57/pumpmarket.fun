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
  id: string;
  dbId?: string;
  question: string;
  category: string;
  imageUrl?: string;
  volume: number;
  daysLeft: number;
  creator?: string;
  socialLinks?: {
    twitter?: string;
    telegram?: string;
    website?: string;
  };
  yesSupply: number;
  noSupply: number;
  marketType?: number;
  outcomeNames?: string[];
  outcomeSupplies?: number[];
}

interface FeaturedMarketCardFullProps {
  market: FeaturedMarket;
  liveSessionId?: string | null;
}

export default function FeaturedMarketCardFull({ market, liveSessionId }: FeaturedMarketCardFullProps) {
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
        {/* Single clean card - no extra borders */}
        <div className="bg-[#0a0b0d] border border-gray-800 hover:border-pump-green/60 rounded-2xl transition-all duration-300 hover:shadow-[0_0_40px_rgba(16,185,129,0.15)] cursor-pointer overflow-hidden relative">
          {/* LIVE badge */}
          {liveSessionId && (
            <a
              href={`/live/${liveSessionId}`}
              onClick={(e) => e.stopPropagation()}
              className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600/90 hover:bg-red-500 text-white text-xs font-bold shadow-lg transition"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </a>
          )}

          {/* DESKTOP */}
          <div className="hidden md:flex min-h-[400px]">
            
            {/* LEFT SIDE - Content */}
            <div className="w-[45%] p-8 flex flex-col">
              {/* Category pill */}
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/5 border border-gray-700 text-[11px] uppercase tracking-wide text-gray-300 mb-5 w-fit">
                {market.category}
              </div>

              {/* Image + Title row */}
              <div className="flex gap-5 mb-6">
                <div className="flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden bg-black/50">
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
                    <div className="w-full h-full scale-[0.5]">
                      <CategoryImagePlaceholder
                        category={market.category.toLowerCase()}
                        className="w-full h-full"
                      />
                    </div>
                  )}
                </div>

                <div className="flex-1">
                  <h2 className="text-2xl font-bold text-white leading-tight hover:text-pump-green transition line-clamp-3">
                    {market.question}
                  </h2>
                  
                  {market.creator && (
                    <p className="text-sm text-gray-500 mt-2">
                      Created by{' '}
                      <span className="text-gray-300">
                        {market.creator.length > 12
                          ? `${market.creator.slice(0, 10)}…`
                          : market.creator}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* Volume + time left */}
              <div className="flex items-center gap-5 text-sm text-gray-400 mb-8">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-pump-green" />
                  <span className="font-semibold text-white">{volLabel} SOL</span>
                  <span className="text-gray-500">Vol</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <span>{market.daysLeft}d left</span>
                </div>
              </div>

              {/* Outcomes - Clean single-line layout */}
              <div className="mt-auto space-y-4">
                {outcomes.slice(0, 2).map((outcome, index) => {
                  const isYes = index === 0;

                  return (
                    <div key={index} className="flex items-center gap-4">
                      {/* Label - truncated, single line */}
                      <span
                        className={`text-sm font-semibold uppercase w-24 truncate flex-shrink-0 ${
                          isYes ? 'text-pump-green' : 'text-red-400'
                        }`}
                        title={outcome}
                      >
                        {outcome}
                      </span>

                      {/* Percentage - big and bold */}
                      <span
                        className={`text-3xl font-bold w-20 flex-shrink-0 ${
                          isYes ? 'text-pump-green' : 'text-red-400'
                        }`}
                      >
                        {percentages[index]?.toFixed(0)}%
                      </span>

                      {/* Shares - subtle */}
                      <span className="text-sm text-gray-500 flex-shrink-0">
                        {(supplies[index] || 0).toLocaleString()} shares
                      </span>
                    </div>
                  );
                })}

                {outcomes.length > 2 && (
                  <div className="text-xs text-gray-500 pl-28">
                    +{outcomes.length - 2} more outcomes
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT SIDE - Chart */}
            <div className="w-[55%] p-6 pl-2 flex flex-col justify-center">
              <div className="h-full flex items-center">
                <div className="w-full h-[300px]">
                  <OddsHistoryFromTrades
                    marketId={market.dbId}
                    marketAddress={market.id}
                    outcomeNames={outcomes}
                    outcomeSupplies={supplies}
                    outcomesCount={outcomes.length}
                    hours={24}
                    height={300}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* MOBILE */}
          <div className="md:hidden">
            <div className="p-5 space-y-4">
              {/* Category */}
              <div className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/5 border border-gray-700 text-[10px] uppercase tracking-wide text-gray-300">
                {market.category}
              </div>

              {/* Header */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-black/50">
                  {market.imageUrl && !imageError ? (
                    <Image
                      src={market.imageUrl}
                      alt={market.question}
                      width={80}
                      height={80}
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
                  <h2 className="text-lg font-bold text-white leading-tight line-clamp-2">
                    {market.question}
                  </h2>

                  <div className="mt-2 text-xs text-gray-400 flex items-center gap-3">
                    <span className="text-white font-medium">{volLabel} SOL</span>
                    <span className="text-gray-600">•</span>
                    <span>{market.daysLeft}d left</span>
                  </div>
                </div>
              </div>

              {/* Outcomes - Clean mobile layout, single line */}
              <div className="space-y-3 pt-2">
                {outcomes.slice(0, 2).map((outcome, index) => {
                  const isYes = index === 0;

                  return (
                    <div key={index} className="flex items-center gap-3">
                      {/* Label - truncated */}
                      <span
                        className={`text-xs font-semibold uppercase w-16 truncate flex-shrink-0 ${
                          isYes ? 'text-pump-green' : 'text-red-400'
                        }`}
                        title={outcome}
                      >
                        {outcome}
                      </span>

                      {/* Percentage */}
                      <span
                        className={`text-2xl font-bold w-16 flex-shrink-0 ${
                          isYes ? 'text-pump-green' : 'text-red-400'
                        }`}
                      >
                        {percentages[index]?.toFixed(0)}%
                      </span>

                      {/* Shares */}
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {(supplies[index] || 0).toLocaleString()} shares
                      </span>
                    </div>
                  );
                })}
                {outcomes.length > 2 && (
                  <div className="text-[11px] text-gray-500 pl-20">
                    +{outcomes.length - 2} more outcomes
                  </div>
                )}
              </div>

              {/* Mobile chart */}
              <div className="pt-2">
                <OddsHistoryFromTrades
                  marketId={market.dbId}
                  marketAddress={market.id}
                  outcomeNames={outcomes}
                  outcomeSupplies={supplies}
                  outcomesCount={outcomes.length}
                  hours={24}
                  height={160}
                />
              </div>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}