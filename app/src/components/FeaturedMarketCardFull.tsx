'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { TrendingUp, Clock, ExternalLink } from 'lucide-react';
import CategoryImagePlaceholder from './CategoryImagePlaceholder';
import BondingCurveChart from './BondingCurveChart';
import { motion } from 'framer-motion';

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
}

interface FeaturedMarketCardFullProps {
  market: FeaturedMarket;
}

export default function FeaturedMarketCardFull({ market }: FeaturedMarketCardFullProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="w-full"
    >
      <Link href={`/trade/${market.id}`}>
        <div className="bg-pump-gray border border-gray-700 hover:border-pump-green rounded-xl transition-all duration-300 hover:shadow-2xl cursor-pointer overflow-hidden">
          {/* Desktop Layout */}
          <div className="hidden md:flex h-[500px]">
            {/* Left: Image + Market Info (60%) */}
            <div className="flex-1 p-8 flex flex-col">
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

                  {/* Creator + Social Links */}
                  {market.creator && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-400">
                        Created by <span className="text-white font-semibold">{market.creator}</span>
                      </p>
                      {market.socialLinks && (
                        <div className="flex gap-2 mt-2">
                          {market.socialLinks.twitter && (
                            <a
                              href={market.socialLinks.twitter}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-pump-green transition"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                          {market.socialLinks.telegram && (
                            <a
                              href={market.socialLinks.telegram}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-pump-green transition"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                          {market.socialLinks.website && (
                            <a
                              href={market.socialLinks.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-pump-green transition"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      )}
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

                  {/* YES/NO - Large horizontal */}
                  <div className="flex gap-4 mt-auto">
                    <div className="flex-1 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 hover:bg-blue-500/20 transition">
                      <div className="text-xs text-blue-400 mb-2 font-semibold">YES</div>
                      <div className="text-4xl font-bold text-blue-400">{market.yesPercent}%</div>
                      <div className="text-xs text-gray-500 mt-1">{market.yesSupply.toLocaleString()} shares</div>
                    </div>
                    <div className="flex-1 bg-red-500/10 border border-red-500/30 rounded-xl p-4 hover:bg-red-500/20 transition">
                      <div className="text-xs text-red-400 mb-2 font-semibold">NO</div>
                      <div className="text-4xl font-bold text-red-400">{market.noPercent}%</div>
                      <div className="text-xs text-gray-500 mt-1">{market.noSupply.toLocaleString()} shares</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Bonding Curve Chart (40%) */}
            <div className="w-[40%] bg-pump-dark/50 p-6 border-l border-gray-800 flex items-center">
              <div className="w-full">
                <h3 className="text-sm font-semibold text-gray-400 mb-4">Price History</h3>
                <BondingCurveChart yesSupply={market.yesSupply} noSupply={market.noSupply} />
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
                  <h2 className="text-lg font-bold text-white line-clamp-2 leading-tight">
                    {market.question}
                  </h2>
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-xs text-gray-400 mb-4">
                <div className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-pump-green" />
                  <span className="font-semibold text-white">
                    ${(market.volume / 1_000_000_000).toFixed(0)}k
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>{market.daysLeft}d left</span>
                </div>
              </div>

              {/* YES/NO */}
              <div className="flex gap-3 mb-4">
                <div className="flex-1 bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                  <div className="text-xs text-blue-400 mb-1">YES</div>
                  <div className="text-2xl font-bold text-blue-400">{market.yesPercent}%</div>
                </div>
                <div className="flex-1 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <div className="text-xs text-red-400 mb-1">NO</div>
                  <div className="text-2xl font-bold text-red-400">{market.noPercent}%</div>
                </div>
              </div>

              {/* Chart Mobile */}
              <div className="bg-pump-dark/50 p-4 rounded-lg border border-gray-800">
                <h3 className="text-xs font-semibold text-gray-400 mb-3">Price History</h3>
                <div className="h-48">
                  <BondingCurveChart yesSupply={market.yesSupply} noSupply={market.noSupply} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
