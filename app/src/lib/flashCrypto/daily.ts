/**
 * Crypto Daily (24H) — shared, isomorphic helpers.
 *
 * The backend keeps its existing "flash-crypto" names/routes; only the
 * duration model and the user-facing copy change: a Flash Crypto PRICE market
 * is now a 24-hour "UP or DOWN" market with an immutable price to beat.
 *
 * No "server-only" here on purpose: the feed cards and the admin panel need
 * the same labels/format helpers as the engine.
 */

/** The only duration a new Flash Crypto price market can be created with. */
export const FLASH_CRYPTO_DAILY_DURATION_MINUTES = 1440;

/** Product focus for Crypto Daily. Other majors stay supported internally. */
export const FLASH_CRYPTO_DAILY_SYMBOLS = ["BTC", "SOL"] as const;
export type FlashCryptoDailySymbol = (typeof FLASH_CRYPTO_DAILY_SYMBOLS)[number];

export function isFlashCryptoDailyDuration(minutes: unknown): boolean {
  const n = Math.floor(Number(minutes));
  return Number.isFinite(n) && n === FLASH_CRYPTO_DAILY_DURATION_MINUTES;
}

/** "24 hours" / "1 hour" / "10 minutes" — used in questions and chips. */
export function formatFlashCryptoDurationLabel(minutes: unknown): string {
  const n = Math.floor(Number(minutes));
  if (!Number.isFinite(n) || n <= 0) return "24 hours";
  if (n >= 1440) {
    const days = Math.round(n / 1440);
    return days === 1 ? "24 hours" : `${days} days`;
  }
  if (n === 60) return "1 hour";
  if (n === 1) return "1 minute";
  return `${n} minutes`;
}

/** Short chip label: "24H" / "1H" / "5M". */
export function formatFlashCryptoDurationChip(minutes: unknown): string {
  const n = Math.floor(Number(minutes));
  if (!Number.isFinite(n) || n <= 0) return "24H";
  if (n >= 1440) return `${Math.round(n / 60)}H`;
  if (n >= 60 && n % 60 === 0) return `${n / 60}H`;
  return `${n}M`;
}

/**
 * The market question. Daily markets use the product copy
 * ("BTC UP OR DOWN IN 24H?"); shorter legacy windows keep the old phrasing so
 * historical markets still read the way they were created.
 */
export function buildFlashCryptoPriceQuestion(params: {
  tokenSymbol: string;
  sourceType?: string | null;
  durationMinutes: number;
}): string {
  const symbol = String(params.tokenSymbol || "").trim().toUpperCase() || "TOKEN";
  const isMajor = String(params.sourceType || "").trim().toLowerCase() === "major";
  const ticker = isMajor ? symbol : `$${symbol}`;

  if (isFlashCryptoDailyDuration(params.durationMinutes)) {
    return `${ticker} UP OR DOWN IN 24H?`;
  }

  return `Will ${ticker} go UP in ${formatFlashCryptoDurationLabel(params.durationMinutes)}?`;
}

/** "18:42:10" past an hour, "04:21" below it. */
export function formatFlashCryptoCountdown(totalSec: number | null | undefined): string {
  const raw = Number(totalSec);
  const safe = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/** USD display for a reference/current price. Majors get thousands grouping. */
export function formatFlashCryptoUsdPrice(price: number | null | undefined): string {
  const n = Number(price);
  if (!Number.isFinite(n) || n === 0) return "—";
  if (n < 0.000001) return `$${n.toExponential(3)}`;
  if (n < 0.01) return `$${n.toFixed(8)}`;
  if (n < 1) return `$${n.toFixed(6)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Signed percent between the immutable price to beat and the live price. */
export function formatFlashCryptoChangeVsTarget(
  priceToBeat: number | null | undefined,
  currentPrice: number | null | undefined,
): string | null {
  const start = Number(priceToBeat);
  const now = Number(currentPrice);
  if (!Number.isFinite(start) || start <= 0) return null;
  if (!Number.isFinite(now) || now <= 0) return null;
  const pct = ((now - start) / start) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}
