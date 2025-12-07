import { supabase } from '@/utils/supabase';
import { notFound } from 'next/navigation';
import BookmarkButton from '@/components/BookmarkButton';
import CommentsSection from '@/components/CommentsSection';

export const revalidate = 0;

interface MarketPageProps {
  params: {
    address: string;
  };
}

export default async function MarketPage({ params }: MarketPageProps) {
  const { address } = params;

  const { data: market, error } = await supabase
    .from('markets')
    .select('*')
    .eq('market_address', address)
    .single();

  if (error || !market) {
    notFound();
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
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

  const socialLinks = market.social_links as { twitter?: string; website?: string; discord?: string } | null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Market Header */}
      <div className="bg-white rounded-lg shadow-md p-8 mb-8">
        {market.image_url && (
          <div className="mb-6 rounded-lg overflow-hidden">
            <img
              src={market.image_url}
              alt={market.question}
              className="w-full h-64 object-cover"
            />
          </div>
        )}

        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="text-3xl font-bold text-gray-900 flex-1">
            {market.question}
          </h1>
          {market.category && (
            <span className="px-4 py-2 text-sm font-medium bg-blue-100 text-blue-800 rounded-full whitespace-nowrap">
              {market.category}
            </span>
          )}
        </div>

        {market.description && (
          <p className="text-gray-700 mb-6 text-lg">{market.description}</p>
        )}

        {/* Market Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-600 mb-1">Total Volume</div>
            <div className="text-2xl font-bold text-gray-900">
              {market.total_volume} SOL
            </div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-600 mb-1">End Date</div>
            <div className="text-lg font-semibold text-gray-900">
              {formatDate(market.end_date)}
            </div>
            {!isExpired && (
              <div className="text-sm text-green-600 mt-1">
                {daysLeft} days remaining
              </div>
            )}
            {isExpired && (
              <div className="text-sm text-red-600 mt-1">Expired</div>
            )}
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-600 mb-1">Creator</div>
            <div className="text-sm font-mono text-gray-900">
              {formatAddress(market.creator)}
            </div>
          </div>
        </div>

        {/* Resolution Status */}
        {market.resolved && (
          <div className="mb-6 p-4 bg-green-50 border-2 border-green-200 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-2xl">✅</span>
              <div>
                <div className="font-bold text-green-900 text-lg">
                  Market Resolved
                </div>
                <div className="text-green-700">
                  Outcome: <span className="font-semibold">
                    {market.resolution_result ? 'YES' : 'NO'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Social Links */}
        {socialLinks && Object.values(socialLinks).some(link => link) && (
          <div className="mb-6">
            <div className="text-sm font-medium text-gray-700 mb-2">Links:</div>
            <div className="flex gap-3">
              {socialLinks.twitter && (
                <a
                  href={socialLinks.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-600"
                >
                  Twitter
                </a>
              )}
              {socialLinks.website && (
                <a
                  href={socialLinks.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-600"
                >
                  Website
                </a>
              )}
              {socialLinks.discord && (
                <a
                  href={socialLinks.discord}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:text-blue-600"
                >
                  Discord
                </a>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={market.resolved || isExpired}
          >
            Buy YES
          </button>
          <button
            className="flex-1 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={market.resolved || isExpired}
          >
            Buy NO
          </button>
          <BookmarkButton marketId={market.id} />
        </div>
      </div>

      {/* Comments Section */}
      <div className="bg-white rounded-lg shadow-md p-8">
        <CommentsSection marketId={market.id} />
      </div>
    </div>
  );
}
