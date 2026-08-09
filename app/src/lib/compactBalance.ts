// src/lib/compactBalance.ts
//
// Balance formatting for the mobile header pill.
//
// POLICY: ordinary balances are shown IN FULL. This module used to shorten
// everything — "$5.5K" for $5,500 — which is fine for a stat and wrong for
// an account balance, because a balance is a number the user is about to
// make a decision with. Thousands separators, cents only when they mean
// something: "$5,500", "$850", "$12,450.75", "$0.50".
//
// Compaction survives only as an overflow valve above $1M, where the full
// string genuinely stops fitting a 390px header.
//
// Two rules still hold everywhere here:
//
//   1. Never overstate. Any shortening TRUNCATES toward zero, so $1,299,000
//      reads "$1.2M" and never "$1.3M". A header that rounds a balance up
//      is a balance the user does not have.
//   2. Never touch binary float for Play money. Play balances arrive as
//      decimal strings and go through toCents(), so the pill agrees exactly
//      with the figures the trading panels check a stake against.
//
// SOL is formatted from integer lamports for the same reason.

import { formatUsd, toCents } from "@/lib/playClient";

const BIG_ZERO = BigInt(0);
const BIG_HUNDRED = BigInt(100);
const BIG_MILLION = BigInt(1_000_000);
const BIG_BILLION = BigInt(1_000_000_000);

/** Lamports per SOL. Kept local so this module has no web3.js dependency. */
export const LAMPORTS_PER_SOL = 1_000_000_000;

/** `1234567` -> "1,234,567". */
function group(value: number | bigint): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * `12345n, 1000n` -> "12.3" ; `12000n, 1000n` -> "12"
 *
 * One truncated decimal, with a trailing ".0" dropped so "$1.0M" reads "$1M".
 */
function oneDecimal(value: bigint, unit: bigint): string {
  const whole = value / unit;
  const tenths = ((value % unit) * BigInt(10)) / unit;
  return tenths === BIG_ZERO ? whole.toString() : `${whole}.${tenths}`;
}

/**
 * Play balance for the header pill: "$850", "$5,500", "$12,450.75", "$0.50".
 * Above $1M it falls back to "$1.2M" / "$3.4B" so the header cannot overflow.
 *
 * Accepts the decimal string the Play API returns. Returns null when the
 * input is not a number at all — the caller renders a neutral placeholder
 * rather than inventing "$0".
 *
 * The shape is validated HERE rather than leaning on toCents(), which
 * normalises anything unparseable to zero. That is the right behaviour for
 * arithmetic (a trade must never see NaN) and the wrong one for a header:
 * it would turn "balance unknown" into a confident "$0".
 */
export function formatBalanceUsd(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!/^-?\d+(\.\d+)?$/.test(String(value).trim())) return null;

  const cents = toCents(value);
  if (cents === null) return null;

  const negative = cents < BIG_ZERO;
  const abs = negative ? -cents : cents;
  const dollars = abs / BIG_HUNDRED; // truncates the cents away

  // Ordinary balances reuse formatUsd() — the same grouping the trading
  // panels print — so the header and the panel can never disagree about
  // what the user has. `compact` only drops a meaningless ".00" tail.
  if (dollars < BIG_MILLION) return formatUsd(value, { compact: true });

  const body =
    dollars < BIG_BILLION
      ? `${oneDecimal(dollars, BIG_MILLION)}M`
      : `${oneDecimal(dollars, BIG_BILLION)}B`;

  return `${negative ? "-" : ""}$${body}`;
}

/**
 * Wallet balance for the header pill: "0.28 SOL", "2.4 SOL", "125 SOL".
 *
 * Takes raw lamports (what `connection.getBalance` returns) so no precision
 * is lost on the way in. A dust balance shows "<0.01 SOL" instead of
 * collapsing to "0 SOL", which would read as an empty wallet.
 *
 * No "K" abbreviation at any size — a large holding is still shown as the
 * number it is, grouped.
 */
export function formatBalanceSol(lamports: number | null | undefined): string | null {
  if (lamports === null || lamports === undefined) return null;
  if (!Number.isFinite(lamports)) return null;

  const negative = lamports < 0;
  const abs = Math.trunc(Math.abs(lamports));
  const sign = negative ? "-" : "";

  if (abs === 0) return "0 SOL";

  // Hundredths of a SOL, truncated — the finest unit the pill ever shows.
  const centiSol = Math.floor(abs / (LAMPORTS_PER_SOL / 100));
  if (centiSol === 0) return `${sign}<0.01 SOL`;

  if (centiSol < 100) {
    // Under 1 SOL: two decimals, e.g. "0.28 SOL".
    return `${sign}0.${String(centiSol).padStart(2, "0")} SOL`;
  }

  const whole = Math.floor(centiSol / 100);

  if (whole < 100) {
    // Under 100 SOL: up to two decimals, trailing zeros trimmed ("2.4 SOL").
    const frac = String(centiSol % 100).padStart(2, "0").replace(/0+$/, "");
    return frac ? `${sign}${whole}.${frac} SOL` : `${sign}${whole} SOL`;
  }

  // 100 SOL and up: whole SOL only. The hundredths stop carrying meaning at
  // that size and cost more header width than they are worth.
  return `${sign}${group(whole)} SOL`;
}
