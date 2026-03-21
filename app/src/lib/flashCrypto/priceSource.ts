import "server-only";

import { fetchPumpToken, parsePumpTokenInput } from "./pumpToken";

type FlashCryptoSourceProvider = "helius" | "pump_fun";

export type FlashCryptoPriceSnapshot = {
  mint: string;
  symbol: string;
  name: string;
  imageUri: string | null;
  price: number;
  provider: FlashCryptoSourceProvider;
  source: string;
  fetchedAt: string;
};

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

function readPath(obj: unknown, path: Array<string | number>): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(cur) || key < 0 || key >= cur.length) return undefined;
      cur = cur[key];
      continue;
    }
    if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstText(values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && text !== "null" && text !== "undefined") return text;
  }
  return null;
}

function preferredRpcCandidates(): string[] {
  const candidates = [
    env("LIVE_MICRO_RPC_URL"),
    env("SOLANA_RPC"),
    env("NEXT_PUBLIC_RPC_MAINNET"),
    env("NEXT_PUBLIC_SOLANA_RPC_URL"),
    env("NEXT_PUBLIC_RPC_DEVNET"),
    env("NEXT_PUBLIC_SOLANA_RPC"),
  ].filter(Boolean);
  if (!candidates.length) return [];

  const helius = candidates.filter((url) => /helius/i.test(url));
  if (helius.length) return [...helius, ...candidates.filter((url) => !/helius/i.test(url))];
  return candidates;
}

function rpcLooksHelius(url: string): boolean {
  return /helius/i.test(String(url || ""));
}

function parseHeliusApiKeyFromRpc(rpcUrl: string): string | null {
  try {
    const parsed = new URL(rpcUrl);
    const fromQuery = parsed.searchParams.get("api-key") || parsed.searchParams.get("api_key");
    if (fromQuery) return fromQuery;
  } catch {
    // ignore parse failures
  }
  const fromEnv = env("HELIUS_API_KEY");
  return fromEnv || null;
}

function imageFromHeliusAsset(asset: Record<string, unknown>): string | null {
  const direct = firstText([
    readPath(asset, ["content", "links", "image"]),
    readPath(asset, ["content", "metadata", "image"]),
    readPath(asset, ["content", "json_uri"]),
    readPath(asset, ["metadata", "image"]),
    readPath(asset, ["image"]),
  ]);
  if (direct) return direct;

  const fileUri = firstText([
    readPath(asset, ["content", "files", 0, "uri"]),
    readPath(asset, ["content", "files", 0, "cdn_uri"]),
  ]);
  return fileUri || null;
}

async function fetchHeliusAssetSnapshot(mint: string): Promise<FlashCryptoPriceSnapshot> {
  const rpcCandidates = preferredRpcCandidates();
  if (!rpcCandidates.length) {
    throw new Error("no Solana RPC configured");
  }

  let lastError: string | null = null;

  for (const rpcUrl of rpcCandidates) {
    try {
      const body = {
        jsonrpc: "2.0",
        id: "flash-crypto-helius-getAsset",
        method: "getAsset",
        params: {
          id: mint,
          displayOptions: { showFungible: true },
        },
      };
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`RPC ${response.status}`);
      }

      const json = (await response.json()) as Record<string, unknown>;
      const rpcError = readPath(json, ["error"]);
      if (rpcError) {
        throw new Error(`RPC error: ${JSON.stringify(rpcError)}`);
      }

      const asset = readPath(json, ["result"]);
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
        throw new Error("missing result asset");
      }
      const assetObj = asset as Record<string, unknown>;

      const price = toFiniteNumber(
        firstText([
          readPath(assetObj, ["token_info", "price_info", "price_per_token"]),
          readPath(assetObj, ["token_info", "price_info", "price_per_token_usd"]),
          readPath(assetObj, ["token_info", "price_info", "price"]),
          readPath(assetObj, ["token_info", "price_info", "usd_price"]),
          readPath(assetObj, ["token_info", "priceInfo", "pricePerToken"]),
          readPath(assetObj, ["token_info", "priceInfo", "price"]),
          readPath(assetObj, ["price_info", "price_per_token"]),
          readPath(assetObj, ["price", "usd"]),
        ]),
      );
      if (price == null || price <= 0) {
        throw new Error("asset price unavailable");
      }

      const symbol =
        firstText([
          readPath(assetObj, ["token_info", "symbol"]),
          readPath(assetObj, ["content", "metadata", "symbol"]),
          readPath(assetObj, ["symbol"]),
        ]) || mint.slice(0, 6);
      const name =
        firstText([
          readPath(assetObj, ["content", "metadata", "name"]),
          readPath(assetObj, ["token_info", "name"]),
          readPath(assetObj, ["name"]),
        ]) || symbol;
      const imageUri = imageFromHeliusAsset(assetObj);

      return {
        mint,
        symbol,
        name,
        imageUri,
        price,
        provider: "helius",
        source: rpcLooksHelius(rpcUrl)
          ? "helius:getAsset.token_info.price_info"
          : "rpc:getAsset.token_info.price_info",
        fetchedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      lastError = String(error?.message || error || "unknown helius asset error");
    }
  }

  const firstRpc = rpcCandidates[0];
  const key = parseHeliusApiKeyFromRpc(firstRpc);
  if (!key) {
    throw new Error(lastError || "helius asset lookup failed");
  }

  const metaResponse = await fetch(`https://api.helius.xyz/v0/token-metadata?api-key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mintAccounts: [mint] }),
    cache: "no-store",
  });
  if (!metaResponse.ok) {
    throw new Error(lastError || `helius token-metadata failed (${metaResponse.status})`);
  }
  const metadataJson = (await metaResponse.json()) as unknown;
  const first = Array.isArray(metadataJson) ? metadataJson[0] : null;
  if (!first || typeof first !== "object") {
    throw new Error(lastError || "helius metadata unavailable");
  }
  const firstObj = first as Record<string, unknown>;

  const fallbackPrice = toFiniteNumber(
    firstText([
      readPath(firstObj, ["tokenInfo", "priceInfo", "pricePerToken"]),
      readPath(firstObj, ["token_info", "price_info", "price_per_token"]),
      readPath(firstObj, ["price_info", "price_per_token"]),
    ]),
  );
  if (fallbackPrice == null || fallbackPrice <= 0) {
    throw new Error(lastError || "helius metadata has no price");
  }

  const symbol =
    firstText([
      readPath(firstObj, ["onChainMetadata", "metadata", "data", "symbol"]),
      readPath(firstObj, ["tokenInfo", "symbol"]),
      readPath(firstObj, ["token_info", "symbol"]),
    ]) || mint.slice(0, 6);
  const name =
    firstText([
      readPath(firstObj, ["onChainMetadata", "metadata", "data", "name"]),
      readPath(firstObj, ["tokenInfo", "name"]),
      readPath(firstObj, ["token_info", "name"]),
    ]) || symbol;
  const imageUri =
    firstText([
      readPath(firstObj, ["offChainMetadata", "metadata", "image"]),
      readPath(firstObj, ["onChainMetadata", "metadata", "data", "uri"]),
    ]) || null;

  return {
    mint,
    symbol,
    name,
    imageUri,
    price: fallbackPrice,
    provider: "helius",
    source: "helius:token-metadata.price_info",
    fetchedAt: new Date().toISOString(),
  };
}

function logHeliusFallback(mint: string, reason: string) {
  console.warn("[flash-crypto] helius price unavailable, fallback to DexScreener", {
    mint,
    reason,
    fallback: "dexscreener.highest_liquidity_pair",
  });
}

export async function getFlashCryptoLivePrice(rawMint: string): Promise<FlashCryptoPriceSnapshot> {
  const mint = parsePumpTokenInput(rawMint);

  try {
    return await fetchHeliusAssetSnapshot(mint);
  } catch (error: any) {
    logHeliusFallback(mint, String(error?.message || error || "unknown helius error"));
  }

  const fallback = await fetchPumpToken(mint);
  return {
    mint: fallback.mint,
    symbol: fallback.symbol,
    name: fallback.name,
    imageUri: fallback.imageUri,
    price: fallback.price,
    provider: "pump_fun",
    source: "fallback:dexscreener.highest_liquidity_pair",
    fetchedAt: new Date().toISOString(),
  };
}

export async function getFlashCryptoStartSnapshot(rawMint: string): Promise<FlashCryptoPriceSnapshot> {
  return getFlashCryptoLivePrice(rawMint);
}

export async function getFlashCryptoEndSnapshot(rawMint: string): Promise<FlashCryptoPriceSnapshot> {
  return getFlashCryptoLivePrice(rawMint);
}
