"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateBuyCost } from "@/utils/solana";

type MarketForTrade = {
  resolved: boolean;

  // binary legacy
  yesSupply?: number;
  noSupply?: number;

  // multi
  marketType?: number; // 0=binary, 1=multi
  outcomeNames?: string[];
  outcomeSupplies?: number[];
};

interface TradingPanelProps {
  market: MarketForTrade;
  connected: boolean;
  submitting?: boolean;
  onTrade: (shares: number, outcomeIndex: number, side: "buy" | "sell") => void;
}

export default function TradingPanel({ market, connected, submitting, onTrade }: TradingPanelProps) {
  const outcomes = useMemo(() => {
    const names = (market.outcomeNames || []).map(String).filter(Boolean);
    if (names.length >= 2) return names.slice(0, 10);
    return ["YES", "NO"];
  }, [market.outcomeNames]);

  const supplies = useMemo(() => {
    const arr = Array.isArray(market.outcomeSupplies) ? market.outcomeSupplies : [];
    if (arr.length >= outcomes.length) return arr.slice(0, outcomes.length).map((x) => Number(x || 0));

    if (outcomes.length === 2) return [Number(market.yesSupply || 0), Number(market.noSupply || 0)];
    return Array(outcomes.length).fill(0);
  }, [market.outcomeSupplies, market.yesSupply, market.noSupply, outcomes]);

  const totalSupply = supplies.reduce((sum, x) => sum + (x || 0), 0);
  const probs = supplies.map((s) => (totalSupply > 0 ? (s / totalSupply) * 100 : 100 / supplies.length));

  const isTwoOutcomes = outcomes.length === 2;

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [shares, setShares] = useState<number>(20);
  const [side, setSide] = useState<"buy" | "sell">("buy");

  useEffect(() => {
    if (selectedIndex > outcomes.length - 1) setSelectedIndex(0);
  }, [outcomes.length, selectedIndex]);

  const safeShares = useMemo(() => Math.max(1, Math.floor(shares || 0)), [shares]);
  const currentSupply = supplies[selectedIndex] || 0;

  // estimate buy cost
  const buyCostSol = useMemo(() => {
    return calculateBuyCost(currentSupply, safeShares);
  }, [currentSupply, safeShares]);

  // estimate sell receive (reverse integral)
  const sellReceiveSol = useMemo(() => {
    const start = Math.max(0, currentSupply - safeShares);
    return calculateBuyCost(start, safeShares);
  }, [currentSupply, safeShares]);

  const estCostSol = side === "buy" ? buyCostSol : sellReceiveSol;
  const avgPrice = useMemo(() => (safeShares > 0 ? estCostSol / safeShares : 0), [estCostSol, safeShares]);

  // simple “if wins, payout = shares * 1 SOL”
  const profitIfWin = useMemo(() => safeShares * 1 - buyCostSol, [safeShares, buyCostSol]);

  const roi = useMemo(() => {
    if (buyCostSol <= 0) return 0;
    return (profitIfWin / buyCostSol) * 100;
  }, [profitIfWin, buyCostSol]);

  const handleQuickAmount = (value: number) => setShares(value);
  const handleTrade = () => onTrade(safeShares, selectedIndex, side);

  const isBinaryStyle = isTwoOutcomes;

  return (
    <div className="card-pump sticky top-20">
      {/* Buy / Sell toggle */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setSide("buy")}
          className={`py-2 rounded-lg font-semibold transition ${
            side === "buy" ? "bg-pump-green text-black" : "bg-pump-dark/60 text-gray-300 hover:bg-pump-dark"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide("sell")}
          className={`py-2 rounded-lg font-semibold transition ${
            side === "sell" ? "bg-gray-200 text-black" : "bg-pump-dark/60 text-gray-300 hover:bg-pump-dark"
          }`}
        >
          Sell
        </button>
      </div>

      {/* Outcome selector */}
      {isBinaryStyle ? (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            onClick={() => setSelectedIndex(0)}
            className={`flex flex-col items-center justify-center py-4 rounded-xl font-bold transition-all ${
              selectedIndex === 0
                ? "bg-blue-600 text-white shadow-lg scale-105"
                : "bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30"
            }`}
          >
            <span className="text-sm mb-1">{outcomes[0]}</span>
            <span className="text-2xl">{(probs[0] ?? 0).toFixed(0)}¢</span>
          </button>

          <button
            onClick={() => setSelectedIndex(1)}
            className={`flex flex-col items-center justify-center py-4 rounded-xl font-bold transition-all ${
              selectedIndex === 1
                ? "bg-red-600 text-white shadow-lg scale-105"
                : "bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30"
            }`}
          >
            <span className="text-sm mb-1">{outcomes[1]}</span>
            <span className="text-2xl">{(probs[1] ?? 0).toFixed(0)}¢</span>
          </button>
        </div>
      ) : (
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">Outcome</label>
          <select
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            className="input-pump w-full"
          >
            {outcomes.map((o, i) => (
              <option key={`${o}-${i}`} value={i}>
                {o} ({(probs[i] ?? 0).toFixed(1)}%)
              </option>
            ))}
          </select>

          <div className="mt-3 flex items-center justify-between text-sm text-gray-400">
            <span>Selected</span>
            <span className="text-white font-semibold">{(probs[selectedIndex] ?? 0).toFixed(1)}¢</span>
          </div>
        </div>
      )}

      {/* Shares display */}
      <div className="mb-4">
        <div className="text-right">
          <div className="text-5xl md:text-6xl font-bold text-white tabular-nums">{safeShares}</div>
          <div className="text-sm text-gray-500 mt-1">
            shares @ {avgPrice.toFixed(3)} SOL each
          </div>
        </div>
      </div>

      {/* Quick buttons */}
      <div className="flex gap-2 justify-end mb-6">
        <button onClick={() => handleQuickAmount(1)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition text-sm">
          +1
        </button>
        <button onClick={() => handleQuickAmount(20)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition text-sm">
          +20
        </button>
        <button onClick={() => handleQuickAmount(100)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition text-sm">
          +100
        </button>
        <button onClick={() => handleQuickAmount(1000)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold transition text-sm">
          Max
        </button>
      </div>

      {/* Potential */}
      <div className="bg-pump-dark rounded-xl p-4 mb-6">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-gray-400 text-sm mb-1">
              {side === "buy" ? "Potential profit if wins 💸" : "Estimated receive 💸"}
            </p>
            <p className="text-xs text-gray-500">Avg. price {avgPrice.toFixed(3)} SOL</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-pump-green">
              {side === "buy" ? profitIfWin.toFixed(2) : sellReceiveSol.toFixed(2)} SOL
            </div>
            {side === "buy" && (
              <div className="text-xs text-gray-500">
                {roi >= 0 ? "+" : ""}
                {roi.toFixed(0)}% ROI
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cost */}
      <div className="bg-pump-dark/50 rounded-lg p-3 mb-6">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-500">{side === "buy" ? "Estimated cost" : "Estimated receive"}</span>
          <span className="text-white font-semibold">{estCostSol.toFixed(4)} SOL</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">Includes fee (estimate)</span>
          <span className="text-gray-500">{(estCostSol * 0.02).toFixed(4)} SOL</span>
        </div>
      </div>

      {/* Trade button */}
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
          disabled={!!submitting}
          onClick={handleTrade}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            submitting
              ? "bg-gray-700 text-gray-300 cursor-not-allowed"
              : isBinaryStyle
              ? selectedIndex === 0
                ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg hover:shadow-xl"
                : "bg-red-600 hover:bg-red-500 text-white shadow-lg hover:shadow-xl"
              : "btn-pump glow-green"
          }`}
        >
          {submitting
            ? "Submitting..."
            : side === "buy"
            ? `Buy ${String(outcomes[selectedIndex] || "SHARES").toUpperCase()}`
            : `Sell ${String(outcomes[selectedIndex] || "SHARES").toUpperCase()}`}
        </button>
      )}
    </div>
  );
}