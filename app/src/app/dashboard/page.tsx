// app/src/app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { Heart, ExternalLink } from "lucide-react";

import { lamportsToSol } from "@/utils/format";
import { getMarketsByCreator, getTransactionsByUser, type DbTransaction } from "@/lib/markets";

interface UserMarket {
  publicKey: string;
  question: string;
  totalVolume: number; // lamports
  feesCollected: number; // lamports (estimate)
  resolved: boolean;
  resolutionTime: number;
}

export default function Dashboard() {
  const { publicKey, connected } = useWallet();

  const [myMarkets, setMyMarkets] = useState<UserMarket[]>([]);
  const [bookmarkedMarketIds, setBookmarkedMarketIds] = useState<string[]>([]);
  const [myTxs, setMyTxs] = useState<DbTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  const FEE_RATE = 0.02; // UI estimate only

  useEffect(() => {
    if (connected && publicKey) {
      void loadUserData();
    } else {
      setLoading(false);
    }
    loadBookmarkedMarkets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toBase58()]);

  async function loadUserData() {
    try {
      if (!publicKey) return;

      setLoading(true);

      const createdMarkets = await getMarketsByCreator(publicKey.toBase58());

      const transformedMarkets: UserMarket[] = createdMarkets.map((m: any) => {
        const totalVol = Number(m.total_volume) || 0;
        const feesEstLamports = Math.floor(totalVol * FEE_RATE);

        return {
          publicKey: m.market_address,
          question: m.question,
          totalVolume: totalVol,
          feesCollected: feesEstLamports,
          resolved: !!m.resolved,
          resolutionTime: Math.floor(new Date(m.end_date).getTime() / 1000),
        };
      });

      setMyMarkets(transformedMarkets);

      // user tx (RLS must be off or proper policy)
      const txs = await getTransactionsByUser(publicKey.toBase58());
      setMyTxs(txs);
    } catch (error) {
      console.error("Error loading user data:", error);
    } finally {
      setLoading(false);
    }
  }

  function loadBookmarkedMarkets() {
    try {
      const savedMarkets = localStorage.getItem("savedMarkets");
      if (savedMarkets) setBookmarkedMarketIds(JSON.parse(savedMarkets));
    } catch (error) {
      console.error("Error loading bookmarked markets:", error);
    }
  }

  function removeBookmark(marketId: string) {
    try {
      const updated = bookmarkedMarketIds.filter((id) => id !== marketId);
      localStorage.setItem("savedMarkets", JSON.stringify(updated));
      setBookmarkedMarketIds(updated);
    } catch (error) {
      console.error("Error removing bookmark:", error);
    }
  }

  const feesTotalSol = useMemo(() => {
    const totalLamports = myMarkets.reduce((sum, m) => sum + (Number(m.feesCollected) || 0), 0);
    return lamportsToSol(totalLamports);
  }, [myMarkets]);

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
      <div className="flex items-end justify-between gap-4 mb-8">
        <h1 className="text-4xl font-bold text-white">Dashboard</h1>
        <div className="text-right">
          <div className="text-xs text-gray-500">Fees earned (UI estimate)</div>
          <div className="text-lg font-bold text-pump-green">{feesTotalSol.toFixed(4)} SOL</div>
        </div>
      </div>

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
                <div className="flex justify-between items-start mb-2 gap-4">
                  <div className="flex-1">
                    <Link href={`/trade/${market.publicKey}`}>
                      <h3 className="text-xl font-bold text-white mb-2 hover:text-pump-green transition cursor-pointer">
                        {market.question}
                      </h3>
                    </Link>

                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                      <div>
                        <span className="text-gray-500">Volume:</span>{" "}
                        <span className="text-white font-semibold">{lamportsToSol(market.totalVolume).toFixed(2)} SOL</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Fees Earned:</span>{" "}
                        <span className="text-pump-green font-semibold">{lamportsToSol(market.feesCollected).toFixed(4)} SOL</span>
                      </div>
                    </div>
                  </div>

                  {market.resolved && <span className="text-pump-green font-semibold">RESOLVED</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved Markets */}
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
                    <p className="text-xs text-gray-500">Click "View Market" to see full details and trade</p>
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

      {/* Transactions */}
      <div className="mb-12">
        <h2 className="text-2xl font-bold text-white mb-6">My Transactions</h2>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-pump-green"></div>
          </div>
        ) : myTxs.length === 0 ? (
          <div className="card-pump text-center py-12">
            <p className="text-gray-400 mb-2">No transactions yet</p>
            <Link href="/">
              <button className="btn-pump">Browse Markets</button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {myTxs.map((tx) => (
              <div key={tx.id ?? tx.tx_signature} className="card-pump">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-white font-semibold">
                      {tx.is_buy ? "BUY" : "SELL"} • {tx.is_yes ? "YES" : "NO"} • {Number(tx.amount) || 0} shares
                    </div>
                    <div className="text-xs text-gray-500 mt-1 truncate">
                      {tx.tx_signature}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-pump-green font-bold">{Number(tx.cost || 0).toFixed(4)} SOL</div>
                    <div className="text-xs text-gray-500">{tx.created_at ? new Date(tx.created_at).toLocaleString() : ""}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notice */}
      <div className="mt-12 card-pump bg-pump-dark border-pump-green">
        <h3 className="text-xl font-bold text-white mb-2">Coming in V1: Chainlink Oracle</h3>
        <p className="text-gray-400">Automated market resolution using Chainlink Data Feeds (BTC/USD, ETH/USD, SOL/USD…).</p>
      </div>
    </div>
  );
}