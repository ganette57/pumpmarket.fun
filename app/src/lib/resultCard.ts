// src/lib/resultCard.ts
//
// The shareable market-result model — the single source of truth for what a
// win / loss / refund says, in Play and in Real.
//
// Framework-free and side-effect-free on purpose: the modal, the canvas
// painter and the X post text all read the SAME view model, so the card a
// user shares can never disagree with the modal they saw.
//
// MONEY IS NEVER A FLOAT HERE. Every amount enters as an exact decimal
// string ("12.50", "-0.4200") and is rounded/grouped with BigInt. Play
// amounts arrive as USD decimals straight from play_trades; Real amounts are
// built from integer lamports by lamportsToSolString(). Nothing in this file
// invents, estimates or derives a monetary value — it only formats what the
// caller proved. `null` means "not known" and renders as an omitted row,
// never as zero.

export type ResultMode = "play" | "real";
export type ResultState = "win" | "lose" | "refund";
export type ResultCurrency = "usd" | "sol";

/**
 * How the Real payout should be described. Getting this wrong would tell a
 * user they were paid when they were not, so it is required whenever a Real
 * payout is shown.
 *
 * - "claimable" — resolution is final on-chain, the payout can be claimed now
 * - "estimated" — outcome proposed but not finalized, nothing is claimable yet
 * - "claimed"   — the position account is already marked claimed
 */
export type PayoutQualifier = "claimable" | "estimated" | "claimed";

export type ResultCardInput = {
  mode: ResultMode;
  state: ResultState;
  /** The market question. Truncated for display, never for the payload. */
  marketTitle: string | null;
  /** The outcome the user backed. */
  pickLabel: string | null;
  /** The outcome the market settled on. */
  winningOutcomeLabel: string | null;
  /** Settlement status sentence, e.g. "Market finalized." */
  marketResultText: string | null;
  currency: ResultCurrency;
  /** Exact decimal strings. null = not known — the row is dropped. */
  stake: string | null;
  payout: string | null;
  /** Signed. null = not known. */
  profit: string | null;
  payoutQualifier: PayoutQualifier | null;
  /** Real only: the payout still needs a Claim to reach the wallet. */
  claimAvailable?: boolean;
  /** Public market URL path (e.g. "/trade/<address>"). */
  marketPath?: string | null;
};

export type ResultTone = "positive" | "negative" | "neutral";

export type ResultCardRow = { label: string; value: string };

export type ResultCardView = {
  mode: ResultMode;
  state: ResultState;
  /** "PLAY RESULT" | "REAL RESULT" */
  modeLabel: string;
  /** Modal headline. */
  headline: string;
  /** Card verb — "WON" | "LOST" | "REFUNDED". */
  verb: string;
  primaryLabel: string;
  /** Formatted, signed where it matters. null when the value is not known. */
  primaryValue: string | null;
  primaryTone: ResultTone;
  marketTitle: string;
  pickLabel: string | null;
  rows: ResultCardRow[];
  /** One-line mode disclaimer shown in the modal and on the card. */
  note: string | null;
  /** Real: shown only when a claim is genuinely still required. */
  claimNote: string | null;
  accentHex: string;
  marketPath: string | null;
};

/* -------------------------------------------------------------------------- */
/*  Exact decimal formatting (no binary float, no BigInt literals — ES5)       */
/* -------------------------------------------------------------------------- */

const BIG_ZERO = BigInt(0);
const BIG_TEN = BigInt(10);

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Narrows any input to a valid decimal string, or null when it is not one. */
export function toDecimalString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return DECIMAL_RE.test(s) ? s : null;
}

function pow10(n: number): bigint {
  let out = BigInt(1);
  for (let i = 0; i < n; i++) out = out * BIG_TEN;
  return out;
}

/** Half-up rounding of a decimal string to `dp` places. Exact, BigInt-based. */
function roundDecimal(value: string, dp: number): { neg: boolean; whole: string; frac: string } {
  const neg = value.startsWith("-");
  const body = neg ? value.slice(1) : value;
  const [intPart, fracPart = ""] = body.split(".");

  // Scale to dp+1 digits so the last digit decides the rounding.
  const padded = (fracPart + "0".repeat(dp + 1)).slice(0, dp + 1);
  let scaled = BigInt(intPart || "0") * pow10(dp + 1) + BigInt(padded || "0");

  const lastDigit = scaled % BIG_TEN;
  scaled = scaled / BIG_TEN;
  if (lastDigit >= BigInt(5)) scaled = scaled + BigInt(1);

  const unit = pow10(dp);
  const whole = (scaled / unit).toString();
  const frac = dp > 0 ? (scaled % unit).toString().padStart(dp, "0") : "";

  // -0.00 must render as 0.00, never as "-0.00".
  const isZero = whole === "0" && frac.replace(/0/g, "") === "";
  return { neg: neg && !isZero, whole, frac };
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Trims trailing zeros but never below `min` decimals. */
function trimFrac(frac: string, min: number): string {
  let out = frac;
  while (out.length > min && out.charAt(out.length - 1) === "0") {
    out = out.slice(0, out.length - 1);
  }
  return out;
}

export type FormatMoneyOptions = {
  /** Prefix a "+" on positive values (profit rows). */
  signed?: boolean;
};

/**
 * "$1,250.00" / "+0.42 SOL" / "-$8.50".
 *
 * USD keeps exactly 2 decimals. SOL rounds to 4 and trims to a minimum of 2,
 * so "0.4200" reads as "0.42" while "0.0125" keeps its precision.
 */
export function formatMoney(
  currency: ResultCurrency,
  amount: string | null,
  opts?: FormatMoneyOptions
): string | null {
  const value = toDecimalString(amount);
  if (value === null) return null;

  const dp = currency === "usd" ? 2 : 4;
  const minFrac = currency === "usd" ? 2 : 2;
  const { neg, whole, frac } = roundDecimal(value, dp);

  const shown = trimFrac(frac, minFrac);
  const isZero = whole === "0" && shown.replace(/0/g, "") === "";
  const sign = neg ? "-" : opts?.signed && !isZero ? "+" : "";

  const body = shown ? `${group(whole)}.${shown}` : group(whole);
  return currency === "usd" ? `${sign}$${body}` : `${sign}${body} SOL`;
}

/** Exact lamports -> SOL decimal string. Integer math only. */
export function lamportsToSolString(lamports: number | bigint | null | undefined): string | null {
  if (lamports === null || lamports === undefined) return null;
  let big: bigint;
  if (typeof lamports === "bigint") {
    big = lamports;
  } else {
    if (!Number.isFinite(lamports)) return null;
    big = BigInt(Math.trunc(lamports));
  }
  const neg = big < BIG_ZERO;
  const abs = neg ? -big : big;
  const unit = pow10(9);
  const whole = (abs / unit).toString();
  const frac = (abs % unit).toString().padStart(9, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** Decimal string -> scaled BigInt at `dp` places. */
function toScaled(value: string, dp: number): bigint {
  const neg = value.startsWith("-");
  const body = neg ? value.slice(1) : value;
  const [i, f = ""] = body.split(".");
  const v = BigInt(i || "0") * pow10(dp) + BigInt((f + "0".repeat(dp)).slice(0, dp) || "0");
  return neg ? -v : v;
}

/** Scaled BigInt at `dp` places -> decimal string. */
function fromScaled(scaled: bigint, dp: number): string {
  if (dp === 0) return scaled.toString();
  const neg = scaled < BIG_ZERO;
  const abs = neg ? -scaled : scaled;
  const unit = pow10(dp);
  const whole = (abs / unit).toString();
  const frac = (abs % unit).toString().padStart(dp, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

function decimalPlaces(value: string): number {
  return (value.split(".")[1] || "").length;
}

/** a + b for two decimal strings, exact. Returns null if either is unknown. */
export function addDecimals(a: string | null, b: string | null): string | null {
  const left = toDecimalString(a);
  const right = toDecimalString(b);
  if (left === null || right === null) return null;
  const dp = Math.max(decimalPlaces(left), decimalPlaces(right));
  return fromScaled(toScaled(left, dp) + toScaled(right, dp), dp);
}

/** a - b for two decimal strings, exact. Returns null if either is unknown. */
export function subtractDecimals(a: string | null, b: string | null): string | null {
  const left = toDecimalString(a);
  const right = toDecimalString(b);
  if (left === null || right === null) return null;
  const dp = Math.max(decimalPlaces(left), decimalPlaces(right));
  return fromScaled(toScaled(left, dp) - toScaled(right, dp), dp);
}

/**
 * Sum of decimal strings. Unknown entries are skipped entirely; an all-unknown
 * list returns null so "not known" never collapses into a misleading "0".
 */
export function sumDecimals(values: Array<string | null | undefined>): string | null {
  const valid = values.map(toDecimalString).filter((v): v is string => v !== null);
  if (!valid.length) return null;
  const dp = valid.reduce((max, v) => Math.max(max, decimalPlaces(v)), 0);
  const total = valid.reduce<bigint>((acc, v) => acc + toScaled(v, dp), BIG_ZERO);
  return fromScaled(total, dp);
}

function decimalIsNegative(value: string | null): boolean {
  const v = toDecimalString(value);
  return v !== null && v.startsWith("-") && /[1-9]/.test(v);
}

function decimalIsZero(value: string | null): boolean {
  const v = toDecimalString(value);
  return v !== null && !/[1-9]/.test(v);
}

/* -------------------------------------------------------------------------- */
/*  Copy                                                                       */
/* -------------------------------------------------------------------------- */

export const ACCENT_WIN = "#00ff88";
export const ACCENT_LOSS = "#ff4d6a";
export const ACCENT_REFUND = "#f5c451";

/**
 * Play never claims the money is real or withdrawable. The hedge ("when
 * eligible") is deliberate: modal open time is the wrong place to learn
 * whether a competition is actually running, so the copy stays true either
 * way instead of fetching a leaderboard to find out.
 */
const PLAY_NOTE = "Play balance — not real funds. Your Play result counts toward the active competition when eligible.";

export const MAX_TITLE_CHARS = 120;

export function truncate(text: string, max: number): string {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** The label used for the payout row — never implies money already received. */
export function payoutRowLabel(qualifier: PayoutQualifier | null): string {
  if (qualifier === "claimed") return "Claimed payout";
  if (qualifier === "estimated") return "Estimated payout";
  if (qualifier === "claimable") return "Claimable payout";
  return "Payout";
}

export function buildResultCardView(input: ResultCardInput): ResultCardView {
  const isPlay = input.mode === "play";
  const { state, currency } = input;

  const accentHex =
    state === "win" ? ACCENT_WIN : state === "refund" ? ACCENT_REFUND : ACCENT_LOSS;

  const headline =
    state === "win" ? "YOU WON" : state === "refund" ? "MARKET REFUNDED" : "NOT THIS TIME";
  const verb = state === "win" ? "WON" : state === "refund" ? "REFUNDED" : "LOST";

  const profitLabel = isPlay ? "Play Profit" : "Profit";
  const primaryLabel = state === "refund" ? "Amount returned" : profitLabel;

  const primaryRaw = state === "refund" ? input.payout ?? input.stake : input.profit;
  const primaryValue = formatMoney(currency, primaryRaw, { signed: state !== "refund" });

  const primaryTone: ResultTone =
    state === "refund" || decimalIsZero(primaryRaw)
      ? "neutral"
      : decimalIsNegative(primaryRaw)
      ? "negative"
      : "positive";

  const rows: ResultCardRow[] = [];
  if (input.pickLabel) rows.push({ label: "Pick", value: truncate(input.pickLabel, 48) });

  const stakeText = formatMoney(currency, input.stake);
  if (stakeText) rows.push({ label: "Stake", value: stakeText });

  if (state === "win") {
    const payoutText = formatMoney(currency, input.payout);
    if (payoutText) rows.push({ label: payoutRowLabel(input.payoutQualifier), value: payoutText });
  }

  if (state === "lose" && input.winningOutcomeLabel) {
    rows.push({ label: "Winning outcome", value: truncate(input.winningOutcomeLabel, 48) });
  }

  if (input.marketResultText) {
    rows.push({ label: "Market result", value: truncate(input.marketResultText, 48) });
  }

  // "Claim available" is shown ONLY when a claim is genuinely outstanding —
  // never for an already-claimed position, and never for a mere estimate.
  const claimNote =
    isPlay || state !== "win"
      ? null
      : input.payoutQualifier === "claimed"
      ? // Post-claim the pot no longer holds this payout, so no amount can be
        // stated honestly — say what happened instead of showing a number.
        "Payout already claimed."
      : input.claimAvailable && input.payoutQualifier === "claimable"
      ? "Claim available — claim it from your dashboard to receive it."
      : input.payoutQualifier === "estimated"
      ? "Not claimable yet — this market is still finalizing."
      : null;

  return {
    mode: input.mode,
    state,
    modeLabel: isPlay ? "PLAY RESULT" : "REAL RESULT",
    headline,
    verb,
    primaryLabel,
    primaryValue,
    primaryTone,
    marketTitle: truncate(input.marketTitle || "FunMarket market", MAX_TITLE_CHARS),
    pickLabel: input.pickLabel ? truncate(input.pickLabel, 48) : null,
    rows,
    note: isPlay ? PLAY_NOTE : null,
    claimNote,
    accentHex,
    marketPath: input.marketPath ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Share URL + post text                                                      */
/* -------------------------------------------------------------------------- */

/** The public origin used in shared text. Never a localhost/LAN address. */
export const PUBLIC_ORIGIN = "https://funmarket.app";

const PRIVATE_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.local|192\.168\..*|10\..*)$/i;

export function resolveShareOrigin(): string {
  if (typeof window === "undefined") return PUBLIC_ORIGIN;
  try {
    const url = new URL(window.location.href);
    if (PRIVATE_HOST_RE.test(url.hostname)) return PUBLIC_ORIGIN;
    return url.origin;
  } catch {
    return PUBLIC_ORIGIN;
  }
}

export function resolveShareUrl(marketPath: string | null | undefined): string {
  const origin = resolveShareOrigin();
  const path = String(marketPath || "").trim();
  if (!path) return origin;
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * FunMarket has no configured X handle — the only reference in the codebase
 * is the placeholder https://x.com/TON_COMPTE in SiteFooter. Inventing a
 * mention would tag somebody else's account, so the post says the brand name
 * in plain text instead. Set this to "@handle" once a real one exists.
 */
export const X_HANDLE: string | null = null;

const BRAND_IN_TEXT = X_HANDLE ?? "FunMarket";

/** X counts a URL as 23 characters regardless of its real length. */
const X_URL_WEIGHT = 23;
const X_MAX_WEIGHT = 280;

const SHARE_TITLE_MAX = 90;

export function buildSharePostText(view: ResultCardView, url: string): string {
  const title = truncate(view.marketTitle, SHARE_TITLE_MAX);
  const pick = view.pickLabel ? truncate(view.pickLabel, 40) : null;

  const lines: string[] = [];

  if (view.state === "win") {
    lines.push(`I called it on ${BRAND_IN_TEXT} 🎯`, "", title);
    if (pick) lines.push(`Pick: ${pick}`);
    if (view.primaryValue) lines.push(`${view.primaryLabel}: ${view.primaryValue}`);
    lines.push(
      "",
      view.mode === "play"
        ? "Play for free and climb the leaderboard:"
        : "Trade real markets and climb the Road to $100M:",
      url
    );
  } else if (view.state === "refund") {
    lines.push(`This ${BRAND_IN_TEXT} market was refunded.`, "", title);
    if (view.primaryValue) lines.push(`Amount returned: ${view.primaryValue}`);
    lines.push("", url);
  } else {
    lines.push(`Missed this one on ${BRAND_IN_TEXT}.`, "", title);
    if (pick) lines.push(`Pick: ${pick}`);
    lines.push("", "Next market 👇", url);
  }

  return clampToXLength(lines.join("\n"), url);
}

/**
 * Keeps the post inside X's limit by shortening the market title first —
 * the URL and the numbers are the parts that must survive intact.
 */
function clampToXLength(text: string, url: string): string {
  const weight = (s: string) => s.replace(url, "").length + (s.includes(url) ? X_URL_WEIGHT : 0);
  if (weight(text) <= X_MAX_WEIGHT) return text;

  const lines = text.split("\n");
  // The title is the first non-empty line after the opening sentence.
  const titleIdx = lines.findIndex((l, i) => i > 0 && l.trim().length > 0);
  if (titleIdx < 0) return text;

  let budget = SHARE_TITLE_MAX;
  let out = text;
  while (weight(out) > X_MAX_WEIGHT && budget > 12) {
    budget -= 8;
    const next = lines.slice();
    next[titleIdx] = truncate(lines[titleIdx], budget);
    out = next.join("\n");
  }
  return out;
}

export function buildXIntentUrl(text: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

/** Filename for the "Save result card" fallback. Contains no identifiers. */
export function shareFileName(view: ResultCardView): string {
  return `funmarket-${view.mode}-${view.state}.png`;
}
