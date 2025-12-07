import { supabase } from '@/utils/supabase';
import MarketCard from '@/components/MarketCard';

export const revalidate = 0; // Disable caching for real-time updates

export default async function HomePage() {
  const { data: markets, error } = await supabase
    .from('markets')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching markets:', error);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">
          Prediction Markets
        </h1>
        <p className="text-gray-600">
          Discover and trade on prediction markets powered by Solana
        </p>
      </div>

      {markets && markets.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {markets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">📊</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            No markets yet
          </h2>
          <p className="text-gray-600 mb-6">
            Be the first to create a prediction market!
          </p>
          <a
            href="/create"
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Create Market
          </a>
        </div>
      )}
    </div>
  );
}
