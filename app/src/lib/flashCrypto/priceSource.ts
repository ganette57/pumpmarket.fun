import "server-only";

import { fetchPumpToken, parsePumpTokenInput } from "./pumpToken";
import {
  resolveFlashCryptoMajorSelection,
  type FlashCryptoSourceType,
} from "./majors";

type FlashCryptoSourceProvider = "helius" | "pump_fun" | "binance";

export type FlashCryptoSnapshotOptions = {
  sourceType?: FlashCryptoSourceType;
  majorSymbol?: string | null;
  majorPair?: string | null;
  preferRealtimePump?: boolean;
};

export type FlashCryptoPriceSnapshot = {
  mint: string;
  symbol: string;
  name: string;
  imageUri: string | null;
  price: number;
  provider: FlashCryptoSourceProvider;
  source: string;
  fetchedAt: string;
  sourceType?: FlashCryptoSourceType;
  majorSymbol?: string | null;
  majorPair?: string | null;
};

type BinanceStreamTick = {
  price: number;
  source: string;
  fetchedAt: number;
};

type BinanceStreamState = {
  ws: any | null;
  connecting: boolean;
  lastConnectAt: number;
  lastError: string | null;
};

const BINANCE_TICK_MAP_KEY = Symbol.for("FUNMARKET_FLASH_CRYPTO_BINANCE_TICKS");
const BINANCE_STREAM_MAP_KEY = Symbol.for("FUNMARKET_FLASH_CRYPTO_BINANCE_STREAMS");

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

function getBinanceTickMap(): Map<string, BinanceStreamTick> {
  const host = (typeof process !== "undefined" ? process : globalThis) as any;
  if (!host[BINANCE_TICK_MAP_KEY]) {
    host[BINANCE_TICK_MAP_KEY] = new Map<string, BinanceStreamTick>();
  }
  return host[BINANCE_TICK_MAP_KEY] as Map<string, BinanceStreamTick>;
}

function getBinanceStreamMap(): Map<string, BinanceStreamState> {
  const host = (typeof process !== "undefined" ? process : globalThis) as any;
  if (!host[BINANCE_STREAM_MAP_KEY]) {
    host[BINANCE_STREAM_MAP_KEY] = new Map<string, BinanceStreamState>();
  }
  return host[BINANCE_STREAM_MAP_KEY] as Map<string, BinanceStreamState>;
}

function tryLoadWsClass(): any | null {
  try {
    // Keep dynamic require to avoid adding build-time dependency constraints.
    return require("ws");
  } catch {
    return null;
  }
}

function parseBinanceStreamPrice(rawPayload: unknown): number | null {
  let rawText = "";
  if (typeof rawPayload === "string") {
    rawText = rawPayload;
  } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(rawPayload)) {
    rawText = rawPayload.toString("utf8");
  } else {
    rawText = String(rawPayload ?? "");
  }

  if (!rawText) return null;

  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const asTrade = toFiniteNumber(parsed.p);
    if (asTrade != null && asTrade > 0) return asTrade;

    const asTicker = toFiniteNumber(parsed.c);
    if (asTicker != null && asTicker > 0) return asTicker;

    return null;
  } catch {
    return null;
  }
}

function normalizePairForStream(rawPair: string): string | null {
  const major = resolveFlashCryptoMajorSelection({ pair: rawPair, raw: rawPair });
  return major ? major.pair : null;
}

function ensureBinanceStream(pairRaw: string): void {
  const pair = normalizePairForStream(pairRaw);
  if (!pair) return;

  const streamMap = getBinanceStreamMap();
  const existing = streamMap.get(pair);
  if (existing?.ws && existing.connecting) return;

  const now = Date.now();
  if (existing?.connecting && now - existing.lastConnectAt < 1500) return;

  const WsClass = tryLoadWsClass();
  if (!WsClass) return;

  const wsUrl = `wss://stream.binance.com:9443/ws/${pair.toLowerCase()}@trade`;

  const state: BinanceStreamState = {
    ws: null,
    connecting: true,
    lastConnectAt: now,
    lastError: null,
  };
  streamMap.set(pair, state);

  try {
    const ws = new WsClass(wsUrl);
    state.ws = ws;

    ws.on("open", () => {
      const current = streamMap.get(pair);
      if (!current) return;
      current.connecting = true;
      current.lastError = null;
    });

    ws.on("message", (payload: unknown) => {
      const price = parseBinanceStreamPrice(payload);
      if (price == null || price <= 0) return;
      const ticks = getBinanceTickMap();
      ticks.set(pair, {
        price,
        source: `binance:stream:${pair.toLowerCase()}@trade`,
        fetchedAt: Date.now(),
      });
    });

    const markDisconnected = (error?: unknown) => {
      const current = streamMap.get(pair);
      if (!current) return;
      current.connecting = false;
      current.ws = null;
      current.lastError = error ? String((error as any)?.message || error) : null;

      const retry = setTimeout(() => ensureBinanceStream(pair), 2000);
      const retryAny = retry as any;
      if (typeof retryAny?.unref === "function") retryAny.unref();
    };

    ws.on("close", () => markDisconnected());
    ws.on("error", (error: unknown) => markDisconnected(error));
  } catch (error) {
    state.connecting = false;
    state.ws = null;
    state.lastError = String((error as any)?.message || error);
  }
}

function getFreshBinanceTick(pairRaw: string, freshnessMs = 8_000): BinanceStreamTick | null {
  const pair = normalizePairForStream(pairRaw);
  if (!pair) return null;
  const tick = getBinanceTickMap().get(pair);
  if (!tick) return null;
  if (Date.now() - tick.fetchedAt > freshnessMs) return null;
  return tick;
}

async function waitForBinanceStreamTick(pairRaw: string, timeoutMs = 1200): Promise<BinanceStreamTick | null> {
  const pair = normalizePairForStream(pairRaw);
  if (!pair) return null;

  ensureBinanceStream(pair);

  const existing = getFreshBinanceTick(pair);
  if (existing) return existing;

  const until = Date.now() + Math.max(150, timeoutMs);
  while (Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const tick = getFreshBinanceTick(pair);
    if (tick) return tick;
  }

  return null;
}

async function fetchBinanceRestTicker(pairRaw: string): Promise<{ price: number; source: string }> {
  const pair = normalizePairForStream(pairRaw);
  if (!pair) {
    throw new Error(`unsupported major pair: ${pairRaw}`);
  }

  const endpoints = [
    "https://api.binance.com/api/v3/ticker/price",
    "https://api1.binance.com/api/v3/ticker/price",
    "https://data-api.binance.vision/api/v3/ticker/price",
  ];

  let lastError: string | null = null;

  for (const endpoint of endpoints) {
    try {
      const url = `${endpoint}?symbol=${encodeURIComponent(pair)}`;
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = (await response.json()) as Record<string, unknown>;
      const price = toFiniteNumber(json.price);
      if (price == null || price <= 0) {
        throw new Error("invalid price payload");
      }

      return {
        price,
        source: `binance:rest:${new URL(endpoint).host}/api/v3/ticker/price?symbol=${pair}`,
      };
    } catch (error: any) {
      lastError = String(error?.message || error || "unknown binance rest error");
    }
  }

  throw new Error(lastError || `binance rest ticker failed for ${pair}`);
}

async function getFlashCryptoMajorPriceSnapshot(
  rawIdentifier: string,
  options?: FlashCryptoSnapshotOptions,
): Promise<FlashCryptoPriceSnapshot> {
  const major = resolveFlashCryptoMajorSelection({
    symbol: options?.majorSymbol,
    pair: options?.majorPair,
    raw: rawIdentifier,
  });

  if (!major) {
    throw new Error("Unsupported major symbol. Use BTC, ETH, SOL, or BNB.");
  }

  const fromStream = await waitForBinanceStreamTick(major.pair, 1200).catch(() => null);
  if (fromStream) {
    return {
      mint: major.pair,
      symbol: major.symbol,
      name: major.name,
      imageUri: major.imageUri,
      price: fromStream.price,
      provider: "binance",
      source: fromStream.source,
      fetchedAt: new Date(fromStream.fetchedAt).toISOString(),
      sourceType: "major",
      majorSymbol: major.symbol,
      majorPair: major.pair,
    };
  }

  const rest = await fetchBinanceRestTicker(major.pair);
  return {
    mint: major.pair,
    symbol: major.symbol,
    name: major.name,
    imageUri: major.imageUri,
    price: rest.price,
    provider: "binance",
    source: rest.source,
    fetchedAt: new Date().toISOString(),
    sourceType: "major",
    majorSymbol: major.symbol,
    majorPair: major.pair,
  };
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
        sourceType: "pump_fun",
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
    sourceType: "pump_fun",
  };
}

function logHeliusFallback(mint: string, reason: string) {
  console.warn("[flash-crypto] helius price unavailable, fallback to DexScreener", {
    mint,
    reason,
    fallback: "dexscreener.highest_liquidity_pair",
  });
}

function toPumpSnapshotFromDex(
  snap: Awaited<ReturnType<typeof fetchPumpToken>>,
  source: string,
): FlashCryptoPriceSnapshot {
  return {
    mint: snap.mint,
    symbol: snap.symbol,
    name: snap.name,
    imageUri: snap.imageUri,
    price: snap.price,
    provider: "pump_fun",
    source,
    fetchedAt: new Date().toISOString(),
    sourceType: "pump_fun",
  };
}

export async function getFlashCryptoLivePrice(
  rawMint: string,
  options?: FlashCryptoSnapshotOptions,
): Promise<FlashCryptoPriceSnapshot> {
  const requestedSourceType: FlashCryptoSourceType =
    String(options?.sourceType || "").trim().toLowerCase() === "major" ? "major" : "pump_fun";

  const majorSelection = resolveFlashCryptoMajorSelection({
    symbol: options?.majorSymbol,
    pair: options?.majorPair,
    raw: rawMint,
  });

  if (requestedSourceType === "major" || majorSelection) {
    return getFlashCryptoMajorPriceSnapshot(rawMint, {
      sourceType: "major",
      majorSymbol: majorSelection?.symbol || options?.majorSymbol,
      majorPair: majorSelection?.pair || options?.majorPair,
    });
  }

  const mint = parsePumpTokenInput(rawMint);
  const preferRealtimePump = options?.preferRealtimePump === true;

  console.log("[flash-meme] live price request ...", {
    mint,
    sourceType: requestedSourceType,
    preferRealtimePump,
  });

  if (preferRealtimePump) {
    try {
      const fromDex = await fetchPumpToken(mint);
      const snap = toPumpSnapshotFromDex(fromDex, "dexscreener:tokens.v1.highest_liquidity_pair");
      console.log("[flash-meme] provider selected = pump_fun");
      console.log("[flash-meme] live price returned = ...", {
        mint: snap.mint,
        price: snap.price,
        provider: snap.provider,
        source: snap.source,
      });
      return snap;
    } catch (dexError: any) {
      console.warn("[flash-meme] dex live fetch failed, fallback to helius", {
        mint,
        error: String(dexError?.message || dexError || "unknown dex error"),
      });
    }
  }

  try {
    const snap = await fetchHeliusAssetSnapshot(mint);
    console.log(`[flash-meme] provider selected = ${snap.provider}`);
    console.log("[flash-meme] live price returned = ...", {
      mint: snap.mint,
      price: snap.price,
      provider: snap.provider,
      source: snap.source,
    });
    return snap;
  } catch (error: any) {
    logHeliusFallback(mint, String(error?.message || error || "unknown helius error"));
  }

  const fallback = await fetchPumpToken(mint);
  const fallbackSnap = toPumpSnapshotFromDex(fallback, "fallback:dexscreener.highest_liquidity_pair");
  console.log("[flash-meme] provider selected = pump_fun");
  console.log("[flash-meme] live price returned = ...", {
    mint: fallbackSnap.mint,
    price: fallbackSnap.price,
    provider: fallbackSnap.provider,
    source: fallbackSnap.source,
  });
  return fallbackSnap;
}

export async function getFlashCryptoStartSnapshot(
  rawMint: string,
  options?: FlashCryptoSnapshotOptions,
): Promise<FlashCryptoPriceSnapshot> {
  return getFlashCryptoLivePrice(rawMint, options);
}

export async function getFlashCryptoEndSnapshot(
  rawMint: string,
  options?: FlashCryptoSnapshotOptions,
): Promise<FlashCryptoPriceSnapshot> {
  return getFlashCryptoLivePrice(rawMint, options);
}
