import "server-only";

export type PumpTokenSnapshot = {
  mint: string;
  symbol: string;
  name: string;
  price: number;
  imageUri: string | null;
};

/**
 * Accept a raw mint address OR a pump.fun URL like
 * https://pump.fun/coin/<mint> — extract and return the clean mint.
 */
export function parsePumpTokenInput(input: string): string {
  const trimmed = String(input || "").trim();
  if (!trimmed) throw new Error("Token mint or URL is required");

  // Match pump.fun URL patterns:  pump.fun/coin/<mint>  or  pump.fun/<mint>
  const urlMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?pump\.fun\/(?:coin\/)?([A-Za-z0-9]{32,50})/,
  );
  if (urlMatch) return urlMatch[1];

  // If it looks like a Solana base58 address (32-50 chars, alphanumeric), use as-is
  if (/^[A-Za-z0-9]{32,50}$/.test(trimmed)) return trimmed;

  throw new Error(
    "Invalid token input. Provide a Solana mint address or a pump.fun URL.",
  );
}

/**
 * Fetch token data from DexScreener (robust, no Cloudflare issues).
 * Falls back gracefully when metadata is partial.
 */
export async function fetchPumpToken(mint: string): Promise<PumpTokenSnapshot> {
  const cleanMint = parsePumpTokenInput(mint);

  // ── DexScreener tokens endpoint ──
  const dsUrl = `https://api.dexscreener.com/tokens/v1/solana/${encodeURIComponent(cleanMint)}`;
  const res = await fetch(dsUrl, {
    headers: { Accept: "application/json" },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(
      `Token lookup failed (DexScreener ${res.status}). Check that the mint address is valid.`,
    );
  }

  const data = (await res.json()) as unknown;
  const pairs = Array.isArray(data) ? data : [];

  if (pairs.length === 0) {
    throw new Error(
      `Token not found on DexScreener for mint=${cleanMint}. It may not be listed yet.`,
    );
  }

  // Pick the pair with highest liquidity
  const best = pairs.reduce((a: any, b: any) =>
    (Number(b.liquidity?.usd) || 0) > (Number(a.liquidity?.usd) || 0) ? b : a,
  );

  const baseToken = best.baseToken || {};
  const priceUsd = Number(best.priceUsd || 0);
  const symbol = String(baseToken.symbol || "").trim();
  const name = String(baseToken.name || "").trim();
  const imageUri = String(best.info?.imageUrl || "").trim() || null;

  if (priceUsd <= 0) {
    throw new Error(
      `No valid price found for mint=${cleanMint}. The token may have no active trading pairs.`,
    );
  }

  return {
    mint: cleanMint,
    symbol: symbol || cleanMint.slice(0, 6),
    name: name || symbol || "Unknown Token",
    price: priceUsd,
    imageUri,
  };
}

/**
 * Lightweight price-only fetch for client polling (used by /api/flash-crypto/price).
 */
export async function fetchPumpTokenPrice(mint: string): Promise<{
  mint: string;
  price: number;
  symbol: string;
  name: string;
}> {
  const snap = await fetchPumpToken(mint);
  return { mint: snap.mint, price: snap.price, symbol: snap.symbol, name: snap.name };
}
