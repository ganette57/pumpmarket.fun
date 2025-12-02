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

  return (
    <Link href={`/trade/${market.publicKey}`}>
      <div className="bg-pump-gray border border-gray-800 rounded-xl overflow-hidden hover:border-pump-green transition-all duration-200 hover:shadow-lg cursor-pointer group">
        {/* Market Image */}
        <div className="relative w-full h-48 overflow-hidden bg-pump-dark">
          {market.imageUrl && !imageError ? (
            <Image
              src={market.imageUrl}
              alt={market.question}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              onError={() => setImageError(true)}
            />
          ) : (
            <CategoryImagePlaceholder category={market.category} className="w-full h-full" />
          )}
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-pump-dark/80 to-transparent"></div>
        </div>
        </div>
        <div className="p-6">
          <div className="mb-4">
          <h3 className="text-xl font-bold text-white mb-2 line-clamp-2">
            {market.question}
          </h3>
          <p className="text-gray-400 text-sm line-clamp-2">
            {market.description}
          </p>
        </div>

        {/* Price indicators */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-3">
            <div className="text-xs text-blue-400 mb-1">YES</div>
            <div className="text-2xl font-bold text-blue-400">
              {yesPercent.toFixed(0)}%
            </div>
          </div>
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3">
            <div className="text-xs text-red-400 mb-1">NO</div>
            <div className="text-2xl font-bold text-red-400">
              {noPercent.toFixed(0)}%
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex justify-between text-sm text-gray-400 pt-4 border-t border-gray-700">
          <div>
            <span className="text-gray-500">Volume:</span>{' '}
            <span className="text-white font-semibold">
              {lamportsToSol(market.totalVolume).toFixed(2)} SOL
            </span>
          </div>
          <div>
            {market.resolved ? (
              <span className="text-pump-green font-semibold">RESOLVED</span>
            ) : (
              <span>
                {daysLeft}d {hoursLeft}h left
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

