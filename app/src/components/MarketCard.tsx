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
  };
}

export default function MarketCard({ market }: MarketCardProps) {
  const [imageError, setImageError] = useState(false);
  const totalSupply = market.yesSupply + market.noSupply;
  const yesPercent = totalSupply > 0 ? (market.yesSupply / totalSupply) * 100 : 50;
  const noPercent = 100 - yesPercent;

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
      <div className="bg-pump-gray border border-gray-800 rounded-xl hover:border-pump-green transition-all duration-200 hover:shadow-lg cursor-pointer p-4">
        <div className="flex gap-3">
          {/* Small Square Image Left */}
          <div className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden bg-pump-dark">
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
                <CategoryImagePlaceholder category={market.category} className="w-full h-full" />
              </div>
            )}
          </div>

          {/* Content Right */}
          <div className="flex-1 min-w-0">
            {/* Title */}
            <h3 className="text-base font-bold text-white mb-1 line-clamp-2 leading-tight">
              {market.question}
            </h3>

            {/* YES/NO Inline */}
            <div className="flex gap-3 mb-2">
              <div className="flex items-center gap-1">
                <span className="text-xs text-blue-400 font-medium">YES</span>
                <span className="text-sm font-bold text-blue-400">{yesPercent.toFixed(0)}%</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-red-400 font-medium">NO</span>
                <span className="text-sm font-bold text-red-400">{noPercent.toFixed(0)}%</span>
              </div>
            </div>

            {/* Stats Bottom */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>${volumeDisplay} Vol</span>
              <span>•</span>
              {market.resolved ? (
                <span className="text-pump-green font-semibold">RESOLVED</span>
              ) : (
                <span>{daysLeft}d left</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
