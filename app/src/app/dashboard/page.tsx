'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import Link from 'next/link';
import { lamportsToSol } from '@/utils/solana';
import { Heart, ExternalLink } from 'lucide-react';

interface UserMarket {
  publicKey: string;
  question: string;
  totalVolume: number;
  feesCollected: number;
  resolved: boolean;
  resolutionTime: number;
}

interface UserPosition {
  marketKey: string;
  question: string;
  yesShares: number;
  noShares: number;
  resolved: boolean;
  winningOutcome?: boolean;
}

export default function Dashboard() {
  const { publicKey, connected } = useWallet();
  const [myMarkets, setMyMarkets] = useState<UserMarket[]>([]);
  const [myPositions, setMyPositions] = useState<UserPosition[]>([]);
  const [bookmarkedMarketIds, setBookmarkedMarketIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (connected && publicKey) {
      loadUserData();
    }
    loadBookmarkedMarkets();
  }, [connected, publicKey]);

  async function loadUserData() {
    try {
      // TODO: Fetch user's markets and positions from program
      setMyMarkets([]);
      setMyPositions([]);
    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      setLoading(false);
    }
  }

  function loadBookmarkedMarkets() {
    try {
      const savedMarkets = localStorage.getItem('savedMarkets');
      if (savedMarkets) {
        setBookmarkedMarketIds(JSON.parse(savedMarkets));
      }
    } catch (error) {
      console.error('Error loading bookmarked markets:', error);
    }
  }

  function removeBookmark(marketId: string) {
    try {
      const updatedMarkets = bookmarkedMarketIds.filter((id) => id !== marketId);
      localStorage.setItem('savedMarkets', JSON.stringify(updatedMarkets));
      setBookmarkedMarketIds(updatedMarkets);
    } catch (error) {
      console.error('Error removing bookmark:', error);
    }
  }

  async function resolveMarket(marketKey: string, yesWins: boolean) {
    try {
      // TODO: Call Solana program to resolve
      console.log('Resolving market:', marketKey, 'YES wins:', yesWins);
      alert(`Resolving market (Demo mode)`);
    } catch (error) {
      console.error('Error resolving market:', error);
      alert('Error: ' + (error as Error).message);
    }
  }

  async function claimWinnings(marketKey: string) {
    try {
      // TODO: Call Solana program to claim
      console.log('Claiming winnings for market:', marketKey);
      alert('Claiming winnings (Demo mode)');
    } catch (error) {
      console.error('Error claiming winnings:', error);
      alert('Error: ' + (error as Error).message);
    }
  }

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-4">Connect Wallet</h1>
          <p className="text-gray-400">Connect your wallet to view your dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-bold text-white mb-8">Dashboard</h1>

      {/* My Markets */}
      <div className="mb-12">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">My Markets</h2>
          <Link href="/create">
            <button className="btn-pump">Create Market</button>
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-pump-green"></div>
          </div>
        ) : myMarkets.length === 0 ? (
          <div className="card-pump text-center py-12">
            <p className="text-gray-400 mb-4">You haven't created any markets yet</p>
            <Link href="/create">
              <button className="btn-pump">Create Your First Market</button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {myMarkets.map((market) => (
              <div key={market.publicKey} className="card-pump">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-white mb-2">{market.question}</h3>
                    <div className="flex space-x-6 text-sm">
                      <div>
                        <span className="text-gray-500">Volume:</span>{' '}
                        <span className="text-white font-semibold">
                          {lamportsToSol(market.totalVolume).toFixed(2)} SOL
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Fees Earned:</span>{' '}
                        <span className="text-pump-green font-semibold">
                          {lamportsToSol(market.feesCollected).toFixed(4)} SOL
                        </span>
                      </div>
                    </div>
                  </div>
                  {!market.resolved && Date.now() / 1000 >= market.resolutionTime && (
                    <div className="flex space-x-2">
                      <button
                        onClick={() => resolveMarket(market.publicKey, true)}
                        className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 font-semibold"
                      >
                        Resolve YES
                      </button>
                      <button
                        onClick={() => resolveMarket(market.publicKey, false)}
                        className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 font-semibold"
                      >
                        Resolve NO
                      </button>
                    </div>
                  )}
                  {market.resolved && (
                    <span className="text-pump-green font-semibold">RESOLVED</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bookmarked Markets */}
      <div className="mb-12">
        <div className="flex items-center space-x-2 mb-6">
          <Heart className="w-6 h-6 text-pump-green fill-pump-green" />
          <h2 className="text-2xl font-bold text-white">Saved Markets</h2>
        </div>

        {bookmarkedMarketIds.length === 0 ? (
          <div className="card-pump text-center py-12">
            <Heart className="w-16 h-16 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-400 mb-4">No saved markets yet</p>
            <p className="text-gray-500 text-sm mb-4">
              Click the <Heart className="w-4 h-4 inline" /> icon on any market to save it here
            </p>
            <Link href="/">
              <button className="btn-pump">Browse Markets</button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {bookmarkedMarketIds.map((marketId) => (
              <div key={marketId} className="card-pump">
                <div className="flex justify-between items-center">
                  <div className="flex-1">
                    <p className="text-white font-semibold mb-1">Market ID: {marketId.slice(0, 20)}...</p>
                    <p className="text-xs text-gray-500">
                      Click "View Market" to see full details and trade
                    </p>
                  </div>
                  <div className="flex items-center space-x-3">
                    <Link href={`/trade/${marketId}`}>
                      <button className="btn-pump px-4 py-2 text-sm flex items-center space-x-2">
                        <span>View Market</span>
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    </Link>
                    <button
                      onClick={() => removeBookmark(marketId)}
                      className="w-10 h-10 rounded-full bg-pump-gray border border-gray-700 hover:border-pump-red text-gray-400 hover:text-pump-red transition flex items-center justify-center"
                      title="Remove bookmark"
                    >
                      <Heart className="w-5 h-5 fill-current" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Positions */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-6">My Positions</h2>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-pump-green"></div>
          </div>
        ) : myPositions.length === 0 ? (
          <div className="card-pump text-center py-12">
            <p className="text-gray-400 mb-4">You don't have any positions yet</p>
            <Link href="/">
              <button className="btn-pump">Browse Markets</button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {myPositions.map((position) => (
              <div key={position.marketKey} className="card-pump">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-white mb-3">{position.question}</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                        <div className="text-xs text-blue-400 mb-1">YES Shares</div>
                        <div className="text-xl font-bold text-blue-400">{position.yesShares}</div>
                      </div>
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <div className="text-xs text-red-400 mb-1">NO Shares</div>
                        <div className="text-xl font-bold text-red-400">{position.noShares}</div>
                      </div>
                    </div>
                  </div>
                  {position.resolved && (
                    <button
                      onClick={() => claimWinnings(position.marketKey)}
                      className="btn-pump ml-4"
                    >
                      Claim Winnings
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chainlink Integration Notice */}
      <div className="mt-12 card-pump bg-pump-dark border-pump-green">
        <h3 className="text-xl font-bold text-white mb-2">Coming in V1: Chainlink Oracle</h3>
        <p className="text-gray-400">
          Automated market resolution using Chainlink Data Feeds for BTC/USD, ETH/USD, SOL/USD and more.
          No more manual resolution needed!
        </p>
      </div>
    </div>
  );
}
