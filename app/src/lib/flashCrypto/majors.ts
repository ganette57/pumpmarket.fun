export const FLASH_CRYPTO_SOURCE_TYPES = ["pump_fun", "major"] as const;
export type FlashCryptoSourceType = (typeof FLASH_CRYPTO_SOURCE_TYPES)[number];

export const FLASH_CRYPTO_MAJOR_SYMBOLS = ["BTC", "ETH", "SOL", "BNB"] as const;
export type FlashCryptoMajorSymbol = (typeof FLASH_CRYPTO_MAJOR_SYMBOLS)[number];
export type FlashCryptoMajorPair = `${FlashCryptoMajorSymbol}USDT`;

export type FlashCryptoMajorConfig = {
  symbol: FlashCryptoMajorSymbol;
  pair: FlashCryptoMajorPair;
  name: string;
  imageUri: string;
};

const MAJOR_CONFIG_BY_SYMBOL: Record<FlashCryptoMajorSymbol, FlashCryptoMajorConfig> = {
  BTC: {
    symbol: "BTC",
    pair: "BTCUSDT",
    name: "Bitcoin",
    imageUri: "/crypto-majors/btc.svg",
  },
  ETH: {
    symbol: "ETH",
    pair: "ETHUSDT",
    name: "Ethereum",
    imageUri: "/crypto-majors/eth.svg",
  },
  SOL: {
    symbol: "SOL",
    pair: "SOLUSDT",
    name: "Solana",
    imageUri: "/crypto-majors/sol.svg",
  },
  BNB: {
    symbol: "BNB",
    pair: "BNBUSDT",
    name: "BNB",
    imageUri: "/crypto-majors/bnb.svg",
  },
};

const MAJOR_CONFIG_BY_PAIR: Record<FlashCryptoMajorPair, FlashCryptoMajorConfig> = {
  BTCUSDT: MAJOR_CONFIG_BY_SYMBOL.BTC,
  ETHUSDT: MAJOR_CONFIG_BY_SYMBOL.ETH,
  SOLUSDT: MAJOR_CONFIG_BY_SYMBOL.SOL,
  BNBUSDT: MAJOR_CONFIG_BY_SYMBOL.BNB,
};

function normalizeUpper(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

export function getFlashCryptoMajorConfigBySymbol(symbol: unknown): FlashCryptoMajorConfig | null {
  const normalized = normalizeUpper(symbol);
  if (!normalized) return null;
  if (!Object.prototype.hasOwnProperty.call(MAJOR_CONFIG_BY_SYMBOL, normalized)) return null;
  return MAJOR_CONFIG_BY_SYMBOL[normalized as FlashCryptoMajorSymbol];
}

export function getFlashCryptoMajorConfigByPair(pair: unknown): FlashCryptoMajorConfig | null {
  const normalized = normalizeUpper(pair);
  if (!normalized) return null;
  if (!Object.prototype.hasOwnProperty.call(MAJOR_CONFIG_BY_PAIR, normalized)) return null;
  return MAJOR_CONFIG_BY_PAIR[normalized as FlashCryptoMajorPair];
}

export function resolveFlashCryptoMajorSelection(input: {
  symbol?: unknown;
  pair?: unknown;
  raw?: unknown;
}): FlashCryptoMajorConfig | null {
  const bySymbol = getFlashCryptoMajorConfigBySymbol(input.symbol);
  if (bySymbol) return bySymbol;

  const byPair = getFlashCryptoMajorConfigByPair(input.pair);
  if (byPair) return byPair;

  const raw = normalizeUpper(input.raw);
  if (!raw) return null;

  if (raw.startsWith("MAJOR:")) {
    const fromPrefixed = getFlashCryptoMajorConfigBySymbol(raw.slice("MAJOR:".length));
    if (fromPrefixed) return fromPrefixed;
  }

  return getFlashCryptoMajorConfigBySymbol(raw) || getFlashCryptoMajorConfigByPair(raw);
}

