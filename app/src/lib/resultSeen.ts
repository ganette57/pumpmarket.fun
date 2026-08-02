// src/lib/resultSeen.ts
//
// "Has this user already been shown THIS result?" — shared by every surface
// that opens the result modal, so the three of them cannot disagree.
//
// THE KEY IS THE RESULT, NOT THE STATUS
// -------------------------------------
// A market is announced twice: once when the host proposes an outcome, and
// again when it finalizes after the dispute window. Keying on the status
// would fire a second modal for an outcome the user has already seen and
// possibly already shared. Keying on the OUTCOME instead makes the three
// required behaviours fall out on their own:
//
//   proposed(1) -> finalized(1)   same key   -> shown once          ✅
//   proposed(1) -> finalized(0)   new key    -> corrected result    ✅
//   proposed(1) -> cancelled      new key    -> refund notified     ✅
//
// Mode and wallet are in the key too: a Play result and a Real result on the
// same market are different results, and two wallets on one browser must not
// inherit each other's history.

import type { ResultMode } from "./resultCard";

export type ResultIdentity = {
  mode: ResultMode;
  /** Wallet or Play account identifier. */
  account: string;
  /** Market address or DB id — whatever the surface has. */
  market: string;
  /**
   * The outcome the user is being told about, or null for a refund/cancel.
   * NOT the resolution status: see the note above.
   */
  outcomeIndex: number | null;
  /** True when the market was cancelled/refunded rather than resolved. */
  refunded?: boolean;
};

const PREFIX = "fm_result_seen";

export function resultSeenKey(id: ResultIdentity): string {
  const outcome = id.refunded
    ? "refund"
    : id.outcomeIndex === null || !Number.isFinite(id.outcomeIndex)
    ? "unknown"
    : `out${Math.floor(id.outcomeIndex)}`;
  return `${PREFIX}:${id.mode}:${id.account}:${id.market}:${outcome}`;
}

/** Storage is best-effort: a blocked localStorage must not suppress results. */
export function hasSeenResult(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markResultSeen(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* private mode / quota — the in-memory guard still prevents a loop */
  }
}
