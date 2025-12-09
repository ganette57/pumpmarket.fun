'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import Image from 'next/image';
import BondingCurveChart from '@/components/BondingCurveChart';
import { lamportsToSol, calculateBuyCost, getUserPositionPDA, PLATFORM_WALLET } from '@/utils/solana';
import { useProgram } from '@/hooks/useProgram';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import CreatorSocialLinks from '@/components/CreatorSocialLinks';
import MarketActions from '@/components/MarketActions';
import CommentsSection from '@/components/CommentsSection';
import TradingPanel from '@/components/TradingPanel';
import CategoryImagePlaceholder from '@/components/CategoryImagePlaceholder';
import { SocialLinks } from '@/components/SocialLinksForm';
import { getMarketByAddress } from '@/lib/markets';

interface Market {
  publicKey: string;
  question: string;
  description: string;
  category?: string;
  imageUrl?: string;
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
  const program = useProgram();
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [userPosition, setUserPosition] = useState({ yesShares: 0, noShares: 0 });
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    loadMarket();
  }, [params.id]);

  async function loadMarket() {
    try {
      const marketAddress = params.id as string;
      
      // Fetch market from Supabase
      const supabaseMarket = await getMarketByAddress(marketAddress);
      
      if (!supabaseMarket) {
        console.error('Market not found in Supabase');
        setLoading(false);
        return;
      }
      
      // Transform to component format
      const transformedMarket: Market = {
        publicKey: supabaseMarket.market_address,
        question: supabaseMarket.question || '',
        description: supabaseMarket.description || '',
        category: supabaseMarket.category || 'other',
        imageUrl: supabaseMarket.image_url || undefined,
        creator: supabaseMarket.creator || '',
        yesSupply: supabaseMarket.yes_supply || 0,
        noSupply: supabaseMarket.no_supply || 0,
        totalVolume: supabaseMarket.total_volume || 0,
        resolutionTime: Math.floor(new Date(supabaseMarket.end_date).getTime() / 1000),
        resolved: supabaseMarket.resolved || false,
      };
      
      setMarket(transformedMarket);
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
    if (!connected || !publicKey || !program) {
      if (!publicKey) alert('Please connect your wallet');
      if (!program) alert('Program not loaded');
      return;
    }

    if (!market) {
      alert('Market not loaded');
      return;
    }

    setBuying(true);
    try {
      const marketPubkey = new PublicKey(params.id as string);
      const [positionPDA] = getUserPositionPDA(marketPubkey, publicKey);
      const creatorPubkey = new PublicKey(market.creator);

      // Convert dollar amount to shares (simplified - using dollarAmount directly)
      // In production, calculate based on bonding curve
      const amountBN = new BN(dollarAmount);

      console.log('Buying shares:', {
        market: marketPubkey.toBase58(),
        position: positionPDA.toBase58(),
        amount: dollarAmount,
        isYes,
        creator: creatorPubkey.toBase58(),
      });

      const tx = await program.methods
        .buyShares(amountBN, isYes)
        .accounts({
          market: marketPubkey,
          buyer: publicKey,
          userPosition: positionPDA,
          creator: creatorPubkey,
          platformWallet: PLATFORM_WALLET,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('Shares bought! Transaction:', tx);

      alert(`Success! 🎉\n\nBought $${dollarAmount} of ${isYes ? 'YES' : 'NO'} shares\n\nTransaction: ${tx.slice(0, 16)}...\n\nView on Explorer: https://explorer.solana.com/tx/${tx}?cluster=devnet`);

      // Reload market data
      await loadMarket();

      // TODO: Fetch user position to update userPosition state

    } catch (error: any) {
      console.error('Buy shares error:', error);

      // Parse error message
      let errorMsg = 'Failed to buy shares';
      if (error.message) {
        if (error.message.includes('insufficient')) {
          errorMsg = 'Insufficient SOL balance. Please add funds to your wallet.';
        } else if (error.message.includes('resolved')) {
          errorMsg = 'Market is already resolved. You cannot buy shares.';
        } else {
          errorMsg = error.message;
        }
      }

      alert(`Error: ${errorMsg}`);
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Market Info */}
        <div className="lg:col-span-2">
          <div className="card-pump mb-6">
            <div className="flex items-start gap-4">
              {/* Image carrée à gauche */}
              <div className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-pump-dark">
                {market.imageUrl ? (
                  <Image
                    src={market.imageUrl}
                    alt={market.question}
                    width={80}
                    height={80}
                    className="object-cover w-full h-full"
                  />
                ) : (
                  <CategoryImagePlaceholder category={market.category || 'crypto'} className="w-full h-full scale-[0.4]" />
                )}
              </div>

              {/* Titre + Bookmark/Share à droite de l'image */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between mb-3">
                  <h1 className="text-3xl font-bold text-white flex-1 leading-tight">{market.question}</h1>
                  <MarketActions marketId={market.publicKey} question={market.question} />
                </div>

                {/* Creator Social Links */}
                {market.socialLinks && (
                  <div className="mb-0">
                    <CreatorSocialLinks socialLinks={market.socialLinks} />
                  </div>
                )}
              </div>
            </div>

            {/* Volume + Time left */}
            <div className="flex gap-4 text-sm text-gray-400 mt-4 pt-4 border-t border-gray-800">
              <div>
                <span className="text-gray-500">
                  ${(lamportsToSol(market.totalVolume) / 1000).toFixed(0)}k Vol
                </span>
              </div>
              <div>
                {new Date(market.resolutionTime * 1000).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
            </div>

            <p className="text-gray-400 mt-4 mb-6">{market.description}</p>

            {/* Current Odds */}
            <div className="grid grid-cols-2 gap-4">
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