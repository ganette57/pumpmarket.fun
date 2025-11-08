'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import Link from 'next/link';
import { lamportsToSol } from '@/utils/solana';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (connected && publicKey) {
      loadUserData();
    }
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
