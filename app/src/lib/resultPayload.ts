// src/lib/resultPayload.ts
//
// Turns the raw settlement data each surface already holds into the numbers
// the result modal is allowed to show.
//
// This module derives NOTHING it cannot prove. Every field is `string | null`
// and null propagates: if the on-chain position account was not decoded, or
// the winning supply is unknown, the payout and the profit come back null and
// the modal simply omits those rows. It never falls back to zero, and it
// never re-implements settlement — the Real payout formula below is the same
// share-of-the-pot ratio /dashboard already uses to size a claim.

import {
  lamportsToSolString,
  subtractDecimals,
  sumDecimals,
  type PayoutQualifier,
  type ResultState,
} from "./resultCard";
import type { PlayHistoryTradeView } from "./playClient";

/* -------------------------------------------------------------------------- */
/*  Real                                                                       */
/* -------------------------------------------------------------------------- */

export type RealResultInput = {
  /** Decoded `userPosition`. Null when it could not be read. */
  positionAccount: unknown;
  /** Decoded `market`. Null when it could not be read. */
  marketAccount: unknown;
  /** Lamports held by the market account — the pot the payout comes from. */
  marketLamports: number | null;
  winningIndex: number | null;
  /** True once resolution is FINAL on-chain (not merely proposed). */
  finalized: boolean;
};

export type RealResultValues = {
  state: ResultState;
  stake: string | null;
  payout: string | null;
  profit: string | null;
  payoutQualifier: PayoutQualifier | null;
  claimAvailable: boolean;
  winningShares: number | null;
};

function readNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readSharesArray(account: unknown): number[] | null {
  const shares = (account as { shares?: unknown } | null)?.shares;
  if (!Array.isArray(shares)) return null;
  return shares.map((x) => Math.max(0, Math.floor(readNumber(x) ?? 0)));
}

/**
 * Net lamports the wallet has put into this market (buys minus sells). The
 * on-chain field is an i128, so it arrives as a BN — stringify rather than
 * Number() it before taking the magnitude.
 */
function readNetCostLamports(positionAccount: unknown): bigint | null {
  const acc = positionAccount as Record<string, unknown> | null;
  const raw = acc?.netCostLamports ?? acc?.net_cost_lamports;
  if (raw === null || raw === undefined) return null;
  try {
    const asString = String(raw).trim();
    if (!/^-?\d+$/.test(asString)) return null;
    const big = BigInt(asString);
    return big < BigInt(0) ? -big : big;
  } catch {
    return null;
  }
}

export function buildRealResultValues(input: RealResultInput): RealResultValues {
  const { positionAccount, marketAccount, marketLamports, winningIndex, finalized } = input;

  const shares = readSharesArray(positionAccount);
  const winningShares =
    shares && winningIndex !== null && winningIndex >= 0 && winningIndex < shares.length
      ? shares[winningIndex]
      : null;

  const state: ResultState = winningShares !== null && winningShares > 0 ? "win" : "lose";

  const netCost = readNetCostLamports(positionAccount);
  const stake = netCost === null ? null : lamportsToSolString(netCost);

  const claimed = (positionAccount as { claimed?: unknown } | null)?.claimed === true;

  let payout: string | null = null;
  let payoutQualifier: PayoutQualifier | null = null;

  if (state === "win") {
    if (claimed) {
      // Post-claim the pot no longer contains this payout, so the ratio below
      // would understate it. Label it truthfully and show no number.
      payoutQualifier = "claimed";
    } else {
      const qArray = (marketAccount as { q?: unknown } | null)?.q;
      const winningSupply =
        Array.isArray(qArray) && winningIndex !== null
          ? Math.floor(readNumber(qArray[winningIndex]) ?? 0)
          : 0;

      if (winningSupply > 0 && marketLamports !== null && marketLamports > 0 && winningShares) {
        const lamports =
          (BigInt(winningShares) * BigInt(Math.floor(marketLamports))) / BigInt(winningSupply);
        payout = lamportsToSolString(lamports);
        payoutQualifier = finalized ? "claimable" : "estimated";
      }
    }
  }

  const profit =
    state === "win"
      ? subtractDecimals(payout, stake)
      : stake === null
      ? null
      : subtractDecimals("0", stake);

  return {
    state,
    stake,
    payout,
    profit,
    payoutQualifier,
    // Only true when there is genuinely something left to claim.
    claimAvailable: state === "win" && !claimed && finalized,
    winningShares,
  };
}

/* -------------------------------------------------------------------------- */
/*  Play                                                                       */
/* -------------------------------------------------------------------------- */

export type PlayResultValues = {
  state: ResultState;
  stake: string | null;
  payout: string | null;
  profit: string | null;
  pickLabel: string | null;
};

/**
 * Folds every settled Play trade this wallet made on one market into a single
 * result. Returns null while nothing has settled — an unsettled position has
 * no result to announce.
 *
 * `payout_usd` and `realized_pnl_usd` are authoritative server values written
 * by settlement; they are summed exactly, never recomputed from odds.
 */
export function buildPlayResultValues(
  trades: PlayHistoryTradeView[],
  marketAddress: string
): PlayResultValues | null {
  const mine = trades.filter(
    (t) => String(t.market_address || "").trim() === String(marketAddress || "").trim()
  );
  if (!mine.length) return null;

  const settled = mine.filter((t) => t.status !== "open");
  if (!settled.length) return null;

  const won = settled.filter((t) => t.status === "won");
  const refunded = settled.filter((t) => t.status === "refunded");

  const state: ResultState =
    won.length > 0 ? "win" : refunded.length === settled.length ? "refund" : "lose";

  const stake = sumDecimals(settled.map((t) => t.stake_usd));
  const payout = sumDecimals(settled.map((t) => t.payout_usd));
  const profit = sumDecimals(settled.map((t) => t.realized_pnl_usd));

  // The pick is the outcome the user actually backed: the winning one on a
  // win, otherwise the outcome carrying the largest stake.
  const pickSource = won.length ? won : settled;
  const pickLabel =
    pickSource
      .slice()
      .sort((a, b) => Number(b.stake_usd) - Number(a.stake_usd))
      .map((t) => t.outcome_name)
      .find((name): name is string => typeof name === "string" && name.trim().length > 0) ?? null;

  return { state, stake, payout, profit, pickLabel };
}
