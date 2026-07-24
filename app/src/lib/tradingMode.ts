// src/lib/tradingMode.ts
//
// The global Play/Real trading mode — shared vocabulary only.
//
// This module is intentionally framework-free and dependency-free so it can
// be imported from a server component (the root layout, reading the cookie)
// and from client components alike. It contains NO React, NO trading logic
// and NO API calls.
//
// Play is an execution mode, not a separate application: the mode decides
// where balances/quotes/executions come from, never which page renders.

export type TradingMode = "real" | "play";

/**
 * Non-httpOnly on purpose: the client switch has to update it without a
 * round trip, and the value carries no secret — it is a display preference.
 */
export const FM_MODE_COOKIE = "fm_mode";

/** Production default. Real is the live product; Play is opt-in. */
export const DEFAULT_TRADING_MODE: TradingMode = "real";

/** One year — the choice should feel sticky across sessions. */
export const FM_MODE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isTradingMode(value: unknown): value is TradingMode {
  return value === "real" || value === "play";
}

/** Narrows any raw cookie value to a valid mode, falling back to the default. */
export function parseTradingMode(value: unknown): TradingMode {
  return isTradingMode(value) ? value : DEFAULT_TRADING_MODE;
}
