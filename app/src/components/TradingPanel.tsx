"use client";

import { useEffect, useMemo, useState } from "react";
import { lamportsToSol } from "@/utils/solana";

type MarketForTrade = {
  resolved: boolean;
  bLamports?: number; // ✅ LMSR b in lamports
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

  onTrade: (shares: number, outcomeIndex: number, side: "buy" | "sell", costSol?: number) => void;

  marketBalanceLamports?: number | null;
  userHoldings?: number[] | null;
  marketClosed?: boolean;

  // NEW (safe, no breaking)
  mode?: "desktop" | "drawer";
  defaultSide?: "buy" | "sell";
  defaultOutcomeIndex?: number;
  onClose?: () => void;
  title?: string;
}

// Fees (match on-chain): 1% platform + 2% creator = 3%
const PLATFORM_FEE_BPS = 100; // 1%
const CREATOR_FEE_BPS = 200;  // 2%

function feeBreakdownLamports(amountLamports: number) {
  const platform = Math.floor((amountLamports * PLATFORM_FEE_BPS) / 10_000);
  const creator = Math.floor((amountLamports * CREATOR_FEE_BPS) / 10_000);
  return { platform, creator, total: platform + creator };
}
// UI pricing model (matches on-chain behavior you’re seeing):
// pricePerShare = base + supply * slope
const DEFAULT_BASE_PRICE_LAMPORTS = 10_000_000; // 0.01 SOL
const DEFAULT_SLOPE_LAMPORTS_PER_SUPPLY = 1_000; // +0.000001 SOL per existing supply

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function lmsrCostLamports(q: number[], bLamports: number, outcomeCount: number): number {
  const n = Math.max(2, Math.min(10, outcomeCount));
  if (bLamports <= 0) return 0;

  let maxR = -Infinity;
  const r: number[] = [];
  for (let i = 0; i < n; i++) {
    const ri = (Number(q[i] || 0)) / bLamports;
    r.push(ri);
    if (ri > maxR) maxR = ri;
  }

  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.exp(r[i] - maxR);

  const ln = maxR + Math.log(sum);
  const cost = bLamports * ln;

  return Math.max(1, Math.ceil(cost));
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group">
      <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-700 text-[11px] text-gray-300">
        ?
      </span>
      <span className="pointer-events-none absolute right-0 top-7 z-20 w-[260px] rounded-lg border border-gray-800 bg-black/90 p-2 text-xs text-gray-200 opacity-0 shadow-xl backdrop-blur transition group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}

const TERMS_URL = "https://funmarket.gitbook.io/funmarket/terms-of-use";

export default function TradingPanel({
  market,
  connected,
  submitting,
  onTrade,
  userHoldings,
  marketClosed,

  mode = "desktop",
  defaultSide = "buy",
  defaultOutcomeIndex = 0,
  onClose,
  title = "Trade",
}: TradingPanelProps) {
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

// base price per share (lamports). You already set DEFAULT_B_SOL=0.01 in create,
// so if you store bLamports on the market, we reuse it as the base price.
const basePriceLamports = useMemo(() => {
  const v = Number(market.bLamports);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_BASE_PRICE_LAMPORTS;
}, [market.bLamports]);

const slopeLamportsPerSupply = DEFAULT_SLOPE_LAMPORTS_PER_SUPPLY;

const totalSupply = useMemo(() => supplies.reduce((sum, x) => sum + (x || 0), 0), [supplies]);

const probs = useMemo(
  () =>
    supplies.map((s) =>
      totalSupply > 0 ? (Number(s || 0) / totalSupply) * 100 : 100 / (supplies.length || 1)
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

  const [selectedIndex, setSelectedIndex] = useState<number>(defaultOutcomeIndex);
  const [shares, setShares] = useState<number>(100);
  const [side, setSide] = useState<"buy" | "sell">(defaultSide);

  // keep in sync when drawer opens with a different outcome
  useEffect(() => {
    setSelectedIndex(Math.max(0, Math.min(defaultOutcomeIndex, outcomes.length - 1)));
  }, [defaultOutcomeIndex, outcomes.length]);

  useEffect(() => {
    setSide(defaultSide);
  }, [defaultSide]);

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

  const maxSell = useMemo(() => (side === "sell" ? userCurrent : 100000), [side, userCurrent]);

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

  const buyCostLamports = useMemo(() => {
    const pricePerUnit = basePriceLamports + currentSupply * slopeLamportsPerSupply;
    const cost = safeShares * pricePerUnit;
    const fees = feeBreakdownLamports(cost);
    const totalPay = cost + fees.total;
    const avgInclFees = totalPay / safeShares;
    return { pricePerUnit, cost, fees, totalPay, avgInclFees };
  }, [basePriceLamports, currentSupply, slopeLamportsPerSupply, safeShares]);

  const sellRefundLamports = useMemo(() => {
    // sell moves supply backward
    const startSupply = Math.max(0, currentSupply - safeShares);
    const pricePerUnit = basePriceLamports + startSupply * slopeLamportsPerSupply;
    const refund = safeShares * pricePerUnit;
    const fees = feeBreakdownLamports(refund);
    const netReceive = Math.max(0, refund - fees.total);
    const avgInclFees = netReceive / safeShares;
    return { pricePerUnit, refund, fees, netReceive, startSupply, avgInclFees };
  }, [basePriceLamports, currentSupply, slopeLamportsPerSupply, safeShares]);

  const payOrReceiveLamports = side === "buy" ? buyCostLamports.totalPay : sellRefundLamports.netReceive;
  const feeLamports = side === "buy" ? buyCostLamports.fees.total : sellRefundLamports.fees.total;

  const avgPriceSol = useMemo(() => {
    const avgLamports =
      side === "buy" ? buyCostLamports.avgInclFees : sellRefundLamports.avgInclFees;
    return lamportsToSol(avgLamports);
  }, [side, buyCostLamports.avgInclFees, sellRefundLamports.avgInclFees]);

  const selectedOddsX = oddsX[selectedIndex] || 1;

  const stakeSol = useMemo(() => (side === "buy" ? lamportsToSol(buyCostLamports.totalPay) : 0), [buyCostLamports.totalPay, side]);

  const payoutIfWinSol = useMemo(() => {
    if (side !== "buy") return null;
    if (stakeSol <= 0 || !Number.isFinite(selectedOddsX)) return null;
    return stakeSol * selectedOddsX;
  }, [side, stakeSol, selectedOddsX]);

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

  const handleTrade = () => {
    const s = side === "sell" ? clampInt(safeShares, 1, maxSell || 1) : safeShares;

    const costSol =
      side === "buy"
        ? lamportsToSol(buyCostLamports.totalPay)
        : lamportsToSol(sellRefundLamports.netReceive);

    onTrade(s, selectedIndex, side, costSol);
  };

  if (marketClosed) return null;

  const rootClass =
  mode === "drawer"
    ? "h-full flex flex-col" // ✅ pas de card-pump dans le drawer
    : "card-pump";

  return (
    <div className={rootClass}>
      {/* Header (drawer) */}
      {mode === "drawer" && (
  <div className="sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-pump-dark/95 backdrop-blur border-b border-gray-800">
    <div className="text-white font-bold text-lg">{title}</div>
    {onClose && (
      <button
        onClick={onClose}
        className="h-9 w-9 rounded-full border border-gray-800 bg-pump-dark/60 text-gray-200"
        aria-label="Close"
      >
        ✕
      </button>
    )}
  </div>
)}

<div className={mode === "drawer" ? "px-4 pb-2 pt-3 flex-1 overflow-y-auto" : ""}>
        {/* Buy / Sell */}
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

        {/* Outcome pick */}
        {isBinaryStyle ? (
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[0, 1].map((i) => {
              const selected = selectedIndex === i;
              const isRed = i === 1;

              const baseClass = isRed
                ? "bg-[#ff5c73]/10 text-[#ff5c73] border border-[#ff5c73]/40 hover:bg-[#ff5c73]/20"
                : "bg-pump-green/10 text-pump-green border border-pump-green/40 hover:bg-pump-green/20";

              const activeClass = isRed
                ? "bg-[#ff5c73] text-black shadow-lg"
                : "bg-pump-green text-black shadow-lg";

              return (
                <button
                  key={i}
                  onClick={() => setSelectedIndex(i)}
                  className={`flex flex-col items-center justify-center py-3 md:py-4 rounded-xl font-bold transition-all ${
                    selected ? activeClass : baseClass
                  }`}
                >
                  <span className="text-sm mb-1">{outcomes[i]}</span>
                  <span className="text-xl md:text-2xl">{(probs[i] ?? 0).toFixed(0)}¢</span>
                  <span className={`mt-1 font-extrabold ${selected ? "text-black" : isRed ? "text-[#ff5c73]" : "text-pump-green"} text-base md:text-lg`}>
                    {oddsX[i].toFixed(2)}x
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-white font-semibold">Outcome</label>
            </div>
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
          </div>
        )}

        {/* Amount */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400 mb-1 block">Amount (shares)</label>
            <div className="text-xs text-gray-500">
            avg {avgPriceSol.toFixed(9)}
            <InfoTip text="Average estimate per share (base + supply*slope, includes 1% platform + 2% creator fees). Matches on-chain." />
            </div>
          </div>

          <input
            type="number"
            min={1}
            value={shares || ""}
            onChange={handleAmountChange}
            className="w-full bg-transparent border-none outline-none text-5xl md:text-6xl font-bold text-white tabular-nums text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            inputMode="numeric"
          />

          <div className="flex gap-2 justify-end mt-3">
            <button onClick={() => bumpShares(1)} className="px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm text-white border border-gray-700 hover:border-pump-green">
              +1
            </button>
            <button onClick={() => bumpShares(20)} className="px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm text-white border border-gray-700 hover:border-pump-green">
              +20
            </button>
            <button onClick={() => bumpShares(100)} className="px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm text-white border border-gray-700 hover:border-pump-green">
              +100
            </button>
            <button
              onClick={handleMax}
              className={`px-4 py-2 bg-pump-dark rounded-lg font-semibold transition text-sm ${
                isRedBuy ? "border border-[#ff5c73] text-[#ff5c73]" : "border border-pump-green text-pump-green"
              }`}
            >
              Max
            </button>
          </div>
        </div>

        {/* Summary (minimal) */}
        <div className="bg-pump-dark rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-400">
              {side === "buy" ? "You pay" : "You receive"}
              <InfoTip text={`Fees (platform 1% + creator 2%): ${lamportsToSol(feeLamports).toFixed(6)} SOL.`} />
            </div>
            <div className={`text-2xl font-extrabold ${mainAccentAmountClass} whitespace-nowrap`}>
  {lamportsToSol(payOrReceiveLamports).toFixed(2)} SOL
</div>
          </div>

          {side === "buy" && payoutIfWinSol != null && (
            <div className="mt-3 flex items-center justify-between">
              <div className="text-sm text-gray-400">
                To win
                <InfoTip text="Approx. value if this outcome wins (UI estimate, not LMSR)." />
              </div>
              <div className="flex items-baseline gap-2">
              <div className="text-xl font-bold text-white whitespace-nowrap">
  {payoutIfWinSol.toFixed(2)} SOL
</div>
                <div className={`text-lg font-extrabold ${outcomeAccentText}`}>{selectedOddsX.toFixed(2)}x</div>
              </div>
            </div>
          )}
        </div>

        {/* Wallet / Resolved warnings */}
        {!connected && (
          <div className="mt-3 text-center p-3 bg-pump-dark rounded-xl">
            <p className="text-gray-400 text-sm">Connect wallet to trade</p>
          </div>
        )}
        {connected && market.resolved && (
          <div className="mt-3 text-center p-3 bg-pump-dark rounded-xl">
            <p className="text-gray-400 text-sm">Market resolved</p>
          </div>
        )}
      </div>

      {/* CTA (sticky in drawer to be visible without scroll) */}
      <div
  className={
    mode === "drawer"
      ? "sticky bottom-0 z-20 px-4 pb-4 pt-3 bg-pump-dark/80 backdrop-blur border-t border-gray-800"
      : "mt-4"
  }
>
        <button
          disabled={!!submitting || !connected || market.resolved || (side === "sell" && userCurrent <= 0)}
          onClick={handleTrade}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${
            submitting || !connected || market.resolved || (side === "sell" && userCurrent <= 0)
              ? "bg-gray-700 text-gray-300 cursor-not-allowed"
              : isBinaryStyle
              ? selectedIndex === 0
                ? "bg-pump-green hover:bg-[#74ffb8] text-black shadow-lg"
                : "bg-[#ff5c73] hover:bg-[#ff7c90] text-black shadow-lg"
              : `btn-pump glow-green ${outcomeAccentBg}`
          }`}
        >
          {submitting
            ? "Submitting..."
            : side === "buy"
            ? `Buy ${String(outcomes[selectedIndex] || "SHARES").toUpperCase()}`
            : `Sell ${String(outcomes[selectedIndex] || "SHARES").toUpperCase()}`}
        </button>

        {/* Terms note (desktop + mobile drawer) */}
        <p className="mt-3 text-center text-xs text-gray-500">
          By trading, you agree to the{" "}
          <a
  href={TERMS_URL}
  target="_blank"
  rel="noopener noreferrer"
  className="text-gray-300 underline underline-offset-4 hover:text-white"
>
  Terms of Use
</a>
          .
        </p>
      </div>
    </div>
  );
}