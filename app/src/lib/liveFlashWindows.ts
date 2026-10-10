// app/src/lib/liveFlashWindows.ts
//
// THE single source of truth for flash-market timing.
//
// A live flash market starts immediately and runs for its full selected
// duration, but trading is only open for the FIRST slice of that window:
//
//     started_at = T0
//     lock_at    = T0 + trade window   <- trading closes here
//     end_at     = T0 + duration       <- market (and the result) ends here
//
// The trade window NEVER extends end_at. A 3-minute market launched at
// 20:00:00 locks at 20:02:15 and still resolves on the 20:00:00–20:03:00
// window; the final 45 seconds are watch-only.
//
// The host picks a DURATION only. The trade window is derived here and
// nowhere else — do not inline these numbers in a component, an API route
// or a migration.

/** Durations a host may pick, in minutes. Order is the UI order. */
export const FLASH_DURATION_OPTIONS = [1, 3, 5, 10, 15, 30] as const;

export type FlashDurationMin = (typeof FLASH_DURATION_OPTIONS)[number];

/** Pre-selected duration on every "new market" surface. */
export const DEFAULT_FLASH_DURATION_MIN = 5;

/**
 * Duration (minutes) -> trading window (seconds).
 *
 * The shape of this curve is deliberate: LIVE markets keep most of their
 * short duration tradable while retaining a final watch-only/result phase.
 */
const TRADE_WINDOW_SECONDS: Readonly<Record<number, number>> = {
  1: 45,
  3: 135,
  5: 240,
  10: 480,
  15: 720,
  30: 1500,
};

/** Absolute floor for a derived window, so no market is untradable. */
const MIN_TRADE_WINDOW_SECONDS = 10;

/**
 * True only for a duration the product actually offers.
 *
 * Strict about the TYPE too, not just the value: this guards a request body,
 * and `"5"` arriving where a number was specified means the caller is not the
 * UI. Coercing it would be the start of accepting whatever shows up.
 */
export function isSupportedFlashDurationMin(
  input: unknown,
): input is FlashDurationMin {
  return (
    typeof input === "number" &&
    Number.isInteger(input) &&
    (FLASH_DURATION_OPTIONS as readonly number[]).includes(input)
  );
}

/**
 * Gate for every path that CREATES a flash market.
 *
 * Creation rejects rather than snaps: a market whose duration was silently
 * changed under the host would get a trade window they never chose, and the
 * timestamps are written once and then binding. Read paths still snap (see
 * normalizeFlashDurationMin) because an already-existing market has to render
 * whatever it was created with.
 */
export function assertSupportedFlashDurationMin(input: unknown): FlashDurationMin {
  if (!isSupportedFlashDurationMin(input)) {
    throw new Error(
      `Unsupported market duration: ${String(input)}. Allowed: ${FLASH_DURATION_OPTIONS.join(
        " / ",
      )} minutes.`,
    );
  }
  return input;
}

/**
 * Snaps an arbitrary number of minutes onto the supported option list.
 *
 * For READ paths only — rendering a market that already exists with a legacy
 * duration (the old selectors offered 3/5/10/30, and the queue route used to
 * accept any positive integer). Creation must use
 * assertSupportedFlashDurationMin instead, so no NEW market can land on an
 * unsupported duration. Picks the nearest supported option; ties round DOWN,
 * which keeps a market shorter rather than silently extending it.
 */
export function normalizeFlashDurationMin(input: unknown): FlashDurationMin {
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FLASH_DURATION_MIN;

  let best: FlashDurationMin = FLASH_DURATION_OPTIONS[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const option of FLASH_DURATION_OPTIONS) {
    const delta = Math.abs(option - n);
    if (delta < bestDelta) {
      best = option;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * Trading window, in seconds, for a market of `durationMin` minutes.
 *
 * Unsupported durations fall back to the nearest supported one rather than
 * throwing — a market that already exists on-chain with an odd duration must
 * still get a usable lock. The result is always at least
 * MIN_TRADE_WINDOW_SECONDS and always strictly shorter than the market, so
 * lock_at < end_at holds for every input.
 */
export function tradeWindowSecondsFor(durationMin: unknown): number {
  const exact = Math.floor(Number(durationMin));
  const mapped =
    (Number.isFinite(exact) && TRADE_WINDOW_SECONDS[exact]) ||
    TRADE_WINDOW_SECONDS[normalizeFlashDurationMin(durationMin)];

  const durationSec =
    Number.isFinite(exact) && exact > 0
      ? exact * 60
      : normalizeFlashDurationMin(durationMin) * 60;

  // Never let the window swallow the whole market: keep at least one second
  // of watch-only time even in the pathological case.
  return Math.max(
    MIN_TRADE_WINDOW_SECONDS,
    Math.min(mapped, durationSec - 1),
  );
}

export type FlashMarketWindow = {
  /** T0 — the moment the market went live. */
  startedAt: Date;
  /** T0 + trade window. Trading is rejected at or after this instant. */
  lockAt: Date;
  /** T0 + duration. The market (and its result window) ends here. */
  endAt: Date;
  /** The duration actually used, after normalization. */
  durationMin: FlashDurationMin;
  /** The trade window actually used. */
  tradeWindowSec: number;
};

/**
 * Builds the three authoritative timestamps for a flash market that starts
 * now (or at `startedAt`, for tests). Every creation path — first market and
 * every chained market — goes through this, so a chained market always gets a
 * fresh, complete set rather than inheriting the previous market's clock.
 */
export function computeFlashMarketWindow(
  durationMinInput: unknown,
  startedAtMs: number = Date.now(),
): FlashMarketWindow {
  const durationMin = assertSupportedFlashDurationMin(durationMinInput);
  const tradeWindowSec = tradeWindowSecondsFor(durationMin);

  return {
    startedAt: new Date(startedAtMs),
    lockAt: new Date(startedAtMs + tradeWindowSec * 1000),
    endAt: new Date(startedAtMs + durationMin * 60 * 1000),
    durationMin,
    tradeWindowSec,
  };
}

/* -------------------------------------------------------------------------- */
/*  Deadline helpers (UI)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Parses a Supabase timestamp into epoch ms, or null.
 *
 * Supabase frequently returns `timestamp` columns with no timezone suffix.
 * `new Date` would read those as LOCAL time, which shifts a 60-second trade
 * window by whole hours. Bare timestamps are therefore forced to UTC — the
 * same normalization the live pages already apply to `end_date`.
 */
export function parseTimestampMs(raw: unknown): number | null {
  if (raw == null) return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : null;
  }
  const s = String(raw).trim();
  if (!s) return null;

  const normalized = s.includes(" ") ? s.replace(" ", "T") : s;
  const hasTz = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);
  const ms = new Date(hasTz ? normalized : `${normalized}Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whole seconds left until `deadlineMs`, floored at 0.
 *
 * Time remaining is ALWAYS recomputed from the deadline against the current
 * clock — never decremented from a previous value. That is what makes the
 * countdown survive a backgrounded tab, a sleeping device, a rerender, and a
 * viewer who joins halfway through the market.
 */
export function secondsUntil(deadlineMs: number | null, nowMs: number): number {
  if (deadlineMs == null || !Number.isFinite(deadlineMs)) return 0;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/** M:SS for anything under an hour, H:MM:SS beyond it. */
export function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * Recovers T0 from (trading_lock_at, end_at) alone, exactly.
 *
 * For a market of D minutes: lock = T0 + W(D) and end = T0 + 60D, so
 * end − lock = 60D − W(D). Across the supported durations that quantity is
 * 15 / 45 / 60 / 120 / 180 / 300 seconds — strictly increasing and
 * therefore uniquely invertible. So the market's own two timestamps pin down
 * its duration, and hence its start.
 *
 * This is the fallback for when `markets.created_at` is not in the payload
 * (getMarketByAddress degrades to narrower selects on older schemas). Without
 * it the drain bar would have no denominator and sit full until the lock;
 * with it the bar is correct from any surface. Returns null when the gap
 * matches no supported duration — a legacy market, where "no bar denominator"
 * is the honest answer.
 */
export function inferStartedAtMs(
  lockAtMs: number | null,
  endAtMs: number | null,
): number | null {
  if (lockAtMs == null || endAtMs == null) return null;
  if (!Number.isFinite(lockAtMs) || !Number.isFinite(endAtMs)) return null;

  const watchSec = Math.round((endAtMs - lockAtMs) / 1000);
  for (const d of FLASH_DURATION_OPTIONS) {
    if (d * 60 - tradeWindowSecondsFor(d) === watchSec) {
      return endAtMs - d * 60 * 1000;
    }
  }
  return null;
}

/** Urgency bands for the trade-window bar, by fraction of window remaining. */
export type TradeWindowUrgency = "green" | "yellow" | "orange" | "red";

export function tradeWindowUrgency(fractionRemaining: number): TradeWindowUrgency {
  const f = Number.isFinite(fractionRemaining) ? fractionRemaining : 0;
  if (f > 0.6) return "green";
  if (f >= 0.3) return "yellow";
  if (f > 0.1) return "orange";
  return "red";
}

export type TradeWindowState = {
  /** True while trading is still open. */
  open: boolean;
  /** Seconds until lock_at (0 once locked). */
  secondsToLock: number;
  /** Seconds until end_at (0 once the market is over). */
  secondsToEnd: number;
  /** 0..1 of the trade window still remaining — drains right to left. */
  fractionRemaining: number;
  urgency: TradeWindowUrgency;
};

/**
 * Derives the whole trade-window bar state from timestamps plus the current
 * clock. Pure — no component state, no interval accumulation. Returns null
 * when the market carries no lock timestamp (legacy markets created before
 * the trade window existed), which callers render as "no bar" rather than
 * inventing a deadline.
 */
export function deriveTradeWindowState(args: {
  lockAtMs: number | null;
  endAtMs: number | null;
  /** T0. Used only for the drain fraction; falls back to a derived origin. */
  startedAtMs?: number | null;
  nowMs: number;
}): TradeWindowState | null {
  const { lockAtMs, endAtMs, nowMs } = args;
  if (lockAtMs == null || !Number.isFinite(lockAtMs)) return null;

  const secondsToLock = secondsUntil(lockAtMs, nowMs);
  const secondsToEnd = secondsUntil(endAtMs, nowMs);
  const open = nowMs < lockAtMs;

  // Denominator = the real trade window, from persisted timestamps. Never
  // "seconds since this component mounted" — a viewer joining at T+45s of a
  // 60s window must see 25% remaining, not a full bar.
  const startedAtMs =
    args.startedAtMs != null && Number.isFinite(args.startedAtMs)
      ? args.startedAtMs
      : inferStartedAtMs(lockAtMs, endAtMs);
  const windowMs = startedAtMs != null ? lockAtMs - startedAtMs : 0;
  const fractionRemaining =
    windowMs > 0 ? Math.max(0, Math.min(1, (lockAtMs - nowMs) / windowMs)) : open ? 1 : 0;

  return {
    open,
    secondsToLock,
    secondsToEnd,
    fractionRemaining,
    urgency: tradeWindowUrgency(fractionRemaining),
  };
}
