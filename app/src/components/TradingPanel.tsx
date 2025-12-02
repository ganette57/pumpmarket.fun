'use client';

import { useState } from 'react';
import { calculateBuyCost, lamportsToSol } from '@/utils/solana';

interface TradingPanelProps {
  market: {
    yesSupply: number;
    noSupply: number;
    resolved: boolean;
  };
  connected: boolean;
  onTrade: (amount: number, isYes: boolean) => void;
}

export default function TradingPanel({ market, connected, onTrade }: TradingPanelProps) {
  const [activeTab, setActiveTab] = useState<'yes' | 'no'>('yes');
  const [dollarAmount, setDollarAmount] = useState(20);

  const totalSupply = market.yesSupply + market.noSupply;
  const yesPercent = totalSupply > 0 ? (market.yesSupply / totalSupply) * 100 : 50;
  const noPercent = 100 - yesPercent;

  const currentSupply = activeTab === 'yes' ? market.yesSupply : market.noSupply;

  // Calculate cost in SOL for the dollar amount
  const costInSol = calculateBuyCost(currentSupply, dollarAmount);

  // Calculate average price per share
  const avgPrice = costInSol / dollarAmount;

  // Calculate potential win
  // Each share is worth 1 SOL if it wins
  // Potential win = (shares * 1 SOL) - cost
  const sharesWon = dollarAmount / avgPrice;
  const potentialWin = (sharesWon * 1.0) - dollarAmount;
  const returnPercent = (potentialWin / dollarAmount) * 100;

  const handleQuickAmount = (value: number) => {
    setDollarAmount(value);
  };

  const handleTrade = () => {
    onTrade(dollarAmount, activeTab === 'yes');
  };

  return (
    <div className="card-pump sticky top-20">
      {/* Outcome Buttons */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setActiveTab('yes')}
          className={`flex flex-col items-center justify-center py-4 rounded-xl font-bold transition-all ${
            activeTab === 'yes'
              ? 'bg-blue-600 text-white shadow-lg scale-105'
              : 'bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30'
          }`}
        >
          <span className="text-sm mb-1">YES</span>
          <span className="text-2xl">{yesPercent.toFixed(0)}¢</span>
        </button>
        <button
          onClick={() => setActiveTab('no')}
          className={`flex flex-col items-center justify-center py-4 rounded-xl font-bold transition-all ${
            activeTab === 'no'
              ? 'bg-red-600 text-white shadow-lg scale-105'
              : 'bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30'
          }`}
        >
          <span className="text-sm mb-1">NO</span>
          <span className="text-2xl">{noPercent.toFixed(0)}¢</span>
        </button>
      </div>

      {/* Amount Display - Big Number */}
      <div className="mb-4">
        <div className="text-right">
          <div className="text-5xl md:text-6xl font-bold text-white tabular-nums">
            ${dollarAmount.toFixed(2)}
          </div>
          <div className="text-sm text-gray-500 mt-1">
            {sharesWon.toFixed(0)} shares @ {avgPrice.toFixed(3)} SOL each
          </div>
        </div>
      </div>

      {/* Quick Amount Buttons */}
      <div className="flex gap-2 justify-end mb-6">
        <button
          onClick={() => handleQuickAmount(1)}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition text-sm"
        >
          +$1
        </button>
        <button
          onClick={() => handleQuickAmount(20)}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition text-sm"
        >
          +$20
        </button>
        <button
          onClick={() => handleQuickAmount(100)}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition text-sm"
        >
          +$100
        </button>
        <button
          onClick={() => handleQuickAmount(1000)}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition text-sm"
        >
          Max
        </button>
      </div>

      {/* Potential Win Display */}
      <div className="bg-pump-dark rounded-xl p-4 mb-6">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-gray-400 text-sm mb-1">Potential win 💸</p>
            <p className="text-xs text-gray-500">
              Avg. price {avgPrice.toFixed(3)} SOL
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-pump-green">
              ${potentialWin.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500">
              +{returnPercent.toFixed(0)}% return
            </div>
          </div>
        </div>
      </div>

      {/* Cost Breakdown */}
      <div className="bg-pump-dark/50 rounded-lg p-3 mb-6">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-500">Cost</span>
          <span className="text-white font-semibold">{costInSol.toFixed(4)} SOL</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">Includes 2% fee</span>
          <span className="text-gray-500">{(costInSol * 0.02).toFixed(4)} SOL</span>
        </div>
      </div>

      {/* Trade Button */}
      {!connected ? (
        <div className="text-center p-4 bg-pump-dark rounded-xl">
          <p className="text-gray-400">Connect wallet to trade</p>
        </div>
      ) : market.resolved ? (
        <div className="text-center p-4 bg-pump-dark rounded-xl">
          <p className="text-gray-400">Market resolved</p>
        </div>
      ) : (
        <button
          onClick={handleTrade}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            activeTab === 'yes'
              ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg hover:shadow-xl'
              : 'bg-red-600 hover:bg-red-500 text-white shadow-lg hover:shadow-xl'
          }`}
        >
          Buy {activeTab.toUpperCase()}
        </button>
      )}
    </div>
  );
}
