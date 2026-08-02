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
  toDecimalString,
  type PayoutQualifier,
  type ResultCardInput,
  type ResultState,
} from "./resultCard";
import type { PlayHistoryTradeView, PlayProfilePositionView } from "./playClient";

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
  /** The market was cancelled — everyone gets their net cost back. */
  refunded?: boolean;
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

  const netCost = readNetCostLamports(positionAccount);
  const stake = netCost === null ? null : lamportsToSolString(netCost);

  const claimed = (positionAccount as { claimed?: unknown } | null)?.claimed === true;

  // A cancelled market returns exactly the net cost — that is the program's
  // own refund rule, not an estimate of ours, so it can be stated outright.
  if (input.refunded) {
    return {
      state: "refund",
      stake,
      payout: stake,
      profit: stake === null ? null : "0",
      payoutQualifier: claimed ? "claimed" : "claimable",
      claimAvailable: !claimed && stake !== null,
      winningShares: null,
    };
  }

  const state: ResultState = winningShares !== null && winningShares > 0 ? "win" : "lose";

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

/**
 * A share payload for one settled row of the public Play profile.
 *
 * Returns null — meaning "no Share button on this row" — whenever the row
 * cannot be described truthfully: an open position has no result, and a
 * settled row missing its realized P&L cannot state a profit. Nothing is
 * derived or back-filled here; the numbers are the ones settlement wrote.
 *
 * The winning outcome is deliberately absent: the profile knows which outcome
 * the player BACKED, not which one the market settled on, and guessing it on
 * a loss would put a false statement on a public card.
 *
 * Nothing account-scoped travels into the payload — no account id, balance,
 * session or trade id. The fields used here are the same ones the profile row
 * already renders publicly.
 */
export function buildPlayProfileShareInput(
  position: PlayProfilePositionView
): ResultCardInput | null {
  const { status } = position;
  if (status === "open") return null;

  const profit = toDecimalString(position.realized_pnl_usd);
  if (profit === null) return null;

  const state: ResultState =
    status === "won" ? "win" : status === "refunded" ? "refund" : "lose";

  const settledLabel = (() => {
    const raw = position.last_trade_at;
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  })();

  return {
    mode: "play",
    state,
    marketTitle: position.market_title,
    pickLabel: position.outcome_name || `Outcome #${position.outcome_index + 1}`,
    winningOutcomeLabel: null,
    marketResultText:
      state === "refund"
        ? "Market refunded."
        : settledLabel
        ? `Settled ${settledLabel}`
        : "Market finalized.",
    currency: "usd",
    stake: toDecimalString(position.total_stake_usd),
    payout: toDecimalString(position.payout_usd),
    profit,
    payoutQualifier: null,
    claimAvailable: false,
    provisional: false,
    marketPath: position.market_address ? `/trade/${position.market_address}` : null,
  };
}

/**
 * A PROVISIONAL Play result, built from the player's still-open trades on a
 * market whose outcome has only been proposed.
 *
 * Play settles on Real finalization, so at proposal time nothing is priced
 * yet: `stake` is authoritative (it was recorded when the trade executed) but
 * `payout` is genuinely unknown and stays null. Profit is filled in only for
 * a loss, where it is exactly the stake back out — a win's profit depends on
 * the payout, which does not exist yet.
 *
 * This reads the trade ledger and writes nothing. It does not settle, price
 * or credit anything.
 */
export function buildProvisionalPlayResultValues(
  trades: PlayHistoryTradeView[],
  marketAddress: string,
  winningIndex: number | null,
  refunded: boolean
): PlayResultValues | null {
  const mine = trades.filter(
    (t) => String(t.market_address || "").trim() === String(marketAddress || "").trim()
  );
  if (!mine.length) return null;

  // If settlement already ran, the authoritative path owns this result.
  if (mine.every((t) => t.status !== "open")) return null;

  const stake = sumDecimals(mine.map((t) => t.stake_usd));

  const pickLabel =
    mine
      .slice()
      .sort((a, b) => Number(b.stake_usd) - Number(a.stake_usd))
      .map((t) => t.outcome_name)
      .find((name): name is string => typeof name === "string" && name.trim().length > 0) ?? null;

  if (refunded) {
    return { state: "refund", stake, payout: null, profit: null, pickLabel };
  }

  if (winningIndex === null || !Number.isFinite(winningIndex)) return null;

  const holdsWinner = mine.some(
    (t) => Number(t.outcome_index) === Math.floor(winningIndex)
  );

  if (holdsWinner) {
    const winningStake = sumDecimals(
      mine
        .filter((t) => Number(t.outcome_index) === Math.floor(winningIndex))
        .map((t) => t.stake_usd)
    );
    const winningPick =
      mine.find((t) => Number(t.outcome_index) === Math.floor(winningIndex))?.outcome_name ?? pickLabel;
    return {
      state: "win",
      stake: winningStake,
      payout: null,
      profit: null,
      pickLabel: winningPick,
    };
  }

  return {
    state: "lose",
    stake,
    // Every stake on this market is lost if the proposal holds.
    profit: stake === null ? null : subtractDecimals("0", stake),
    payout: null,
    pickLabel,
  };
}
