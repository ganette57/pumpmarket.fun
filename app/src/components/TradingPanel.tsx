// app/src/components/TradingPanel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { lamportsToSol } from "@/utils/solana";

type MarketForTrade = {
  resolved: boolean;

  yesSupply?: number;
  noSupply?: number;

  marketType?: number; // 0=binary, 1=multi
  outcomeNames?: string[];
  outcomeSupplies?: number[];
};

interface TradingPanelProps {
  market: MarketForTrade;
  connected: boolean;
  submitting?: boolean;

  // ✅ added costSol (UI estimate) as optional 4th arg
  onTrade: (
    shares: number,
    outcomeIndex: number,
    side: "buy" | "sell",
    costSol?: number
  ) => void;

  marketBalanceLamports?: number | null;
  userHoldings?: number[] | null;

  marketClosed?: boolean;
  marketAddress?: string;
}

// UI-only linear estimate (NOT LMSR)
const BASE_PRICE_LAMPORTS = 10_000_000; // 0.01 SOL
const SLOPE_LAMPORTS_PER_SUPPLY = 1_000; // +0.000001 SOL per share supply

// on-chain fees: 1% platform + 2% creator = 3%
function feeLamports3pct(costLamports: number) {
  return Math.floor((costLamports * 3) / 100);
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default function TradingPanel({
  market,
  connected,
  submitting,
  onTrade,
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
        totalSupply > 0
          ? (s / totalSupply) * 100
          : 100 / (supplies.length || 1)
      ),
    [supplies, totalSupply]
  );

  const oddsX = useMemo(
    () =>
      probs.map((p) => {
        if (p <= 0) return supplies.length || 1;
        const raw = 100 / p;
        return Math.min(raw, 100);
      }),
    [probs, supplies.length]
  );

  const isBinaryStyle = outcomes.length === 2;

  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [shares, setShares] = useState<number>(100);
  const [side, setSide] = useState<"buy" | "sell">("buy");

  useEffect(() => {
    if (selectedIndex > outcomes.length - 1) setSelectedIndex(0);
  }, [outcomes.length, selectedIndex]);

  const safeShares = useMemo(() => Math.max(1, Math.floor(shares || 0)), [shares]);

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

  const outcomeAccentText = useMemo(() => {
    if (!isBinaryStyle) return "text-pump-green";
    return selectedIndex === 1 ? "text-[#ff5c73]" : "text-pump-green";
  }, [isBinaryStyle, selectedIndex]);

  const outcomeAccentBg = useMemo(() => {
    if (!isBinaryStyle) return "bg-pump-green";
    return selectedIndex === 1 ? "bg-[#ff5c73]" : "bg-pump-green";
  }, [isBinaryStyle, selectedIndex]);

  const mainAccentAmountClass = isRedBuy ? "text-[#ff5c73]" : "text-pump-green";

  // UI estimate only
  const buyCostLamports = useMemo(() => {
    const pricePerUnit =
      BASE_PRICE_LAMPORTS + currentSupply * SLOPE_LAMPORTS_PER_SUPPLY;
    const cost = safeShares * pricePerUnit;
    const fees = feeLamports3pct(cost);
    const totalPay = cost + fees;
    return { pricePerUnit, cost, fees, totalPay };
  }, [currentSupply, safeShares]);

  const sellRefundLamports = useMemo(() => {
    const startSupply = Math.max(0, currentSupply - safeShares);
    const pricePerUnit =
      BASE_PRICE_LAMPORTS + startSupply * SLOPE_LAMPORTS_PER_SUPPLY;
    const refund = safeShares * pricePerUnit;
    const fees = feeLamports3pct(refund);
    const netReceive = Math.max(0, refund - fees);
    return { pricePerUnit, refund, fees, netReceive, startSupply };
  }, [currentSupply, safeShares]);

  const payOrReceiveLamports =
    side === "buy" ? buyCostLamports.totalPay : sellRefundLamports.netReceive;
  const feeLamports = side === "buy" ? buyCostLamports.fees : sellRefundLamports.fees;

  const avgPriceSol = useMemo(() => {
    const v = lamportsToSol(payOrReceiveLamports);
    return safeShares > 0 ? v / safeShares : 0;
  }, [payOrReceiveLamports, safeShares]);

  const selectedOddsX = oddsX[selectedIndex] || 1;

  const stakeSol = useMemo(
    () => (side === "buy" ? lamportsToSol(buyCostLamports.totalPay) : 0),
    [buyCostLamports.totalPay, side]
  );

  const payoutIfWinSol = useMemo(() => {
    if (side !== "buy") return null;
    if (stakeSol <= 0 || !Number.isFinite(selectedOddsX)) return null;
    return stakeSol * selectedOddsX;
  }, [side, stakeSol, selectedOddsX]);

  const profitIfWinSol = useMemo(() => {
    if (payoutIfWinSol == null) return null;
    return payoutIfWinSol - stakeSol;
  }, [payoutIfWinSol, stakeSol]);

  const roiPct = useMemo(() => {
    if (profitIfWinSol == null) return null;
    if (stakeSol <= 0) return null;
    return (profitIfWinSol / stakeSol) * 100;
  }, [profitIfWinSol, stakeSol]);

  const profitClass =
    profitIfWinSol != null && profitIfWinSol >= 0
      ? "text-pump-green"
      : "text-[#ff5c73]";
  const roiClass =
    roiPct != null && roiPct >= 0 ? "text-pump-green" : "text-[#ff5c73]";

  const handleAmountChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const raw = e.target.value.replace(/[^\d]/g, "");
    const n = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(n)) return;

    if (side === "sell") setShares(clampInt(n, 0, maxSell || 0));
    else setShares(clampInt(n, 0, 1_000_000));
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

  // ✅ UPDATED: pass UI-estimated costSol to the page
  const handleTrade = () => {
    const s =
      side === "sell" ? clampInt(safeShares, 1, maxSell || 1) : safeShares;

    const costSol =
      side === "buy"
        ? lamportsToSol(buyCostLamports.totalPay)
        : lamportsToSol(sellRefundLamports.netReceive);

    onTrade(s, selectedIndex, side, costSol);
  };

  if (marketClosed) return null;

  return (
    <div className="card-pump sticky top-20">
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

      {isBinaryStyle ? (
        <div className="grid grid-cols-2 gap-3 mb-6">
          {[0, 1].map((i) => {
            const selected = selectedIndex === i;
            const isRed = i === 1;

            const baseClass = isRed
              ? "bg-[#ff5c73]/10 text-[#ff5c73] border border-[#ff5c73]/40 hover:bg-[#ff5c73]/20"
              : "bg-pump-green/10 text-pump-green border border-pump-green/40 hover:bg-pump-green/20";

            const activeClass = isRed
              ? "bg-[#ff5c73] text-black shadow-lg scale-105"
              : "bg-pump-green text-black shadow-lg scale-105";

            const oddsColor = isRed ? "text-[#ff5c73]" : "text-pump-green";

            return (
              <button
                key={i}
                onClick={() => setSelectedIndex(i)}
                className={`flex flex-col items-center justify-center py-4 rounded-xl font-bold transition-all ${
                  selected ? activeClass : baseClass
                }`}
              >
                <span className="text-sm mb-1">{outcomes[i]}</span>
                <span className="text-2xl">{(probs[i] ?? 0).toFixed(0)}¢</span>
                <span
                  className={`mt-1 font-extrabold ${
                    selected ? "text-black" : oddsColor
                  } text-lg`}
                >
                  {oddsX[i].toFixed(2)}x
                </span>
              </button>
            );
          })}
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
                {o} ({(probs[i] ?? 0).toFixed(1)}% • {oddsX[i].toFixed(2)}x)
              </option>
            ))}
          </select>

          <div className="mt-3 flex items-center justify-between text-sm text-gray-400">
            <span>Selected</span>
            <span className="text-white font-semibold">
              {(probs[selectedIndex] ?? 0).toFixed(1)}% •{" "}
              {oddsX[selectedIndex].toFixed(2)}x
            </span>
          </div>
        </div>
      )}

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
          avg {avgPriceSol.toFixed(6)} SOL / share (incl. fees)
        </div>
      </div>

      <div className="flex gap-2 justify-end mb-6">
        <button
          onClick={() => bumpShares(1)}
          className="px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm text-white border border-gray-700 hover:border-pump-green"
        >
          +1
        </button>
        <button
          onClick={() => bumpShares(20)}
          className="px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm text-white border border-gray-700 hover:border-pump-green"
        >
          +20
        </button>
        <button
          onClick={() => bumpShares(100)}
          className="px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm text-white border border-gray-700 hover:border-pump-green"
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

      <div className="bg-pump-dark rounded-xl p-4 mb-6 space-y-4">
        <div className="flex justify-between items-end">
          <div>
            <p className="text-gray-400 text-sm mb-1">
              {side === "buy" ? "You pay (est.)" : "You receive (est.)"}
            </p>
            <p className="text-xs text-gray-500">
              Fee: {lamportsToSol(feeLamports).toFixed(6)} SOL (3%)
            </p>
          </div>
          <div className="text-right">
            <div className={`text-3xl font-bold ${mainAccentAmountClass}`}>
              {lamportsToSol(payOrReceiveLamports).toFixed(6)} SOL
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4">
          {side === "buy" ? (
            <div className="flex justify-between items-end gap-4">
              <div className="min-w-0">
                <p className="text-gray-400 text-sm mb-1">
                  If this outcome wins (est.)
                </p>
                <p className="text-xs text-gray-500">
                  UI estimate only (not LMSR).
                </p>
              </div>

              <div className="text-right">
                <div className="flex items-baseline justify-end gap-3">
                  <div className="text-3xl font-bold text-white">
                    {payoutIfWinSol == null
                      ? "—"
                      : `${payoutIfWinSol.toFixed(6)} SOL`}
                  </div>
                  <div
                    className={`text-2xl font-extrabold ${outcomeAccentText}`}
                  >
                    {selectedOddsX.toFixed(2)}x
                  </div>
                </div>

                {profitIfWinSol != null && roiPct != null && (
                  <div className="text-xs mt-1">
                    <span className={profitClass}>
                      Profit (est.): {profitIfWinSol >= 0 ? "+" : ""}
                      {profitIfWinSol.toFixed(6)} SOL
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
          ) : (
            <p className="text-xs text-gray-400">
              You are selling your existing shares. UI estimate only.
            </p>
          )}
        </div>
      </div>

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
              : `btn-pump glow-green ${outcomeAccentBg}`
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