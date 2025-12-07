'use client';

import Link from 'next/link';
import type { Market } from '@/types/database.types';
import BookmarkButton from './BookmarkButton';

interface MarketCardProps {
  market: Market;
  showBookmark?: boolean;
}

export default function MarketCard({ market, showBookmark = true }: MarketCardProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const getDaysLeft = () => {
    const endDate = new Date(market.end_date);
    const now = new Date();
    const diffTime = endDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const daysLeft = getDaysLeft();
  const isExpired = daysLeft < 0;

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      {market.image_url && (
        <div className="h-48 overflow-hidden">
          <img
            src={market.image_url}
            alt={market.question}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <h3 className="text-xl font-bold text-gray-900 flex-1">
            {market.question}
          </h3>
          {market.category && (
            <span className="px-3 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full whitespace-nowrap">
              {market.category}
            </span>
          )}
        </div>

        {market.description && (
          <p className="text-gray-600 mb-4 line-clamp-2">{market.description}</p>
        )}

        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Total Volume:</span>
            <span className="font-semibold">{market.total_volume} SOL</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Created by:</span>
            <span className="font-mono text-xs">{formatAddress(market.creator)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">End Date:</span>
            <span className={isExpired ? 'text-red-600' : 'text-gray-900'}>
              {formatDate(market.end_date)}
            </span>
          </div>
          {!isExpired && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Days Left:</span>
              <span className="font-semibold text-green-600">{daysLeft} days</span>
            </div>
          )}
        </div>

        {market.resolved && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm font-medium text-green-800">
              Resolved: {market.resolution_result ? 'YES' : 'NO'}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Link
            href={`/market/${market.market_address}`}
            className="flex-1 px-4 py-2 bg-blue-600 text-white text-center rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            View Market
          </Link>
          {showBookmark && <BookmarkButton marketId={market.id} />}
        </div>
      </div>
    </div>
  );
}
