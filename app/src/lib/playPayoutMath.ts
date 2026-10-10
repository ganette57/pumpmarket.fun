// src/lib/playPayoutMath.ts
//
// A faithful client-side mirror of the ONE line of arithmetic that decides a
// Play payout, so a provisional result can state a number settlement will
// later agree with.
//
// THE LINE IT MIRRORS
// -------------------
// From public.play_settle_market (supabase/migrations/20260729_play_season_
// lifecycle.sql, the current definition — 20260721/20260722 hold older copies
// of the same function):
//
//     final_pool    := st.virtual_pool_usd;                    -- numeric(18,2)
//     select coalesce(sum(shares), 0) into total_winning       -- numeric(28,8)
//       from public.play_trades
//      where market_address = market_address_in
//        and status         = 'open'
//        and outcome_index  = winning;
//
//     payout := trunc(t.shares / total_winning * final_pool, 2);
//     pnl    := payout - t.stake_usd;
//
// Three properties of that line are load-bearing and are reproduced exactly
// here rather than approximated:
//
//   1. PER TRADE, NOT PER POSITION. The truncation is applied to every open
//      trade row separately and the results are added. Truncating the summed
//      position instead can differ by a cent per extra trade.
//   2. POSTGRES NUMERIC DIVISION, NOT REAL ARITHMETIC. `a / b` in Postgres
//      rounds to a scale chosen by select_div_scale() — at least 16
//      significant digits — and the product is only then truncated to cents.
//      Dividing exactly and truncating at the end is NOT the same function:
//      for shares=1, total=3, pool=3 Postgres yields 0.99 where exact
//      rational arithmetic yields 1.00. This module reproduces Postgres.
//   3. TRUNCATION, NOT ROUNDING. `trunc(x, 2)` goes toward zero. The cent it
//      drops is the pool dust play_settle_market deliberately leaves behind.
//
// Money is never a binary float here. Every value is carried as an exact
// scaled BigInt, in the same style as src/lib/resultCard.ts. BigInt literals
// (10n) need target >= ES2020 and this project targets ES5, so the constants
// are built by constructor call.
//
// This module reads nothing and writes nothing. It settles nothing, credits
// nothing and touches no balance — it is pure arithmetic over values the
// caller already proved. Nothing Real enters it: its only inputs are Play
// shares, Play open-share totals and the Play virtual pool.

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TWO = BigInt(2);
const BIG_TEN = BigInt(10);

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Declared scale of play_trades.shares / the SQL `total_winning` variable. */
export const SHARES_SCALE = 8;
/** Declared scale of play_market_states.virtual_pool_usd and stake_usd. */
export const USD_SCALE = 2;

/* -------------------------------------------------------------------------- */
/*  Exact scaled-integer numerics                                              */
/* -------------------------------------------------------------------------- */

/** A Postgres numeric: value = `u` / 10^`dscale`. `dscale` is significant. */
type Numeric = { u: bigint; dscale: number };

function pow10(n: number): bigint {
  let out = BIG_ONE;
  for (let i = 0; i < n; i++) out = out * BIG_TEN;
  return out;
}

/**
 * Parses any decimal-ish input into a numeric at exactly `dscale` places.
 *
 * `dscale` is passed in rather than inferred, because it is a property of the
 * COLUMN, not of the transport. A numeric(28,8) always has dscale 8 inside
 * Postgres, but "3500.00000000" may reach us as the JSON number 3500 and
 * stringify back as "3500". Restoring the declared scale keeps the
 * select_div_scale() inputs identical to the ones the database used.
 *
 * Excess fraction digits are rounded half-up, which is what Postgres does
 * when a value is stored into a column of that scale. Returns null for
 * anything that is not a decimal — null propagates and the caller shows no
 * number at all.
 */
function parseNumeric(v: unknown, dscale: number): Numeric | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!DECIMAL_RE.test(s)) return null;

  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart, fracPart = ""] = body.split(".");

  let u: bigint;
  if (fracPart.length <= dscale) {
    u =
      BigInt(intPart || "0") * pow10(dscale) +
      BigInt((fracPart + "0".repeat(dscale)).slice(0, dscale) || "0");
  } else {
    // One guard digit decides the half-up rounding.
    const kept = fracPart.slice(0, dscale);
    const guard = fracPart.charAt(dscale);
    u = BigInt(intPart || "0") * pow10(dscale) + BigInt(kept || "0");
    if (guard >= "5") u = u + BIG_ONE;
  }

  return { u: neg ? -u : u, dscale };
}

/** Renders a numeric with its full scale, e.g. { u: 39860n, dscale: 2 } -> "398.60". */
function formatNumeric(n: Numeric): string {
  const neg = n.u < BIG_ZERO;
  const abs = neg ? -n.u : n.u;
  if (n.dscale === 0) return `${neg ? "-" : ""}${abs.toString()}`;
  const unit = pow10(n.dscale);
  const whole = (abs / unit).toString();
  const frac = (abs % unit).toString().padStart(n.dscale, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/**
 * The base-10000 weight and leading digit of a value, as Postgres stores them.
 *
 * Postgres numerics are arrays of base-10000 digits aligned to the decimal
 * point: weight 0 covers 10^0..10^3, weight 1 covers 10^4..10^7, weight -1
 * covers 10^-4..10^-1. select_div_scale() reads both the weight and the
 * leading digit, so both are reproduced.
 *
 * A zero reports weight 0 / digit 0, matching the C loop, which never runs
 * for a value with no digits and leaves both initialised to zero.
 */
function weightAndFirstDigit(n: Numeric): { weight: number; firstDigit: number } {
  const abs = n.u < BIG_ZERO ? -n.u : n.u;
  if (abs === BIG_ZERO) return { weight: 0, firstDigit: 0 };

  // Decimal position of the most significant digit: 10^p <= |value| < 10^(p+1).
  const p = abs.toString().length - 1 - n.dscale;
  const weight = Math.floor(p / 4);

  // firstDigit = floor(|value| / 10000^weight), i.e. |u| shifted by dscale+4w.
  const shift = n.dscale + 4 * weight;
  const scaled = shift >= 0 ? abs / pow10(shift) : abs * pow10(-shift);
  return { weight, firstDigit: Number(scaled) };
}

/**
 * The result scale Postgres picks for `a / b`, reproducing select_div_scale()
 * from src/backend/utils/adt/numeric.c:
 *
 *     qweight = weight1 - weight2;
 *     if (firstdigit1 <= firstdigit2) qweight--;
 *     rscale = NUMERIC_MIN_SIG_DIGITS - qweight * DEC_DIGITS;   // 16, 4
 *     rscale = Max(rscale, var1->dscale);
 *     rscale = Max(rscale, var2->dscale);
 *     rscale = Max(rscale, NUMERIC_MIN_DISPLAY_SCALE);          // 0
 *     rscale = Min(rscale, NUMERIC_MAX_DISPLAY_SCALE);          // 1000
 */
function selectDivScale(a: Numeric, b: Numeric): number {
  const A = weightAndFirstDigit(a);
  const B = weightAndFirstDigit(b);

  let qweight = A.weight - B.weight;
  if (A.firstDigit <= B.firstDigit) qweight -= 1;

  let rscale = 16 - qweight * 4;
  rscale = Math.max(rscale, a.dscale, b.dscale, 0);
  rscale = Math.min(rscale, 1000);
  return rscale;
}

/**
 * `a / b` with Postgres semantics: the scale from selectDivScale(), and
 * half-away-from-zero rounding at that scale (div_var with round = true).
 * Null on division by zero — the caller must not turn that into a number.
 */
function divNumeric(a: Numeric, b: Numeric): Numeric | null {
  if (b.u === BIG_ZERO) return null;

  const rscale = selectDivScale(a, b);

  const negative = a.u < BIG_ZERO !== b.u < BIG_ZERO;
  const absA = a.u < BIG_ZERO ? -a.u : a.u;
  const absB = b.u < BIG_ZERO ? -b.u : b.u;

  // (a.u / 10^a.dscale) / (b.u / 10^b.dscale) * 10^rscale
  const num = absA * pow10(b.dscale + rscale);
  const den = absB * pow10(a.dscale);

  let q = num / den;
  const rem = num % den;
  if (rem * BIG_TWO >= den) q = q + BIG_ONE;

  return { u: negative ? -q : q, dscale: rscale };
}

/**
 * `a * b`, exact. numeric_mul() asks mul_var() for
 * `var1->dscale + var2->dscale` places, which is the full width of the
 * product, so nothing is rounded away.
 */
function mulNumeric(a: Numeric, b: Numeric): Numeric {
  return { u: a.u * b.u, dscale: a.dscale + b.dscale };
}

/** `trunc(n, dp)` — toward zero, like the SQL. BigInt division truncates. */
function truncNumeric(n: Numeric, dp: number): Numeric {
  if (n.dscale <= dp) {
    return { u: n.u * pow10(dp - n.dscale), dscale: dp };
  }
  return { u: n.u / pow10(n.dscale - dp), dscale: dp };
}

/** `round(n, dp)` — half away from zero, like PostgreSQL numeric round(). */
function roundNumeric(n: Numeric, dp: number): Numeric {
  if (n.dscale <= dp) {
    return { u: n.u * pow10(dp - n.dscale), dscale: dp };
  }
  const factor = pow10(n.dscale - dp);
  const negative = n.u < BIG_ZERO;
  const abs = negative ? -n.u : n.u;
  let rounded = abs / factor;
  if ((abs % factor) * BIG_TWO >= factor) rounded += BIG_ONE;
  return { u: negative ? -rounded : rounded, dscale: dp };
}

/* -------------------------------------------------------------------------- */
/*  The settlement formula                                                     */
/* -------------------------------------------------------------------------- */

export type PlayProRataInput = {
  /** One open trade's play_trades.shares — numeric(28,8). */
  shares: unknown;
  /** SUM(shares) over ALL open trades on the winning outcome — numeric(28,8). */
  totalWinningShares: unknown;
  /** play_market_states.virtual_pool_usd — numeric(18,2). */
  finalPoolUsd: unknown;
};

/**
 * The payout ONE open trade on the winning outcome would receive:
 *
 *     trunc(shares / total_winning * final_pool, 2)
 *
 * Returns a "0.00"-style decimal string, or null when any input is not a
 * decimal or the winning supply is zero. Null means "not known" and must be
 * rendered as an omitted row, never as zero — a zero here would tell a winner
 * they won nothing.
 *
 * Callers settle a POSITION by calling this once per open winning trade and
 * summing the results, because that is the order the SQL truncates in.
 */
export function playProRataPayoutUsd(input: PlayProRataInput): string | null {
  const shares = parseNumeric(input.shares, SHARES_SCALE);
  const total = parseNumeric(input.totalWinningShares, SHARES_SCALE);
  const pool = parseNumeric(input.finalPoolUsd, USD_SCALE);
  if (!shares || !total || !pool) return null;

  // total_winning = 0 never reaches the pro-rata branch in SQL: the
  // refund_all guard above it catches that case. Refuse to guess here too.
  if (total.u <= BIG_ZERO) return null;

  const quotient = divNumeric(shares, total);
  if (!quotient) return null;

  return formatNumeric(truncNumeric(mulNumeric(quotient, pool), USD_SCALE));
}

/**
 * Estimated payout for one CURRENT grouped Play position.
 *
 * Settlement truncates each trade independently before adding the results,
 * so callers must pass the original held trade-share rows rather than only a
 * grouped share total. This function is the shared fold used by profile and
 * trade displays; it delegates every row to the authoritative payout mirror
 * above and performs only an exact addition of the resulting cents.
 */
export function playCurrentPositionPayoutUsd(input: {
  tradeShares: unknown[];
  totalWinningShares: unknown;
  finalPoolUsd: unknown;
}): string | null {
  if (!Array.isArray(input.tradeShares) || input.tradeShares.length === 0) {
    return null;
  }

  let cents = BIG_ZERO;
  for (const shares of input.tradeShares) {
    const payout = playProRataPayoutUsd({
      shares,
      totalWinningShares: input.totalWinningShares,
      finalPoolUsd: input.finalPoolUsd,
    });
    if (payout === null) return null;
    const parsed = parseNumeric(payout, USD_SCALE);
    if (!parsed) return null;
    cents += parsed.u;
  }
  return formatNumeric({ u: cents, dscale: USD_SCALE });
}

/**
 * Authoritative quote for ONE hypothetical new Play trade.
 *
 * Settlement pays and truncates each trade row independently, so the new
 * purchase must be quoted as its own future row. Existing wallet holdings do
 * not enter the numerator; they only remain part of the market-wide winning
 * share denominator. `finalPoolUsdAfter` and `newTradeShares` are the exact
 * post-purchase values returned by the pricing quote.
 */
export function playNewTradeQuoteUsd(input: {
  newTradeShares: unknown;
  currentTotalWinningShares: unknown;
  finalPoolUsdAfter: unknown;
  newStakeUsd: unknown;
}): { payoutUsd: string; multiple: string } | null {
  const shares = parseNumeric(input.newTradeShares, SHARES_SCALE);
  const currentTotal = parseNumeric(input.currentTotalWinningShares, SHARES_SCALE);
  const stake = parseNumeric(input.newStakeUsd, USD_SCALE);
  if (!shares || !currentTotal || !stake) return null;
  if (shares.u <= BIG_ZERO || currentTotal.u < BIG_ZERO || stake.u <= BIG_ZERO) {
    return null;
  }

  const totalAfter = formatNumeric({
    u: currentTotal.u + shares.u,
    dscale: SHARES_SCALE,
  });
  const payoutUsd = playProRataPayoutUsd({
    shares: input.newTradeShares,
    totalWinningShares: totalAfter,
    finalPoolUsd: input.finalPoolUsdAfter,
  });
  if (payoutUsd === null) return null;
  const payout = parseNumeric(payoutUsd, USD_SCALE);
  if (!payout) return null;
  const multiple = divNumeric(payout, stake);
  if (!multiple) return null;

  return {
    payoutUsd,
    multiple: formatNumeric(roundNumeric(multiple, 4)),
  };
}
