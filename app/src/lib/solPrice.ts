// src/lib/solPrice.ts
//
// A server-side SOL/USD price, for DISPLAY ONLY.
//
// WHAT IT IS NOT FOR
// ------------------
// Nothing is ranked, stored or settled in USD. Real accounting is in SOL
// and stays in SOL: the leaderboard sorts on lamports, and no historical
// trade economics are ever rewritten at today's rate. This price exists so
// a SOL figure can carry an approximate dollar equivalent next to it, and
// so the Road-to-$1M progress bar has a denominator.
//
// WHY SERVER-SIDE
// ---------------
// The browser never fetches it: one process-wide cache serves every
// visitor, so a busy page makes one upstream request per TTL rather than
// one per viewer, and no third-party price host ever sees a user's IP.
//
// STALENESS IS A FIRST-CLASS OUTCOME
// ----------------------------------
// A wrong dollar figure is worse than no dollar figure. When the upstream
// is unreachable the last good price is served only while it is still
// defensible; past MAX_AGE_MS this returns null, and every caller is
// required to hide the USD equivalent and the progress percentage rather
// than show a stale or invented number. It never throws.

import "server-only";

export type SolPrice = {
  /** USD per SOL. */
  usd: number;
  /** When the upstream reported it. */
  as_of: string;
};

/** Serve the cached price without re-fetching for this long. */
const TTL_MS = 60_000;

/**
 * Hard ceiling on how old a price may be and still be shown. Past this the
 * module reports null and the UI drops every dollar figure.
 */
const MAX_AGE_MS = 15 * 60_000;

/** Upstream must answer quickly; a slow price is a hidden price. */
const FETCH_TIMEOUT_MS = 4_000;

const PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

type CacheEntry = { usd: number; fetchedAt: number };

// Module scope: one cache per server process, shared by every request.
let cache: CacheEntry | null = null;
let inflight: Promise<void> | null = null;

function sane(usd: unknown): number | null {
  const n = Number(usd);
  // A price outside this band is a broken upstream, not a market move.
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) return null;
  return n;
}

async function refresh(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(PRICE_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return;
    const json: any = await res.json();
    const usd = sane(json?.solana?.usd);
    if (usd === null) return;
    cache = { usd, fetchedAt: Date.now() };
  } catch {
    // Unreachable, timed out, or malformed. Keep whatever we had; the
    // MAX_AGE_MS check below decides whether it is still usable.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The current SOL/USD price, or null when there is no defensible one.
 *
 * Null is a normal outcome, not an error: callers hide USD figures rather
 * than substituting a guess. Never throws.
 */
export async function getSolUsdPrice(): Promise<SolPrice | null> {
  const now = Date.now();
  const fresh = cache && now - cache.fetchedAt < TTL_MS;

  if (!fresh) {
    // Collapse concurrent misses onto one upstream request.
    if (!inflight) {
      inflight = refresh().finally(() => {
        inflight = null;
      });
    }
    await inflight;
  }

  if (!cache) return null;
  if (Date.now() - cache.fetchedAt > MAX_AGE_MS) return null;

  return { usd: cache.usd, as_of: new Date(cache.fetchedAt).toISOString() };
}
