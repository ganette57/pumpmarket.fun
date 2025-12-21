'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Clock, TrendingUp } from 'lucide-react';
import { lamportsToSol } from '@/utils/solana';
import CategoryImagePlaceholder from './CategoryImagePlaceholder';

interface MarketCardProps {
  market: {
    publicKey: string;
    question: string;
    description?: string;
    category: string;
    imageUrl?: string;
    yesSupply: number;
    noSupply: number;
    outcomeNames?: string[];
    outcomeSupplies?: number[];
    resolutionTime: number;
    totalVolume: number;
    resolved: boolean;
  };
}

export default function MarketCard({ market }: MarketCardProps) {
  const now = Date.now() / 1000;
  const daysLeft = Math.max(0, Math.floor((market.resolutionTime - now) / 86400));

  // outcomes ----------------------------
  let outcomes =
    market.outcomeNames && market.outcomeNames.length >= 2
      ? market.outcomeNames
      : ['YES', 'NO'];

  let supplies =
    market.outcomeSupplies && market.outcomeSupplies.length >= 2
      ? market.outcomeSupplies.map(Number)
      : [market.yesSupply || 0, market.noSupply || 0];

  const totalSupply = supplies.reduce((a, b) => a + b, 0);
  const percents = supplies.map((s) =>
    totalSupply > 0 ? ((s / totalSupply) * 100).toFixed(0) : '50'
  );

  const volSol = lamportsToSol(market.totalVolume);

  return (
    <Link href={`/trade/${market.publicKey}`} className="block group h-full">
      <article className="relative rounded-xl overflow-hidden border border-gray-800 bg-[#05070b] hover:border-pump-green hover:shadow-xl transition-all h-full">
        {/* IMAGE + CATEGORY BADGE */}
        <div className="relative w-full h-40 overflow-hidden bg-black">
          {market.imageUrl ? (
            <Image
              src={market.imageUrl}
              alt={market.question}
              width={300}
              height={200}
              className="object-cover w-full h-full opacity-75 group-hover:opacity-90 transition"
            />
          ) : (
            <div className="flex justify-center items-center w-full h-full opacity-60 scale-[0.6]">
              <CategoryImagePlaceholder category={market.category.toLowerCase()} />
            </div>
          )}

          {/* dark fade bottom */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#05070b] via-transparent" />

          {/* CATEGORY PILL (top-left, fond noir) */}
          <div className="absolute top-3 left-3">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-black/80 border border-gray-700 text-gray-200 shadow-sm">
              {market.category}
            </span>
          </div>
        </div>

        {/* CONTENT */}
        <div className="p-4 flex flex-col justify-between h-[170px]">
          {/* TITLE REMONTÉ */}
          <h3 className="font-semibold text-white text-[15px] leading-tight line-clamp-2 group-hover:text-pump-green transition mb-1">
            {market.question}
          </h3>

          {market.description && (
            <p className="text-[11px] text-gray-500 line-clamp-1 mb-2">
              {market.description}
            </p>
          )}

          {/* OUTCOMES GREEN / RED */}
          <div className="flex mt-1 gap-2">
            {/* OUTCOME 1 (GREEN) */}
            <div className="flex-1 bg-green-500/15 border border-green-500/30 rounded-lg p-2 flex flex-col justify-center items-center text-center">
              <span className="text-[11px] uppercase text-green-400 font-semibold tracking-wide">
                {outcomes[0].length > 10 ? outcomes[0].slice(0, 8) + '…' : outcomes[0]}
              </span>
              <span className="text-[18px] md:text-[20px] font-semibold text-green-400">
                {percents[0]}%
              </span>
            </div>

            {/* OUTCOME 2 (RED) */}
            <div className="flex-1 bg-red-500/15 border border-red-500/30 rounded-lg p-2 flex flex-col justify-center items-center text-center">
              <span className="text-[11px] uppercase text-red-400 font-semibold tracking-wide">
                {outcomes[1].length > 10 ? outcomes[1].slice(0, 8) + '…' : outcomes[1]}
              </span>
              <span className="text-[18px] md:text-[20px] font-semibold text-red-400">
                {percents[1]}%
              </span>
            </div>
          </div>

          {/* FOOTER */}
          <div className="flex items-center justify-between text-[11px] text-gray-400 mt-3">
            {/* volume */}
            <div className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-pump-green" />
              <span className="font-semibold text-white">
                {volSol.toFixed(2)} SOL
              </span>
            </div>

            {/* time left */}
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{daysLeft}d left</span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}