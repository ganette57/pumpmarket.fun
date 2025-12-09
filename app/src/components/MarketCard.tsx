'use client';
import Link from 'next/link';
import Image from 'next/image';
import { lamportsToSol } from '@/utils/solana';
import CategoryImagePlaceholder from './CategoryImagePlaceholder';
import { useState } from 'react';

interface MarketCardProps {
  market: {
    publicKey: string;
    question: string;
    description: string;
    category?: string;
    imageUrl?: string;
    yesSupply: number;
    noSupply: number;
    totalVolume: number;
    resolutionTime: number;
    resolved: boolean;
    // Multi-choice fields
    marketType?: number;
    outcomeNames?: string[];
    outcomeSupplies?: number[];
  };
}

export default function MarketCard({ market }: MarketCardProps) {
  const [imageError, setImageError] = useState(false);
  
  // Determine if binary or multi-choice
  const isBinary = !market.marketType || market.marketType === 0;
  const outcomes = market.outcomeNames || ['YES', 'NO'];
  const supplies = market.outcomeSupplies || [market.yesSupply, market.noSupply];
  
  // Calculate percentages
  const totalSupply = supplies.reduce((sum, s) => sum + (s || 0), 0);
  const percentages = supplies.map(s => 
    totalSupply > 0 ? ((s || 0) / totalSupply) * 100 : 100 / supplies.length
  );
  
  const now = Date.now() / 1000;
  const timeLeft = market.resolutionTime - now;
  const daysLeft = Math.max(0, Math.floor(timeLeft / 86400));
  const hoursLeft = Math.max(0, Math.floor((timeLeft % 86400) / 3600));

  // Format volume
  const volumeInSol = lamportsToSol(market.totalVolume);
  const volumeDisplay = volumeInSol >= 1000
    ? `${(volumeInSol / 1000).toFixed(1)}k`
    : volumeInSol.toFixed(0);

  return (
    <Link href={`/trade/${market.publicKey}`}>
      <div className="card-pump h-full flex flex-col transition-all duration-300 hover:scale-[1.02] hover:border-pump-green/50 cursor-pointer group">
        {/* Image */}
        <div className="relative w-full h-40 mb-4 rounded-lg overflow-hidden bg-pump-dark">
          {market.imageUrl && !imageError ? (
            <Image
              src={market.imageUrl}
              alt={market.question}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              onError={() => setImageError(true)}
            />
          ) : (
            <CategoryImagePlaceholder category={market.category || 'other'} className="w-full h-full" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-pump-dark/80 to-transparent"></div>
          
          {/* Category badge */}
          {market.category && (
            <div className="absolute top-2 left-2">
              <span className="px-2 py-1 text-xs font-semibold bg-pump-dark/80 backdrop-blur-sm rounded-full border border-gray-700 text-gray-300 capitalize">
                {market.category}
              </span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          {/* Question */}
          <h3 className="text-base font-bold text-white mb-2 line-clamp-2 group-hover:text-pump-green transition-colors">
            {market.question}
          </h3>

          {/* Description */}
          <p className="text-sm text-gray-400 mb-3 line-clamp-2 leading-snug">
            {market.description}
          </p>

          {/* Spacer to push outcomes and stats to bottom */}
          <div className="flex-1"></div>

          {/* Outcomes Display - Dynamic */}
          <div className="flex gap-3 mb-3 flex-wrap">
            {outcomes.slice(0, 2).map((outcome, index) => (
              <div key={index} className="flex items-center gap-1">
                <span className={`text-xs font-medium uppercase ${
                  index === 0 ? 'text-blue-400' : 'text-red-400'
                }`}>
                  {outcome.length > 8 ? outcome.slice(0, 8) + '...' : outcome}
                </span>
                <span className={`text-sm font-bold ${
                  index === 0 ? 'text-blue-400' : 'text-red-400'
                }`}>
                  {percentages[index]?.toFixed(0)}%
                </span>
              </div>
            ))}
            {outcomes.length > 2 && (
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-gray-400">
                  +{outcomes.length - 2} more
                </span>
              </div>
            )}
          </div>

          {/* Stats Bottom */}
          <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-800">
            <div className="flex items-center space-x-1">
              <span className="text-pump-green font-semibold">${volumeDisplay}</span>
              <span>Vol</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-gray-400">
                {daysLeft > 0 ? `${daysLeft}d left` : `${hoursLeft}h left`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}