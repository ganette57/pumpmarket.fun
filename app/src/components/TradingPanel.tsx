// app/src/components/TradingPanel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { lamportsToSol } from "@/utils/solana";

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

  marketBalanceLamports?: number | null;
  userHoldings?: number[] | null;

  marketClosed?: boolean;
  marketAddress?: string;
}

const BASE_PRICE_LAMPORTS = 10_000_000; // 0.01 SOL
const SLOPE_LAMPORTS_PER_SUPPLY = 1_000; // +0.000001 SOL par share de supply

function fee2lamports(costLamports: number) {
  const a = Math.floor(costLamports / 100);
  const b = Math.floor(costLamports / 100);
  return a + b;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default function TradingPanel({
  market,
  connected,
  submitting,
  onTrade,
  marketBalanceLamports,
  userHoldings,
  marketClosed,
}: TradingPanelProps) {
  const outcomes = useMemo(() => {
    const names = (market.outcomeNames || []).map(String).filter(Boolean);
    if (names.length >= 2) return names.slice(0, 10);
    return ["YES", "NO"];
  }, [market.outcomeNames]);

  const supplies = useMemo(() => {
    const arr = Array.isArray(market.outcomeSupplies)
      ? market.outcomeSupplies
      : [];
    if (arr.length >= outcomes.length)
      return arr.slice(0, outcomes.length).map((x) => Number(x || 0));

    if (outcomes.length === 2)
      return [Number(market.yesSupply || 0), Number(market.noSupply || 0)];
    return Array(outcomes.length).fill(0);
  }, [market.outcomeSupplies, market.yesSupply, market.noSupply, outcomes]);

  const totalSupply = useMemo(
    () => supplies.reduce((sum, x) => sum + (x || 0), 0),
    [supplies]
  );

  const probs = useMemo(
    () =>
      supplies.map((s) =>
        totalSupply > 0 ? (s / totalSupply) * 100 : 100 / (supplies.length || 1)
      ),
    [supplies, totalSupply]
  );

  const isBinaryStyle = outcomes.length === 2;

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [shares, setShares] = useState<number>(100);
  const [side, setSide] = useState<"buy" | "sell">("buy");

  useEffect(() => {
    if (selectedIndex > outcomes.length - 1) setSelectedIndex(0);
  }, [outcomes.length, selectedIndex]);

  const safeShares = useMemo(
    () => Math.max(1, Math.floor(shares || 0)),
    [shares]
  );

  const currentSupply = useMemo(
    () => Math.max(0, Math.floor(supplies[selectedIndex] || 0)),
    [supplies, selectedIndex]
  );

  const userCurrent = useMemo(() => {
    const x = userHoldings?.[selectedIndex] ?? 0;
    return Math.max(0, Math.floor(Number(x) || 0));
  }, [userHoldings, selectedIndex]);

  const maxSell = useMemo(
    () => (side === "sell" ? userCurrent : 100000),
    [side, userCurrent]
  );

  const isRedOutcome = isBinaryStyle && selectedIndex === 1;
  const isRedBuy = side === "buy" && isRedOutcome;

  const mainAccentAmountClass = isRedBuy
    ? "text-[#ff5c73]"
    : "text-pump-green";

  // --- pricing (même que contrat) ---
  const buyCostLamports = useMemo(() => {
    const pricePerUnit =
      BASE_PRICE_LAMPORTS + currentSupply * SLOPE_LAMPORTS_PER_SUPPLY;
    const cost = safeShares * pricePerUnit;
    const fees = fee2lamports(cost);
    const totalPay = cost + fees;
    return { pricePerUnit, cost, fees, totalPay };
  }, [currentSupply, safeShares]);

  const sellRefundLamports = useMemo(() => {
    const startSupply = Math.max(0, currentSupply - safeShares);
    const pricePerUnit =
      BASE_PRICE_LAMPORTS + startSupply * SLOPE_LAMPORTS_PER_SUPPLY;
    const refund = safeShares * pricePerUnit;
    const fees = fee2lamports(refund);
    const netReceive = Math.max(0, refund - fees);
    return { pricePerUnit, refund, fees, netReceive, startSupply };
  }, [currentSupply, safeShares]);

  const payOrReceiveLamports =
    side === "buy" ? buyCostLamports.totalPay : sellRefundLamports.netReceive;
  const feeLamports =
    side === "buy" ? buyCostLamports.fees : sellRefundLamports.fees;

  const avgPriceSol = useMemo(() => {
    const v = lamportsToSol(payOrReceiveLamports);
    return safeShares > 0 ? v / safeShares : 0;
  }, [payOrReceiveLamports, safeShares]);

  // --- payout estimate (claim_winnings) ---
  const payoutEstimateLamports = useMemo(() => {
    if (marketBalanceLamports == null) return null;

    const poolBefore = Math.max(0, Math.floor(marketBalanceLamports));

    const poolAfter =
      side === "buy"
        ? poolBefore + buyCostLamports.cost
        : Math.max(0, poolBefore - sellRefundLamports.refund);

    const userAfter =
      side === "buy"
        ? userCurrent + safeShares
        : Math.max(0, userCurrent - safeShares);

    const supplyAfter =
      side === "buy"
        ? currentSupply + safeShares
        : Math.max(0, currentSupply - safeShares);

    if (userAfter <= 0 || supplyAfter <= 0) return 0;

    const payout =
      (BigInt(userAfter) * BigInt(poolAfter)) / BigInt(supplyAfter);
    return Number(payout);
  }, [
    marketBalanceLamports,
    side,
    buyCostLamports.cost,
    sellRefundLamports.refund,
    userCurrent,
    safeShares,
    currentSupply,
  ]);

  const payoutEstimateSol =
    payoutEstimateLamports == null
      ? null
      : lamportsToSol(payoutEstimateLamports);

  const profitIfWinSol = useMemo(() => {
    if (payoutEstimateSol == null) return null;
    if (side !== "buy") return null;
    const paySol = lamportsToSol(buyCostLamports.totalPay);
    return payoutEstimateSol - paySol;
  }, [payoutEstimateSol, side, buyCostLamports.totalPay]);

  const roiPct = useMemo(() => {
    if (profitIfWinSol == null) return null;
    const paySol = lamportsToSol(buyCostLamports.totalPay);
    if (paySol <= 0) return null;
    return (profitIfWinSol / paySol) * 100;
  }, [profitIfWinSol, buyCostLamports.totalPay]);

  const handleAmountChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const n = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n)) return;
    if (side === "sell") {
      setShares(clampInt(n, 0, maxSell || 0));
    } else {
      setShares(clampInt(n, 0, 1_000_000));
    }
  };

  const bumpShares = (delta: number) => {
    const base = safeShares || 0;
    const next =
      side === "sell"
        ? clampInt(base + delta, 1, maxSell || 1)
        : clampInt(base + delta, 1, 1_000_000);
    setShares(next);
  };

  const handleMax = () => {
    if (side === "sell") setShares(Math.max(1, maxSell || 1));
    else setShares(100_000);
  };

  const handleTrade = () => {
    const s =
      side === "sell"
        ? clampInt(safeShares, 1, maxSell || 1)
        : safeShares;
    onTrade(s, selectedIndex, side);
  };

  // classes pour profit/ROI selon side/outcome
  const profitClass =
    isRedBuy
      ? "text-[#ff5c73]"
      : profitIfWinSol != null && profitIfWinSol >= 0
      ? "text-pump-green"
      : "text-[#ff5c73]";

  const roiClass =
    isRedBuy
      ? "text-[#ff5c73]"
      : roiPct != null && roiPct >= 0
      ? "text-pump-green"
      : "text-[#ff5c73]";

  // --- état "market closed" ---
  if (marketClosed) {
    return (
      <div className="card-pump flex flex-col items-center justify-center text-center min-h-[260px]">
        <div className="w-14 h-14 rounded-full bg-pump-dark flex items-center justify-center mb-3">
          <span className="text-2xl">👍</span>
        </div>
        <p className="text-sm text-gray-400 mb-1">Market closed</p>
        <p className="text-lg font-semibold text-white mb-2">
          Trading is disabled for this market
        </p>
        <p className="text-xs text-gray-400 max-w-xs">
          You can view and claim any winnings from your dashboard once resolution
          is processed.
        </p>
      </div>
    );
  }

  return (
    <div className="card-pump sticky top-20">
      {/* Buy / Sell toggle */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          onClick={() => setSide("buy")}
          className={`py-2 rounded-lg font-semibold transition ${
            side === "buy"
              ? "bg-pump-green text-black"
              : "bg-pump-dark/60 text-gray-300 hover:bg-pump-dark"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide("sell")}
          className={`py-2 rounded-lg font-semibold transition ${
            side === "sell"
              ? "bg-gray-200 text-black"
              : "bg-pump-dark/60 text-gray-300 hover:bg-pump-dark"
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
                ? "bg-pump-green text-black shadow-lg scale-105"
                : "bg-pump-green/10 text-pump-green border border-pump-green/40 hover:bg-pump-green/20"
            }`}
          >
            <span className="text-sm mb-1">{outcomes[0]}</span>
            <span className="text-2xl">
              {(probs[0] ?? 0).toFixed(0)}¢
            </span>
          </button>

          <button
            onClick={() => setSelectedIndex(1)}
            className={`flex flex-col items-center justify-center py-4 rounded-xl font-bold transition-all ${
              selectedIndex === 1
                ? "bg-[#ff5c73] text-black shadow-lg scale-105"
                : "bg-[#ff5c73]/10 text-[#ff5c73] border border-[#ff5c73]/40 hover:bg-[#ff5c73]/20"
            }`}
          >
            <span className="text-sm mb-1">{outcomes[1]}</span>
            <span className="text-2xl">
              {(probs[1] ?? 0).toFixed(0)}¢
            </span>
          </button>
        </div>
      ) : (
        <div className="mb-6">
          <label className="block text-white font-semibold mb-2">
            Outcome
          </label>
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
            <span className="text-white font-semibold">
              {(probs[selectedIndex] ?? 0).toFixed(1)}¢
            </span>
          </div>
        </div>
      )}

      {/* Amount input – grand, aligné à droite */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 mb-1 block">
          Amount (shares)
        </label>
        <input
          type="number"
          min={1}
          value={shares || ""}
          onChange={handleAmountChange}
          className="w-full bg-transparent border-none outline-none text-5xl md:text-6xl font-bold text-white tabular-nums text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          inputMode="numeric"
        />
        <div className="text-xs text-gray-500 mt-1 text-right">
          avg {avgPriceSol.toFixed(4)} SOL / share (incl. fees)
        </div>
      </div>

      {/* Quick buttons alignés à droite, rouge si Buy + outcome rouge */}
      <div className="flex gap-2 justify-end mb-6">
        <button
          onClick={() => bumpShares(1)}
          className={`px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm text-white ${
            isRedBuy
              ? "border border-[#ff5c73]/60 hover:border-[#ff5c73]"
              : "border border-gray-700 hover:border-pump-green"
          }`}
        >
          +1
        </button>
        <button
          onClick={() => bumpShares(20)}
          className={`px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm text-white ${
            isRedBuy
              ? "border border-[#ff5c73]/60 hover:border-[#ff5c73]"
              : "border border-gray-700 hover:border-pump-green"
          }`}
        >
          +20
        </button>
        <button
          onClick={() => bumpShares(100)}
          className={`px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm text-white ${
            isRedBuy
              ? "border border-[#ff5c73]/60 hover:border-[#ff5c73]"
              : "border border-gray-700 hover:border-pump-green"
          }`}
        >
          +100
        </button>
        <button
          onClick={handleMax}
          className={`px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm ${
            isRedBuy
              ? "border border-[#ff5c73] text-[#ff5c73]"
              : "border border-pump-green text-pump-green"
          }`}
        >
          Max
        </button>
      </div>

      {/* Pay / Receive + Payout */}
      <div className="bg-pump-dark rounded-xl p-4 mb-6 space-y-4">
        <div className="flex justify-between items-end">
          <div>
            <p className="text-gray-400 text-sm mb-1">
              {side === "buy" ? "You pay (est.)" : "You receive (est.)"}
            </p>
            <p className="text-xs text-gray-500">
              Fee: {lamportsToSol(feeLamports).toFixed(4)} SOL (2%)
            </p>
          </div>
          <div className="text-right">
            <div className={`text-3xl font-bold ${mainAccentAmountClass}`}>
              {lamportsToSol(payOrReceiveLamports).toFixed(4)} SOL
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="flex justify-between items-end">
            <div>
              <p className="text-gray-400 text-sm mb-1">
                To win (est.) if this outcome wins
              </p>
              {marketBalanceLamports == null && (
                <p className="text-xs text-yellow-300 mt-1">
                  (Payout estimate unavailable: market balance not loaded / wrong
                  cluster)
                </p>
              )}
            </div>

            <div className="text-right">
              <div className="text-3xl font-bold text-white">
                {payoutEstimateSol == null
                  ? "—"
                  : `${payoutEstimateSol.toFixed(4)} SOL`}
              </div>

              {side === "buy" &&
                profitIfWinSol != null &&
                roiPct != null && (
                  <div className="text-xs mt-1">
                    <span className={profitClass}>
                      Profit: {profitIfWinSol >= 0 ? "+" : ""}
                      {profitIfWinSol.toFixed(4)} SOL
                    </span>
                    <span className="text-gray-500"> • </span>
                    <span className={roiClass}>
                      ROI: {roiPct >= 0 ? "+" : ""}
                      {roiPct.toFixed(0)}%
                    </span>
                  </div>
                )}
            </div>
          </div>
        </div>
      </div>

      {/* Info prix */}
      <div className="bg-pump-dark/50 rounded-lg p-3 mb-6">
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-500">Price / share</span>
          <span className="text-white font-semibold">
            {lamportsToSol(
              side === "buy"
                ? buyCostLamports.pricePerUnit
                : sellRefundLamports.pricePerUnit
            ).toFixed(6)}{" "}
            SOL
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-600">Supply used for pricing</span>
          <span className="text-gray-500">
            {side === "buy"
              ? currentSupply
              : sellRefundLamports.startSupply}
          </span>
        </div>

        {side === "sell" && (
          <div className="mt-2 text-xs text-gray-500">
            You own:{" "}
            <span className="text-white/80">{userCurrent}</span> shares
          </div>
        )}
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
          disabled={!!submitting || (side === "sell" && userCurrent <= 0)}
          onClick={handleTrade}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            submitting || (side === "sell" && userCurrent <= 0)
              ? "bg-gray-700 text-gray-300 cursor-not-allowed"
              : isBinaryStyle
              ? selectedIndex === 0
                ? "bg-pump-green hover:bg-[#74ffb8] text-black shadow-lg hover:shadow-xl"
                : "bg-[#ff5c73] hover:bg-[#ff7c90] text-black shadow-lg hover:shadow-xl"
              : "btn-pump glow-green"
          }`}
        >
          {submitting
            ? "Submitting..."
            : side === "buy"
            ? `Buy ${String(
                outcomes[selectedIndex] || "SHARES"
              ).toUpperCase()}`
            : `Sell ${String(
                outcomes[selectedIndex] || "SHARES"
              ).toUpperCase()}`}
        </button>
      )}
    </div>
  );
}