// Fees (match on-chain): 1% platform + 2% creator = 3%
const PLATFORM_FEE_BPS = 100; // 1%
const CREATOR_FEE_BPS = 200; // 2%

export function feeBreakdownLamports(amountLamports: number) {
  const platform = Math.floor((amountLamports * PLATFORM_FEE_BPS) / 10_000);
  const creator = Math.floor((amountLamports * CREATOR_FEE_BPS) / 10_000);
  return { platform, creator, total: platform + creator };
}

// UI pricing model (matches on-chain behavior you’re seeing):
// pricePerShare = base + supply * slope
export const DEFAULT_BASE_PRICE_LAMPORTS = 10_000_000; // 0.01 SOL
export const DEFAULT_SLOPE_LAMPORTS_PER_SUPPLY = 1_000; // +0.000001 SOL per existing supply


export function realBuyCost(base: number, supply: number, shares: number) {
  const pricePerUnit = base + supply * DEFAULT_SLOPE_LAMPORTS_PER_SUPPLY;
  const cost = shares * pricePerUnit;
  const fees = feeBreakdownLamports(cost);
  const totalPay = cost + fees.total;
  return { pricePerUnit, cost, fees, totalPay, avgInclFees: totalPay / shares };
}

// Extracted unchanged from TradingPanel: creator fees remain in the pool.
export function realPayoutLamports(pool: number, supply: number, shares: number,
  held: number, cost: number, creatorFee: number): number | null {
  if (!Number.isFinite(pool) || pool <= 0 || supply + shares <= 0) return null;
  const payout = ((held + shares) / (supply + shares)) * (pool + cost + creatorFee);
  return Number.isFinite(payout) && payout > 0 ? payout : null;
}

export type RealQuote = ReturnType<typeof realBuyCost> & {
  shares: number;
  resultingUserShares: number;
  payout: number | null;
  multiplier: number | null;
};

/** Authoritative TradingPanel buy quote. All amounts are lamports. */
export function realQuote(base: number, supply: number, pool: number, held: number,
  input: { shares: number } | { budget: number }): RealQuote | null {
  if (![base, supply, pool, held].every(Number.isSafeInteger) || base <= 0 || supply < 0 || pool < 0 || held < 0) return null;
  let shares: number;
  if ("shares" in input) {
    if (!Number.isFinite(input.shares) || input.shares <= 0) return null;
    shares = Math.max(1, Math.floor(input.shares));
  } else {
    if (!Number.isSafeInteger(input.budget) || input.budget <= 0) return null;
    let low = 0, high = 100000;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (realBuyCost(base, supply, mid).totalPay <= input.budget) low = mid;
      else high = mid - 1;
    }
    shares = low;
  }
  if (!shares) return null;
  const buy = realBuyCost(base, supply, shares);
  if (!Number.isSafeInteger(buy.totalPay) || buy.totalPay <= 0) return null;
  const payout = realPayoutLamports(pool, supply, shares, held, buy.cost, buy.fees.creator);
  // Preserve TradingPanel's SOL conversion order exactly.
  const multiple = payout === null ? null : (payout / 1e9) / (buy.totalPay / 1e9);
  return { ...buy, shares, resultingUserShares: held + shares, payout,
    multiplier: multiple !== null && Number.isFinite(multiple) && multiple > 0 ? multiple : null };
}

export function realFeedMultiple(base: number, supply: number, pool: number, held: number): number | null {
  return realQuote(base, supply, pool, held, { budget: 1_000_000_000 })?.multiplier ?? null;
}

export function parseBLamports(m: any): number | null {
  const direct =
    m?.b_lamports ??
    m?.bLamports ??
    m?.liquidity_lamports ??
    m?.liquidity_param_lamports;

  if (direct != null && Number(direct) > 0) return Math.floor(Number(direct));

  const sol =
    m?.b_sol ??
    m?.bSol ??
    m?.liquidity_sol ??
    m?.liquidity_param_sol;

  if (sol != null && Number(sol) > 0) return Math.floor(Number(sol) * 1_000_000_000);

  // fallback: ton default 0.01 SOL
  return DEFAULT_BASE_PRICE_LAMPORTS;
}
