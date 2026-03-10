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
    imageUrl?: string | null;
    yesSupply: number;
    noSupply: number;
    outcomeNames?: string[];
    outcomeSupplies?: number[];
    resolutionTime: number;
    totalVolume: number;
    resolved: boolean;
  };
  /** If set, shows a LIVE badge linking to /live/[liveSessionId] */
  liveSessionId?: string | null;
  /** Sports live signal from already-loaded home payload (no extra fetch). */
  liveMatch?: boolean;
  /** Sports finished signal from already-loaded home payload (no extra fetch). */
  finishedMatch?: boolean;
  /** Creator profile info (pre-fetched from profiles table). */
  creatorProfile?: {
    display_name?: string | null;
    avatar_url?: string | null;
  } | null;
  /** Creator wallet address (fallback when no profile). */
  creatorAddress?: string | null;
}

export default function MarketCard({ market, liveSessionId, liveMatch = false, finishedMatch = false, creatorProfile, creatorAddress }: MarketCardProps) {
  const now = Date.now() / 1000;
  const daysLeft = Math.max(0, Math.floor((market.resolutionTime - now) / 86400));
  const isEnded = market.resolved || now >= market.resolutionTime;
  const providerLive = liveMatch || !!liveSessionId;
  const providerFinished = finishedMatch;
  const showLiveBadge = providerLive;
  const showEndedBadge = !showLiveBadge && (providerFinished || isEnded);

  // ✅ sanitize category (évite crash quand null/undefined)
  const safeCategoryRaw = (market.category ?? 'other').toString().trim();
  const safeCategory = safeCategoryRaw.length ? safeCategoryRaw : 'other';
  const safeCategoryKey = safeCategory.toLowerCase();

  // ✅ sanitize imageUrl (évite "null" string etc.)
  const safeImageUrl =
    market.imageUrl && market.imageUrl !== 'null' && market.imageUrl !== 'undefined' && market.imageUrl.trim() !== ''
      ? market.imageUrl
      : undefined;

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
          {safeImageUrl ? (
            <Image
              src={safeImageUrl}
              alt={market.question}
              width={300}
              height={200}
              className="object-cover w-full h-full opacity-75 group-hover:opacity-90 transition"
            />
          ) : (
            <div className="flex justify-center items-center w-full h-full opacity-60 scale-[0.6]">
              <CategoryImagePlaceholder category={safeCategoryKey} />
            </div>
          )}
          {/* LIVE BADGE */}
          {showLiveBadge &&
            (liveSessionId ? (
              <Link
                href={`/live/${liveSessionId}`}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-3 right-3 z-10"
              >
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-600 text-white shadow-lg hover:bg-red-500 transition">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  LIVE
                </span>
              </Link>
            ) : (
              <div className="absolute top-3 right-3 z-10">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-red-600 text-white shadow-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  LIVE
                </span>
              </div>
            ))}

          {/* ENDED BADGE */}
          {showEndedBadge && (
            <div className="absolute top-3 right-3 z-10">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-black/80 border border-gray-700 text-gray-200">
                Ended
              </span>
            </div>
          )}

          {/* dark fade bottom */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#05070b] via-transparent" />

          {/* CATEGORY PILL (top-left, fond noir) */}
          <div className="absolute top-3 left-3">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-black/80 border border-gray-700 text-gray-200 shadow-sm">
              {safeCategory}
            </span>
          </div>
        </div>

        {/* CONTENT */}
        <div className="p-4 flex flex-col justify-between h-[170px]">
          {/* TITLE REMONTÉ */}
          <h3 className="font-semibold text-white text-[15px] leading-tight line-clamp-2 group-hover:text-pump-green transition mb-2">
            {market.question}
          </h3>

          {/* OUTCOMES GREEN / RED */}
          <div className="flex gap-2">
            {/* OUTCOME 1 (GREEN) */}
            <div className="flex-1 bg-[#00FF87] rounded-lg p-2 flex flex-col justify-center items-center text-center">
              <span className="text-[11px] uppercase text-black font-bold tracking-wide">
                {outcomes[0].length > 10 ? outcomes[0].slice(0, 8) + '…' : outcomes[0]}
              </span>
              <span className="text-[18px] md:text-[20px] font-bold text-black">
                {percents[0]}%
              </span>
            </div>

            {/* OUTCOME 2 (RED) */}
            <div className="flex-1 bg-red-500 rounded-lg p-2 flex flex-col justify-center items-center text-center">
              <span className="text-[11px] uppercase text-black font-bold tracking-wide">
                {outcomes[1].length > 10 ? outcomes[1].slice(0, 8) + '…' : outcomes[1]}
              </span>
              <span className="text-[18px] md:text-[20px] font-bold text-black">
                {percents[1]}%
              </span>
            </div>
          </div>

          {/* FOOTER */}
          <div className="flex items-center justify-between text-[11px] text-gray-400 mt-3">
            {/* creator */}
            {(creatorProfile?.display_name || creatorAddress) && (
              <div className="flex items-center gap-1 min-w-0 shrink truncate">
                {creatorProfile?.avatar_url ? (
                  <img src={creatorProfile.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full bg-gray-700 flex-shrink-0" />
                )}
                <span className="truncate">
                  {creatorProfile?.display_name
                    ? creatorProfile.display_name
                    : creatorAddress
                    ? `${creatorAddress.slice(0, 4)}…${creatorAddress.slice(-4)}`
                    : ""}
                </span>
              </div>
            )}

            {/* volume */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <TrendingUp className="w-3 h-3 text-pump-green" />
              <span className="font-semibold text-white">
                {volSol.toFixed(2)} SOL
              </span>
            </div>

            {/* time left */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <Clock className="w-3 h-3" />
              <span>{showEndedBadge ? "Ended" : `${daysLeft}d left`}</span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
