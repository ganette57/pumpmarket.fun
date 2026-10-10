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
  const values = [pool, supply, shares, held, cost, creatorFee];
  if (!values.every(Number.isSafeInteger) || pool <= 0 || supply + shares <= 0 ||
      held < 0 || shares < 0 || held + shares > supply + shares || cost < 0 || creatorFee < 0) {
    return null;
  }
  const payout =
    (BigInt(held + shares) * BigInt(pool + cost + creatorFee)) /
    BigInt(supply + shares);
  const value = Number(payout);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Estimated payout for shares the wallet ALREADY holds if this outcome wins.
 *
 * This deliberately delegates to the same helper as `realQuote`: a current
 * position is the zero-purchase case (no new shares, cost or creator fee).
 * Keeping that identity here prevents display surfaces from growing their own
 * share-of-pool formula or accidentally quoting an additional buy.
 */
export function realCurrentPositionPayoutLamports(
  pool: number,
  supply: number,
  held: number
): number | null {
  if (![pool, supply, held].every(Number.isSafeInteger)) return null;
  if (pool <= 0 || supply <= 0 || held <= 0) return null;
  return realPayoutLamports(pool, supply, 0, held, 0, 0);
}

export type RealQuote = ReturnType<typeof realBuyCost> & {
  shares: number;
  resultingUserShares: number;
  /** Current grouped-position claim before the hypothetical purchase. */
  payoutBefore: number;
  /** Grouped-position claim after the hypothetical purchase. */
  payoutAfter: number | null;
  /** Incremental grouped claim economically attributable to the new buy. */
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
  const payoutBefore = held > 0
    ? realPayoutLamports(pool, supply, 0, held, 0, 0) ?? 0
    : 0;
  const payoutAfter = realPayoutLamports(
    pool, supply, shares, held, buy.cost, buy.fees.creator
  );
  // REAL settles one grouped wallet position. The new purchase changes that
  // single claim by payoutAfter - payoutBefore; unlike PLAY there is no
  // independently settled trade row to quote.
  const payout = payoutAfter === null ? null : payoutAfter - payoutBefore;
  // Preserve TradingPanel's SOL conversion order exactly.
  const multiple = payout === null ? null : (payout / 1e9) / (buy.totalPay / 1e9);
  return { ...buy, shares, resultingUserShares: held + shares,
    payoutBefore, payoutAfter, payout,
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
