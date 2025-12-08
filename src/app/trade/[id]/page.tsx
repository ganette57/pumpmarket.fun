'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { getMarketByAddress, updateMarketStats } from '@/lib/markets';
import { buyShares } from '@/lib/solana';
import { Market } from '@/types/market';
import { formatDistanceToNow } from 'date-fns';

const PLATFORM_WALLET = 'HZXbmim1GCWcg8yyYmADTHALugRfzGqNVTjXkoCkpump'; // Replace with actual platform wallet

export default function TradePage({ params }: { params: { id: string } }) {
  const { publicKey, sendTransaction } = useWallet();
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [trading, setTrading] = useState(false);
  const [amount, setAmount] = useState('');
  const [side, setSide] = useState<'YES' | 'NO'>('YES');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadMarket();
  }, [params.id]);

  const loadMarket = async () => {
    setLoading(true);
    try {
      const data = await getMarketByAddress(params.id);
      if (data) {
        setMarket(data);
      } else {
        setError('Market not found');
      }
    } catch (err) {
      console.error('Error loading market:', err);
      setError('Failed to load market');
    } finally {
      setLoading(false);
    }
  };

  const handleTrade = async () => {
    if (!publicKey || !market) return;

    const tradeAmount = parseFloat(amount);
    if (isNaN(tradeAmount) || tradeAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setError('');
    setSuccess('');
    setTrading(true);

    try {
      console.log(`🔄 Buying ${tradeAmount} SOL of ${side} shares...`);

      // Execute trade with fees (1% creator + 1% platform)
      const signature = await buyShares(
        { publicKey, sendTransaction },
        market.market_address,
        tradeAmount,
        side === 'YES',
        market.creator,
        PLATFORM_WALLET
      );

      console.log('✅ Trade successful:', signature);

      // Update market stats
      const newStats = {
        yes_supply: market.yes_supply + (side === 'YES' ? tradeAmount : 0),
        no_supply: market.no_supply + (side === 'NO' ? tradeAmount : 0),
        total_volume: market.total_volume + tradeAmount,
      };

      await updateMarketStats(market.market_address, newStats);

      setSuccess(`Successfully bought ${tradeAmount} ${side} shares!`);
      setAmount('');

      // Reload market data
      setTimeout(() => {
        loadMarket();
      }, 1000);

    } catch (err: any) {
      console.error('❌ Trade failed:', err);
      setError(`Trade failed: ${err.message || 'Unknown error'}`);
    } finally {
      setTrading(false);
    }
  };

  if (loading) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-center py-16">
          <div className="text-xl">Loading market...</div>
        </div>
      </main>
    );
  }

  if (!market) {
    return (
      <main className="container mx-auto px-4 py-8">
        <div className="text-center py-16">
          <div className="text-xl text-red-400">Market not found</div>
          <a href="/" className="text-primary hover:underline mt-4 inline-block">
            ← Back to markets
          </a>
        </div>
      </main>
    );
  }

  const totalShares = market.yes_supply + market.no_supply;
  const yesPercentage = totalShares > 0 ? (market.yes_supply / totalShares) * 100 : 50;
  const noPercentage = totalShares > 0 ? (market.no_supply / totalShares) * 100 : 50;

  return (
    <main className="container mx-auto px-4 py-8 max-w-4xl">
      <a href="/" className="text-primary hover:underline mb-4 inline-block">
        ← Back to markets
      </a>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Market Info */}
        <div className="lg:col-span-2 space-y-6">
          {market.image_url && (
            <img
              src={market.image_url}
              alt={market.question}
              className="w-full h-64 object-cover rounded-lg"
            />
          )}

          <div>
            <div className="mb-4">
              <span className="text-xs px-2 py-1 bg-secondary/20 text-secondary rounded">
                {market.category}
              </span>
            </div>

            <h1 className="text-3xl font-bold mb-4">{market.question}</h1>

            {market.description && (
              <p className="text-gray-400 mb-4">{market.description}</p>
            )}

            <div className="flex gap-4 text-sm text-gray-400">
              <div>
                <span className="font-semibold text-white">{market.total_volume.toFixed(2)} SOL</span> volume
              </div>
              <div>
                Ends {formatDistanceToNow(new Date(market.end_date), { addSuffix: true })}
              </div>
            </div>
          </div>

          {/* Market Stats */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
            <h3 className="font-semibold mb-4">Market Statistics</h3>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-green-400">YES - {yesPercentage.toFixed(1)}%</span>
                  <span className="text-gray-400">{market.yes_supply.toFixed(2)} shares</span>
                </div>
                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500"
                    style={{ width: `${yesPercentage}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-red-400">NO - {noPercentage.toFixed(1)}%</span>
                  <span className="text-gray-400">{market.no_supply.toFixed(2)} shares</span>
                </div>
                <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${noPercentage}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Trading Panel */}
        <div className="lg:col-span-1">
          <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6 sticky top-4">
            <h3 className="font-semibold mb-4">Trade</h3>

            {!publicKey ? (
              <div className="text-center">
                <p className="text-sm text-gray-400 mb-4">Connect wallet to trade</p>
                <WalletMultiButton />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => setSide('YES')}
                    className={`flex-1 py-3 rounded-lg font-semibold transition ${
                      side === 'YES'
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    YES
                  </button>
                  <button
                    onClick={() => setSide('NO')}
                    className={`flex-1 py-3 rounded-lg font-semibold transition ${
                      side === 'NO'
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    NO
                  </button>
                </div>

                <div>
                  <label className="block text-sm mb-2">Amount (SOL)</label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg focus:border-primary focus:outline-none"
                  />
                </div>

                {amount && parseFloat(amount) > 0 && (
                  <div className="text-xs text-gray-400 space-y-1">
                    <div className="flex justify-between">
                      <span>Creator Fee (1%):</span>
                      <span>{(parseFloat(amount) * 0.01).toFixed(4)} SOL</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Platform Fee (1%):</span>
                      <span>{(parseFloat(amount) * 0.01).toFixed(4)} SOL</span>
                    </div>
                    <div className="flex justify-between font-semibold text-white pt-2 border-t border-gray-700">
                      <span>Total Cost:</span>
                      <span>{(parseFloat(amount) * 1.02).toFixed(4)} SOL</span>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm">
                    {error}
                  </div>
                )}

                {success && (
                  <div className="p-3 bg-green-900/30 border border-green-700 rounded-lg text-green-400 text-sm">
                    {success}
                  </div>
                )}

                <button
                  onClick={handleTrade}
                  disabled={trading || !amount || parseFloat(amount) <= 0}
                  className="w-full py-3 bg-secondary hover:bg-secondary/80 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold transition"
                >
                  {trading ? 'Processing...' : `Buy ${side}`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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
