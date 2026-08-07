// src/lib/playLiveResult.ts
//
// The Play result lookup shared by the two live surfaces — /live/[id] and the
// mobile /live feed. It exists so those pages cannot drift apart from each
// other, or from /trade/[id], which already had this logic inline.
//
// WHAT THIS IS FOR
// ----------------
// A live market announces its outcome twice: the host PROPOSES one, and four
// hours later the dispute window closes and it FINALIZES. Play traders were
// getting nothing at the proposal — both live pages bailed out with an
// `if (isPlay) return`, because the only result path they had read Real
// on-chain positions. This reads the Play trade ledger instead.
//
// WHAT IT WILL NOT DO
// -------------------
// It never settles, prices or credits anything: it POSTs to /api/play/history
// and reads. At proposal time the stake is authoritative — it was recorded
// when the trade executed — but the payout genuinely does not exist yet,
// because Play settles only when the Real market finalizes. The builders below
// leave it null and the modal drops the row rather than showing a number
// nobody can stand behind.
//
// Real data never enters here, and nothing from here reaches a Real modal.

import { playClient } from "./playClient";
import {
  buildPlayResultValues,
  buildProvisionalPlayResultValues,
} from "./resultPayload";
import { resultSeenKey } from "./resultSeen";
import type { ResultState } from "./resultCard";

/** Matches the page size /trade/[id] already uses for the same lookup. */
const HISTORY_LIMIT = 200;

export type PlayLiveResult = {
  state: ResultState;
  /**
   * True while these numbers are not yet settlement-authoritative — either the
   * outcome is merely proposed, or it is final but Play settlement has not run
   * yet. The modal downgrades every money label to an estimate when set.
   */
  provisional: boolean;
  pickLabel: string | null;
  stake: string | null;
  payout: string | null;
  profit: string | null;
};

/**
 * Three outcomes, deliberately distinguished:
 *
 *   ok          — this wallet has a Play position and here is its result
 *   none        — the ledger was read and this wallet has no position here;
 *                 a definitive answer, so callers can stop asking
 *   unavailable — no Play session, or the request failed; says nothing about
 *                 the wallet, so callers should retry on a later poll
 *
 * Collapsing `none` and `unavailable` into null would force a caller to pick
 * between re-fetching history every poll forever or silently swallowing a
 * result it could have shown once the session came back.
 */
export type PlayLiveLookup =
  | { status: "ok"; values: PlayLiveResult }
  | { status: "none" }
  | { status: "unavailable" };

/**
 * The dedupe key for a Play result on a live surface.
 *
 * `marketId` must be the SAME identifier /trade/[id] uses — the DB id when
 * there is one, the on-chain address otherwise. That is what stops a result
 * shown on the live page from being announced a second time after the page
 * redirects to /trade.
 *
 * Keyed on the outcome rather than the status, so proposed(X) → finalized(X)
 * is one result shown once, while a changed outcome is a new result that may
 * legitimately open a second modal. See src/lib/resultSeen.ts.
 */
export function playLiveSeenKey(args: {
  /** Wallet base58. */
  account: string;
  marketId: string;
  winningIndex: number | null;
  refunded: boolean;
}): string {
  return resultSeenKey({
    mode: "play",
    account: args.account,
    market: args.marketId,
    outcomeIndex: args.winningIndex,
    refunded: args.refunded,
  });
}

/**
 * Reads the connected wallet's own Play trades and folds the ones on this
 * market into a single result.
 *
 * `/api/play/history` resolves the account from the Play session cookie, so
 * there is no market parameter to pass and no way to read another wallet's
 * trades. Filtering to this market happens in the builders.
 */
export async function fetchPlayLiveResult(args: {
  /** On-chain market address — how trades are matched to this market. */
  marketAddress: string;
  /** The proposed (or final) outcome. Null on a cancellation. */
  winningIndex: number | null;
  refunded: boolean;
  /** True once the Real market is finalized, not merely proposed. */
  finalized: boolean;
}): Promise<PlayLiveLookup> {
  const address = String(args.marketAddress || "").trim();
  if (!address) return { status: "none" };

  let trades;
  try {
    trades = await playClient.history({ limit: HISTORY_LIMIT });
  } catch {
    // No Play session, or the request failed. Stay silent rather than guess.
    return { status: "unavailable" };
  }

  // Settlement already ran: those numbers are authoritative and win outright.
  const settled = buildPlayResultValues(trades, address);
  if (settled) {
    return {
      status: "ok",
      // Finalized on chain but settled in Play means real numbers. Anything
      // short of finalized still carries the provisional notice.
      values: { ...settled, provisional: !args.finalized },
    };
  }

  // Otherwise the outcome is only proposed (or Play settlement has not caught
  // up yet). This prices nothing: win → payout and profit stay null; lose →
  // profit is exactly the recorded stake back out.
  const provisional = buildProvisionalPlayResultValues(
    trades,
    address,
    args.winningIndex,
    args.refunded
  );
  if (!provisional) return { status: "none" };

  return { status: "ok", values: { ...provisional, provisional: true } };
}
