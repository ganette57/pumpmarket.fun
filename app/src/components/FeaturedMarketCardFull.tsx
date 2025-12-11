'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { TrendingUp, Clock, ExternalLink } from 'lucide-react';
import CategoryImagePlaceholder from './CategoryImagePlaceholder';
import BondingCurveChart from './BondingCurveChart';

interface FeaturedMarket {
  id: string;
  question: string;
  category: string;
  imageUrl?: string;
  yesPercent: number;
  noPercent: number;
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
}

export default function FeaturedMarketCardFull({ market }: FeaturedMarketCardFullProps) {
  const [imageError, setImageError] = useState(false);

  const outcomes = market.outcomeNames || ['YES', 'NO'];
  const supplies = market.outcomeSupplies || [market.yesSupply, market.noSupply];
  const totalSupply = supplies.reduce((sum, s) => sum + (s || 0), 0);
  const percentages = supplies.map(s =>
    totalSupply > 0 ? ((s || 0) / totalSupply) * 100 : 100 / supplies.length
  );

  return (
    <div className="w-full">
      <Link href={`/trade/${market.id}`}>
        <div className="bg-pump-gray border border-gray-700 hover:border-pump-green rounded-xl transition-all duration-300 hover:shadow-2xl cursor-pointer overflow-hidden">
          {/* Desktop Layout - 50/50 split */}
          <div className="hidden md:flex h-[500px]">
            {/* Left: Image + Market Info (50%) */}
            <div className="w-1/2 p-8 flex flex-col">
              <div className="flex gap-6 flex-1">
                {/* Square Image */}
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

                {/* Content */}
                <div className="flex-1 flex flex-col">
                  {/* Category badge */}
                  <div className="inline-block px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded-full text-blue-400 text-xs font-semibold mb-3 w-fit">
                    {market.category}
                  </div>

                  {/* Title */}
                  <h2 className="text-3xl font-bold text-white mb-4 line-clamp-3 leading-tight hover:text-pump-green transition">
                    {market.question}
                  </h2>

                  {/* Creator */}
                  {market.creator && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-400">
                        Created by <span className="text-white font-semibold">{market.creator.slice(0, 8)}...</span>
                      </p>
                    </div>
                  )}

                  {/* Stats */}
                  <div className="flex items-center gap-6 text-sm text-gray-400 mb-6">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-pump-green" />
                      <span className="font-semibold text-white">
                        ${(market.volume / 1_000_000_000).toFixed(0)}k Vol
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>{market.daysLeft}d left</span>
                    </div>
                  </div>

                  {/* Outcomes - Kalshi exact style */}
                  <div className="space-y-3 mt-auto">
                    {outcomes.slice(0, 2).map((outcome, index) => (
                      <div key={index} className="flex items-center gap-4">
                        {/* Outcome name - left side */}
                        <span className={`text-sm font-semibold uppercase w-36 text-left ${
                          index === 0 ? 'text-blue-400' : 'text-red-400'
                        }`}>
                          {outcome.length > 10 ? outcome.slice(0, 10) + '...' : outcome}
                        </span>
                        
                        {/* Percentage box - right side */}
                        <div className={`flex-1 flex items-center justify-between p-3 rounded-lg ${
                          index === 0 ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-red-500/10 border border-red-500/30'
                        } transition`}>
                          <span className={`text-3xl font-bold ${
                            index === 0 ? 'text-blue-400' : 'text-red-400'
                          }`}>
                            {percentages[index]?.toFixed(0)}%
                          </span>
                          <span className="text-xs text-gray-500">
                            {(supplies[index] || 0).toLocaleString()} shares
                          </span>
                        </div>
                      </div>
                    ))}
                    {outcomes.length > 2 && (
                      <div className="text-sm text-gray-400 text-center">
                        +{outcomes.length - 2} more options
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Bonding Curve Chart (50%) */}
            <div className="w-1/2 bg-pump-dark/50 p-6 border-l border-gray-800 flex items-center">
              <div className="w-full">
                <h3 className="text-sm font-semibold text-gray-400 mb-4">Price History</h3>
                <BondingCurveChart currentSupply={market.yesSupply + market.noSupply} isYes={market.yesPercent >= 50} />
              </div>
            </div>
          </div>

          {/* Mobile Layout */}
          <div className="md:hidden">
            <div className="p-5">
              {/* Image + Title */}
              <div className="flex gap-4 mb-4">
                <div className="flex-shrink-0 w-24 h-24 rounded-xl overflow-hidden bg-pump-dark">
                  {market.imageUrl && !imageError ? (
                    <Image src={market.imageUrl} alt={market.question} width={96} height={96} className="object-cover w-full h-full" onError={() => setImageError(true)} />
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
                </div>
              </div>

              {/* Outcomes Mobile - Kalshi style */}
              <div className="space-y-2 mb-4">
                {outcomes.slice(0, 2).map((outcome, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <span className={`text-xs font-semibold uppercase w-20 text-left ${
                      index === 0 ? 'text-blue-400' : 'text-red-400'
                    }`}>
                      {outcome.length > 8 ? outcome.slice(0, 8) + '...' : outcome}
                    </span>
                    <div className={`flex-1 flex items-center justify-between p-3 rounded-lg ${
                      index === 0 ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-red-500/10 border border-red-500/30'
                    }`}>
                      <span className={`text-2xl font-bold ${
                        index === 0 ? 'text-blue-400' : 'text-red-400'
                      }`}>
                        {percentages[index]?.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}