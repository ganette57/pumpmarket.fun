'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import BondingCurveChart from '@/components/BondingCurveChart';
import { lamportsToSol } from '@/utils/solana';
import CreatorSocialLinks from '@/components/CreatorSocialLinks';
import MarketActions from '@/components/MarketActions';
import CommentsSection from '@/components/CommentsSection';
import TradingPanel from '@/components/TradingPanel';
import { SocialLinks } from '@/components/SocialLinksForm';

interface Market {
  publicKey: string;
  question: string;
  description: string;
  creator: string;
  yesSupply: number;
  noSupply: number;
  totalVolume: number;
  resolutionTime: number;
  resolved: boolean;
  winningOutcome?: boolean;
  socialLinks?: SocialLinks;
}

export default function TradePage() {
  const params = useParams();
  const { publicKey, connected } = useWallet();
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [userPosition, setUserPosition] = useState({ yesShares: 0, noShares: 0 });

  useEffect(() => {
    loadMarket();
  }, [params.id]);

  async function loadMarket() {
    try {
      // TODO: Fetch market from program
      const exampleMarket: Market = {
        publicKey: params.id as string,
        question: 'Will SOL reach $500 in 2025?',
        description: 'Market resolves when SOL/USD hits $500 or on Dec 31, 2025',
        creator: 'ExampleCreator...',
        yesSupply: 1000,
        noSupply: 800,
        totalVolume: 50_000_000_000,
        resolutionTime: Math.floor(Date.now() / 1000) + 86400 * 30,
        resolved: false,
        socialLinks: {
          twitter: 'https://x.com/solana',
          telegram: 'https://t.me/solana',
          website: 'https://solana.com',
        },
      };
      setMarket(exampleMarket);
    } catch (error) {
      console.error('Error loading market:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-pump-green"></div>
          <p className="text-gray-400 mt-4">Loading market...</p>
        </div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-xl">Market not found</p>
      </div>
    );
  }

  const totalSupply = market.yesSupply + market.noSupply;
  const yesPercent = totalSupply > 0 ? (market.yesSupply / totalSupply) * 100 : 50;
  const noPercent = 100 - yesPercent;

  async function handleTrade(dollarAmount: number, isYes: boolean) {
    if (!connected || !publicKey) {
      alert('Please connect your wallet');
      return;
    }

    console.log('Trading:', { dollarAmount, isYes });

    try {
      // TODO: Call Solana program to execute trade
      alert(`Demo: Buying $${dollarAmount} of ${isYes ? 'YES' : 'NO'} shares`);
    } catch (error) {
      console.error('Trade failed:', error);
      alert('Trade failed: ' + (error as Error).message);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Market Info */}
        <div className="lg:col-span-2">
          <div className="card-pump mb-6">
            {/* Title with Bookmark + Share */}
            <div className="flex items-start justify-between mb-4">
              <h1 className="text-3xl font-bold text-white flex-1">{market.question}</h1>
              <MarketActions marketId={market.publicKey} question={market.question} />
            </div>

            {/* Creator Social Links */}
            {market.socialLinks && (
              <div className="mb-4">
                <CreatorSocialLinks socialLinks={market.socialLinks} />
              </div>
            )}

            <p className="text-gray-400 mb-6">{market.description}</p>

            {/* Current Odds */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <div className="text-sm text-blue-400 mb-1">YES</div>
                <div className="text-3xl font-bold text-blue-400">{yesPercent.toFixed(1)}%</div>
              </div>
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <div className="text-sm text-red-400 mb-1">NO</div>
                <div className="text-3xl font-bold text-red-400">{noPercent.toFixed(1)}%</div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-700">
              <div>
                <div className="text-xs text-gray-500 mb-1">Volume</div>
                <div className="text-lg font-semibold text-white">
                  {lamportsToSol(market.totalVolume).toFixed(2)} SOL
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">YES Supply</div>
                <div className="text-lg font-semibold text-blue-400">{market.yesSupply}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">NO Supply</div>
                <div className="text-lg font-semibold text-red-400">{market.noSupply}</div>
              </div>
            </div>
          </div>

          {/* Bonding Curve */}
          <div className="card-pump">
            <h2 className="text-xl font-bold text-white mb-4">Bonding Curve</h2>
            <p className="text-sm text-gray-400 mb-4">
              Price increases as more shares are bought. Early buyers get better prices!
            </p>
            <BondingCurveChart currentSupply={market.yesSupply} isYes={true} />
          </div>
        </div>

        {/* Right: Trading Panel */}
        <div className="lg:col-span-1">
          <TradingPanel
            market={{
              yesSupply: market.yesSupply,
              noSupply: market.noSupply,
              resolved: market.resolved,
            }}
            connected={connected}
            onTrade={handleTrade}
          />

          {/* User Position */}
          {connected && (userPosition.yesShares > 0 || userPosition.noShares > 0) && (
            <div className="card-pump mt-6">
              <h3 className="text-white font-semibold mb-3">Your Position</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-blue-400">YES Shares</span>
                  <span className="text-white font-semibold">{userPosition.yesShares}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-400">NO Shares</span>
                  <span className="text-white font-semibold">{userPosition.noShares}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Comments Section - Full Width */}
      <div className="mt-8">
        <CommentsSection marketId={market.publicKey} />
      </div>
    </div>
  );
}
