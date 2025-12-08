import { getAllMarkets } from '@/lib/markets';
import { Market } from '@/types/market';
import { formatDistanceToNow } from 'date-fns';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const markets = await getAllMarkets();

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Active Prediction Markets</h1>
        <p className="text-gray-400">Trade on outcomes. Powered by Solana.</p>
      </div>

      {markets.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-xl text-gray-400 mb-4">No markets yet</p>
          <a
            href="/create"
            className="inline-block px-6 py-3 bg-secondary hover:bg-secondary/80 rounded-lg transition"
          >
            Create the first market
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {markets.map((market: Market) => (
            <a
              key={market.market_address}
              href={`/trade/${market.market_address}`}
              className="block p-6 bg-gray-900/50 border border-gray-800 rounded-lg hover:border-primary transition group"
            >
              {market.image_url && (
                <img
                  src={market.image_url}
                  alt={market.question}
                  className="w-full h-48 object-cover rounded-lg mb-4"
                />
              )}

              <div className="mb-2">
                <span className="text-xs px-2 py-1 bg-secondary/20 text-secondary rounded">
                  {market.category}
                </span>
              </div>

              <h3 className="text-xl font-bold mb-2 group-hover:text-primary transition">
                {market.question}
              </h3>

              {market.description && (
                <p className="text-gray-400 text-sm mb-4 line-clamp-2">
                  {market.description}
                </p>
              )}

              <div className="flex justify-between items-center text-sm">
                <div>
                  <span className="text-gray-500">Volume:</span>
                  <span className="ml-2 font-semibold text-primary">
                    {market.total_volume.toFixed(2)} SOL
                  </span>
                </div>
                <div className="text-gray-500">
                  Ends {formatDistanceToNow(new Date(market.end_date), { addSuffix: true })}
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <div className="flex-1 text-center py-2 bg-green-900/30 rounded">
                  <div className="text-green-400 font-bold">YES</div>
                  <div className="text-xs text-gray-400">{market.yes_supply} shares</div>
                </div>
                <div className="flex-1 text-center py-2 bg-red-900/30 rounded">
                  <div className="text-red-400 font-bold">NO</div>
                  <div className="text-xs text-gray-400">{market.no_supply} shares</div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* FORCE REFRESH BUTTON FOR DEV */}
      {process.env.NODE_ENV === 'development' && (
        <button
          onClick={() => window.location.reload()}
          className="fixed bottom-4 right-4 bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg shadow-lg z-50 font-semibold"
        >
          FORCE REFRESH
        </button>
      )}
    </main>
  );
}
