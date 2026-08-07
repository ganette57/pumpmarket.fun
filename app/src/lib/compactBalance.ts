// src/lib/compactBalance.ts
//
// Compact balance formatting for the mobile header pill.
//
// Display-only. Two rules apply to everything here:
//
//   1. Never overstate. Every shortening TRUNCATES toward zero rather than
//      rounding, so a $7,399 balance reads "$7.3K" and never "$7.4K". A
//      header pill that rounds a balance up is a balance the user does not
//      have.
//   2. Never touch binary float for Play money. Play balances arrive as
//      decimal strings and are converted to integer cents by toCents(), so
//      the pill agrees with the exact figures shown in the trading panels.
//
// SOL is formatted from integer lamports for the same reason.

import { toCents } from "@/lib/playClient";

const BIG_ZERO = BigInt(0);
const BIG_HUNDRED = BigInt(100);
const BIG_THOUSAND = BigInt(1000);
const BIG_MILLION = BigInt(1_000_000);
const BIG_BILLION = BigInt(1_000_000_000);

/** Lamports per SOL. Kept local so this module has no web3.js dependency. */
export const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * `12345n, 1000n` -> "12.3" ; `12000n, 1000n` -> "12"
 *
 * One truncated decimal, with a trailing ".0" dropped so "$1.0K" reads "$1K".
 */
function oneDecimal(value: bigint, unit: bigint): string {
  const whole = value / unit;
  const tenths = ((value % unit) * BigInt(10)) / unit;
  return tenths === BIG_ZERO ? whole.toString() : `${whole}.${tenths}`;
}

/**
 * Compact USD for the header pill: "$850", "$7.3K", "$12.4K", "$1.2M".
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
export function formatCompactUsd(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!/^-?\d+(\.\d+)?$/.test(String(value).trim())) return null;

  const cents = toCents(value);
  if (cents === null) return null;

  const negative = cents < BIG_ZERO;
  const abs = negative ? -cents : cents;
  const dollars = abs / BIG_HUNDRED; // truncates the cents away

  let body: string;
  if (dollars < BIG_THOUSAND) {
    body = dollars.toString();
  } else if (dollars < BIG_MILLION) {
    body = `${oneDecimal(dollars, BIG_THOUSAND)}K`;
  } else if (dollars < BIG_BILLION) {
    body = `${oneDecimal(dollars, BIG_MILLION)}M`;
  } else {
    body = `${oneDecimal(dollars, BIG_BILLION)}B`;
  }

  return `${negative ? "-" : ""}$${body}`;
}

/**
 * Compact SOL for the header pill: "0.18 SOL", "2.4 SOL", "123 SOL".
 *
 * Takes raw lamports (what `connection.getBalance` returns) so no precision
 * is lost on the way in. A dust balance shows "<0.01 SOL" instead of
 * collapsing to "0 SOL", which would read as an empty wallet.
 */
export function formatCompactSol(lamports: number | null | undefined): string | null {
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
    // Under 1 SOL: two decimals, e.g. "0.18 SOL".
    return `${sign}0.${String(centiSol).padStart(2, "0")} SOL`;
  }

  const whole = Math.floor(centiSol / 100);

  if (whole < 100) {
    // Under 100 SOL: up to two decimals, trailing zeros trimmed ("2.4 SOL").
    const frac = String(centiSol % 100).padStart(2, "0").replace(/0+$/, "");
    return frac ? `${sign}${whole}.${frac} SOL` : `${sign}${whole} SOL`;
  }

  if (whole < 1000) return `${sign}${whole} SOL`;

  return `${sign}${oneDecimal(BigInt(whole), BIG_THOUSAND)}K SOL`;
}
