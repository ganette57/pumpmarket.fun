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
// It never settles, credits or moves anything: it POSTs to /api/play/history
// and /api/play/settlement-preview, and reads. Both are read-only; neither
// calls play_settle_market.
//
// On a provisional WIN it does state an ESTIMATED payout, and that estimate is
// not a guess. It comes from playPayoutMath.ts running the identical formula
// play_settle_market runs, over the identical Play book — never from displayed
// odds or an implied multiple. When the book cannot be read exactly the payout
// stays null and the modal drops the row rather than showing a number nobody
// can stand behind.
//
// Real data never enters here, and nothing from here reaches a Real modal.

import { playClient } from "./playClient";
import {
  buildPlayResultValues,
  buildProvisionalPlayResultValues,
  type PlayResultValues,
} from "./resultPayload";
import { resultSeenKey } from "./resultSeen";
import type { PlayHistoryTradeView } from "./playClient";
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
 * Folds an already-fetched trade list into one market's result, settled
 * numbers first and a priced provisional estimate second.
 *
 * EVERY Play surface goes through here — /live/[id], the mobile /live feed and
 * /trade/[id] — so a result can never mean one thing on one page and
 * something else on another. Returns null when this wallet has no position on
 * this market.
 *
 * The only network call is the read-only settlement book, and only for a
 * provisional WIN: a loss already knows its profit, and a settled result needs
 * no estimate at all.
 */
export async function resolvePlayResultValues(args: {
  trades: PlayHistoryTradeView[];
  marketAddress: string;
  winningIndex: number | null;
  refunded: boolean;
}): Promise<{ values: PlayResultValues; settled: boolean } | null> {
  const address = String(args.marketAddress || "").trim();
  if (!address) return null;

  // Settlement already ran: those numbers are authoritative and win outright.
  const settled = buildPlayResultValues(args.trades, address);
  if (settled) return { values: settled, settled: true };

  // Otherwise the outcome is only proposed (or Play settlement has not caught
  // up yet). Lose → profit is exactly the recorded stake back out, and no
  // book is needed for it.
  const provisional = buildProvisionalPlayResultValues(
    args.trades,
    address,
    args.winningIndex,
    args.refunded
  );
  if (!provisional) return null;

  // Only a win needs a price, so the extra request is only made for one.
  if (provisional.state !== "win" || args.winningIndex === null) {
    return { values: provisional, settled: false };
  }

  let book = null;
  try {
    book = await playClient.settlementPreview({
      marketAddress: address,
      winningOutcome: args.winningIndex,
    });
  } catch {
    // The result itself is already known and correct — only the estimate is
    // missing. Fall through with the unpriced values rather than losing a
    // real win over a failed side request.
    book = null;
  }
  if (!book) return { values: provisional, settled: false };

  const priced =
    buildProvisionalPlayResultValues(
      args.trades,
      address,
      args.winningIndex,
      args.refunded,
      book
    ) ?? provisional;

  return { values: priced, settled: false };
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

  const resolved = await resolvePlayResultValues({
    trades,
    marketAddress: address,
    winningIndex: args.winningIndex,
    refunded: args.refunded,
  });
  if (!resolved) return { status: "none" };

  return {
    status: "ok",
    values: {
      ...resolved.values,
      // Finalized on chain AND settled in Play means real numbers. Anything
      // short of that still carries the provisional notice.
      provisional: resolved.settled ? !args.finalized : true,
    },
  };
}
