// src/lib/playSettlement.ts
//
// The boundary between Real finalization and Play settlement.
//
// WHY THIS FILE EXISTS
// --------------------
// Play settlement was manual-only: play_settle_market existed and was
// correct, /api/play/settle exposed it to an admin, but NOTHING called it
// when a market actually finalized. So a Real market could be finalized on
// NO while every Play trade on that market stayed 'open' forever, with
// realized_pnl_usd null and no payout. That is the bug this module closes.
//
// THE ONE RULE: REAL IS NEVER HELD HOSTAGE BY PLAY
// ------------------------------------------------
// Real finalization is an on-chain transaction that has ALREADY landed by
// the time these callers run. Nothing here may throw, and nothing here may
// change what the caller reports about Real. So this function never throws:
// every outcome — success, no-op, misconfiguration, engine fault — comes
// back as a structured report the caller attaches to its response. Callers
// keep their own `ok` untouched.
//
// But a failure is never swallowed either. `needs_attention` is the flag an
// operator acts on, and the admin UI renders the message next to the Real
// success line, so "Real finalized, Play settlement failed" can never read
// as a clean success. Retry is always safe (see below).
//
// NO PAYOUT MATH LIVES HERE
// -------------------------
// Not one line. play_settle_market owns the pro-rata formula, the winning
// share aggregation, the balance credits, the ledger rows, the trade status
// / payout_usd / realized_pnl_usd writes, the refund path and the terminal
// state bump — all inside ONE Postgres transaction. This module marshals a
// market address and classifies the result.

import { settleMarket, PlayEngineError } from "@/lib/playEngine";

export type PlaySettlementStatus =
  /** THIS call settled the market and moved the money. */
  | "settled"
  /** A previous call already settled it. A true no-op — nothing moved. */
  | "already_settled"
  /** Nobody ever traded this market in Play. Normal; nothing to settle. */
  | "no_play_state"
  /** The Real market is not in a terminal state, so Play correctly waited. */
  | "not_terminal"
  /** Real's winning outcome no longer matches what Play already paid out on. */
  | "conflict"
  /** The engine call failed. Nothing partial: the RPC is one transaction. */
  | "failed";

export type PlaySettlementReport = {
  status: PlaySettlementStatus;
  /** One operator-facing line. Safe to render in the admin UI verbatim. */
  message: string;
  /** True when a human must retry or investigate. Drives the admin warning. */
  needs_attention: boolean;
  market_address: string;
  /** The outcome Play settled on, as recorded by the engine. */
  winning_outcome?: number | null;
  /** Trades settled by THIS call — 0 on a repeat. */
  trades_settled?: number;
  /** USD paid out by THIS call — "0" on a repeat. */
  paid_out_usd?: string;
  /** Only on `failed`. Already a safe, user-level message. */
  error?: string;
};

/**
 * Settles the Play side of a market that has just reached a terminal state
 * in Supabase. Safe to call after EVERY finalization and EVERY cancellation.
 *
 * THE WINNING OUTCOME IS NOT A PARAMETER, ON PURPOSE
 * ---------------------------------------------------
 * play_settle_market re-reads markets.resolution_status and
 * markets.winning_outcome itself, under its own lock. Passing an outcome in
 * would create a second, weaker source of truth that could disagree with the
 * row Real just wrote — exactly the class of bug that makes a Play payout
 * land on the wrong side. Callers write the Real row first, then call this;
 * the engine reads what they wrote.
 *
 * `expectedWinningOutcome` is therefore a CHECK, not an input: it is never
 * used to settle, only to detect that an ALREADY-settled Play market paid
 * out on a different outcome than Real now reports.
 *
 * IDEMPOTENCY
 * -----------
 * Guaranteed by the engine, not by this module. play_settle_market returns
 * early the moment it sees a non-'open' Play market state: no version bump,
 * no updated_at, no ledger row, no balance change, no trade change. Below
 * that, play_ledger's unique (account_id, idempotency_key) is a hard backstop.
 * So a retry — from the admin UI, a cron, or the backfill script — can never
 * double-pay.
 */
export async function settlePlayForMarket(
  marketAddress: string,
  opts?: { expectedWinningOutcome?: number | null }
): Promise<PlaySettlementReport> {
  const market = String(marketAddress || "").trim();

  try {
    const result = await settleMarket(market);

    const winningOutcome =
      result.winning_outcome === undefined ? null : result.winning_outcome;
    const tradesSettled = Number(result.trades_settled ?? 0);
    const paidOut = String(result.paid_out_usd ?? "0");

    // Play state exists only once someone has quoted or traded the market.
    // A market nobody played is a normal, complete outcome.
    if (result.reason === "no play state") {
      return {
        status: "no_play_state",
        message: "No Play trades on this market — nothing to settle.",
        needs_attention: false,
        market_address: market,
      };
    }

    // The engine refused because Real is not terminal yet. Callers only run
    // after writing a terminal row, so reaching this means the write did not
    // land the way we think it did — worth an operator's eyes.
    if (result.settled === false) {
      return {
        status: "not_terminal",
        message:
          `Play NOT settled — the market is not in a terminal state ` +
          `(${result.resolution_status ?? "unknown"}). Retry once the Real ` +
          `status is finalized or cancelled.`,
        needs_attention: true,
        market_address: market,
        winning_outcome: winningOutcome,
        trades_settled: 0,
      };
    }

    if (result.already_settled) {
      // A settled Play market whose outcome disagrees with what Real now
      // reports. Nothing was mutated — the engine returned before touching a
      // row — but a human must reconcile the two.
      const expected = opts?.expectedWinningOutcome;
      if (
        expected !== undefined &&
        expected !== null &&
        winningOutcome !== null &&
        winningOutcome !== expected
      ) {
        return {
          status: "conflict",
          message:
            `CONFLICT — Play already settled this market on outcome ` +
            `${winningOutcome}, but Real now reports outcome ${expected}. ` +
            `Nothing was changed. Reconcile manually before retrying.`,
          needs_attention: true,
          market_address: market,
          winning_outcome: winningOutcome,
          trades_settled: 0,
        };
      }

      return {
        status: "already_settled",
        message: `Play was already settled (outcome ${
          winningOutcome ?? "cancelled/refunded"
        }). Nothing changed.`,
        needs_attention: false,
        market_address: market,
        winning_outcome: winningOutcome,
        trades_settled: 0,
      };
    }

    return {
      status: "settled",
      message:
        `Play settled: ${tradesSettled} trade${tradesSettled === 1 ? "" : "s"}` +
        `, $${paidOut} paid out` +
        (result.reason === "cancelled"
          ? " (refunded — market cancelled)."
          : result.reason === "no_winning_positions"
            ? " (refunded — nobody held the winning outcome)."
            : `, outcome ${winningOutcome}.`),
      needs_attention: false,
      market_address: market,
      winning_outcome: winningOutcome,
      trades_settled: tradesSettled,
      paid_out_usd: paidOut,
    };
  } catch (e: unknown) {
    // The RPC is one transaction: a throw means nothing was committed, so a
    // retry starts from a clean 'open' state.
    const message =
      e instanceof PlayEngineError ? e.message : "Play settlement failed.";
    console.error("[playSettlement] settlement failed for", market, e);
    return {
      status: "failed",
      message: `Play settlement FAILED — ${message} Real is unaffected; retry is safe.`,
      needs_attention: true,
      market_address: market,
      error: message,
    };
  }
}
