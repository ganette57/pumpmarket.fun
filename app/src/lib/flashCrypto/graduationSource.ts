import "server-only";

import { fetchPumpToken, parsePumpTokenInput } from "./pumpToken";

export type FlashCryptoGraduationProvider = "pump_fun";

export type FlashCryptoGraduationSnapshot = {
  mint: string;
  symbol: string;
  name: string;
  imageUri: string | null;
  progressPct: number;
  didGraduate: boolean;
  remainingToGraduate: number | null;
  provider: FlashCryptoGraduationProvider;
  source: string;
  fetchedAt: string;
};

export type FlashCryptoGraduationCandidate = FlashCryptoGraduationSnapshot & {
  lastTradeAt: string | null;
  volumeUsd: number | null;
  activityCount: number | null;
  momentum: number | null;
  raw: Record<string, unknown>;
  progressField?: string | null;
  didGraduateField?: string | null;
  remainingField?: string | null;
  progressFallback?: string | null;
  remainingFallback?: string | null;
};

const PUMP_FRONTEND_APIS = [
  "https://frontend-api.pump.fun",
  "https://frontend-api-v3.pump.fun",
] as const;
const PUMP_ADVANCED_API = "https://advanced-api-v2.pump.fun";
const PUMP_DEFAULT_INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000;
const PUMP_INITIAL_REAL_TOKEN_RESERVES_RATIO = 0.7931;

function logGraduation(message: string, payload?: Record<string, unknown>) {
  if (payload) {
    console.log(`[flash-crypto graduation] ${message}`, payload);
    return;
  }
  console.log(`[flash-crypto graduation] ${message}`);
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

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function firstText(values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && text !== "null" && text !== "undefined") return text;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(values: unknown[]): number | null {
  for (const value of values) {
    const n = toNumber(value);
    if (n != null) return n;
  }
  return null;
}

function firstBoolean(values: unknown[]): boolean | null {
  for (const value of values) {
    const parsed = parseBooleanish(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseBooleanish(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (["true", "1", "yes", "y", "graduated", "complete", "completed"].includes(text)) return true;
  if (["false", "0", "no", "n", "active", "live", "open"].includes(text)) return false;
  return null;
}

type ParsedDidGraduate = {
  didGraduate: boolean;
  field: string | null;
};

function parseDidGraduate(raw: Record<string, unknown>): ParsedDidGraduate {
  const fields: Array<[string, unknown]> = [
    ["did_graduate", raw.did_graduate],
    ["didGraduate", raw.didGraduate],
    ["graduated", raw.graduated],
    ["is_graduated", raw.is_graduated],
    ["isGraduated", raw.isGraduated],
    ["complete", raw.complete],
    ["completed", raw.completed],
    ["bonding_curve_complete", raw.bonding_curve_complete],
    ["bondingCurveComplete", raw.bondingCurveComplete],
    ["bonding_curve.complete", readPath(raw, ["bonding_curve", "complete"])],
    ["status", firstText([raw.status, raw.coin_status, raw.market_status])],
  ];
  for (const [field, value] of fields) {
    const parsed = parseBooleanish(value);
    if (parsed != null) {
      return { didGraduate: parsed, field };
    }
  }

  const graduationDate = firstText([
    raw.graduation_date,
    raw.graduationDate,
    raw.graduated_at,
    raw.graduatedAt,
  ]);
  if (graduationDate) {
    const parsed = new Date(graduationDate);
    if (Number.isFinite(parsed.getTime())) {
      return { didGraduate: true, field: "graduationDate" };
    }
  }

  const poolAddress = firstText([raw.pool_address, raw.poolAddress]);
  if (poolAddress) {
    return { didGraduate: true, field: "pool_address" };
  }

  return { didGraduate: false, field: null };
}

type ParsedProgress = {
  progressPct: number | null;
  field: string | null;
  fallback: string | null;
};

function normalizeProgressPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return clampPct(value * 100);
  return clampPct(value);
}

function parseProgressPct(raw: Record<string, unknown>, didGraduate: boolean): ParsedProgress {
  if (didGraduate) {
    return {
      progressPct: 100,
      field: "did_graduate_forced_100",
      fallback: "graduated",
    };
  }

  const progressFields: Array<[string, unknown]> = [
    ["bonding_curve_progress", raw.bonding_curve_progress],
    ["bondingCurveProgress", raw.bondingCurveProgress],
    ["bonding_curve_percent", raw.bonding_curve_percent],
    ["bondingCurvePercent", raw.bondingCurvePercent],
    ["progress_percent", raw.progress_percent],
    ["progressPercent", raw.progressPercent],
    ["progress_pct", raw.progress_pct],
    ["progressPct", raw.progressPct],
    ["progress", raw.progress],
    ["graduation_progress", raw.graduation_progress],
    ["completion", raw.completion],
    ["percent_complete", raw.percent_complete],
    ["bonding_curve.progress", readPath(raw, ["bonding_curve", "progress"])],
    ["bonding_curve.progress_pct", readPath(raw, ["bonding_curve", "progress_pct"])],
    ["bonding_curve.progress_percent", readPath(raw, ["bonding_curve", "progress_percent"])],
  ];
  for (const [field, value] of progressFields) {
    const n = toNumber(value);
    if (n == null) continue;
    return {
      progressPct: normalizeProgressPct(n),
      field,
      fallback: null,
    };
  }

  const realTokenReserves = firstNumber([raw.real_token_reserves, raw.realTokenReserves]);
  if (realTokenReserves != null && realTokenReserves >= 0) {
    const totalSupply = firstNumber([raw.total_supply, raw.totalSupply]);
    const initialFromField = firstNumber([
      raw.initial_real_token_reserves,
      raw.initialRealTokenReserves,
      readPath(raw, ["bonding_curve", "initial_real_token_reserves"]),
      readPath(raw, ["bondingCurve", "initialRealTokenReserves"]),
    ]);
    const inferredInitial =
      initialFromField ??
      (totalSupply != null && totalSupply > 0 ? totalSupply * PUMP_INITIAL_REAL_TOKEN_RESERVES_RATIO : null) ??
      PUMP_DEFAULT_INITIAL_REAL_TOKEN_RESERVES;

    if (Number.isFinite(inferredInitial) && inferredInitial > 0 && realTokenReserves <= inferredInitial * 1.5) {
      const ratio = ((inferredInitial - realTokenReserves) / inferredInitial) * 100;
      return {
        progressPct: clampPct(ratio),
        field: "derived_from_real_token_reserves",
        fallback: "derived",
      };
    }
  }

  return {
    progressPct: null,
    field: null,
    fallback: "missing_progress_fields",
  };
}

type ParsedRemaining = {
  remaining: number | null;
  field: string | null;
  fallback: string | null;
};

function parseRemainingToGraduate(raw: Record<string, unknown>, progressPct: number | null): ParsedRemaining {
  const remainingFields: Array<[string, unknown]> = [
    ["remaining_to_graduate", raw.remaining_to_graduate],
    ["remainingToGraduate", raw.remainingToGraduate],
    ["bonding_curve_remaining", raw.bonding_curve_remaining],
    ["remaining", raw.remaining],
    ["bonding_curve.remaining", readPath(raw, ["bonding_curve", "remaining"])],
    ["bonding_curve.remaining_percent", readPath(raw, ["bonding_curve", "remaining_percent"])],
  ];
  for (const [field, value] of remainingFields) {
    const n = toNumber(value);
    if (n == null || n < 0) continue;
    return {
      remaining: n,
      field,
      fallback: null,
    };
  }

  if (progressPct != null) {
    return {
      remaining: clampPct(100 - progressPct),
      field: "derived_from_progress",
      fallback: "derived",
    };
  }

  return {
    remaining: null,
    field: null,
    fallback: "missing_remaining_fields",
  };
}

function parseLastTradeAt(raw: Record<string, unknown>): string | null {
  const ts = firstNumber([
    raw.last_trade_timestamp,
    raw.lastTradeTimestamp,
    raw.last_trade_time,
    raw.lastTradeTime,
    raw.last_tx_at,
    raw.lastTxAt,
  ]);
  if (ts != null && ts > 0) {
    const ms = ts > 1_000_000_000_000 ? ts : ts * 1000;
    const date = new Date(ms);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const iso = firstText([raw.last_trade_at, raw.lastTradeAt, raw.updated_at, raw.updatedAt]);
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function parseActivityCount(raw: Record<string, unknown>): number | null {
  const buys = firstNumber([
    raw.buys_5m,
    raw.buys5m,
    raw.buys_1h,
    raw.buys1h,
    readPath(raw, ["txns", "m5", "buys"]),
    readPath(raw, ["txns", "h1", "buys"]),
  ]) || 0;
  const sells = firstNumber([
    raw.sells_5m,
    raw.sells5m,
    raw.sells_1h,
    raw.sells1h,
    raw.sellTransactions,
    readPath(raw, ["txns", "m5", "sells"]),
    readPath(raw, ["txns", "h1", "sells"]),
  ]) || 0;
  const txns = firstNumber([raw.transactions]) || 0;
  const total = buys + sells;
  return total > 0 ? total : txns > 0 ? txns : null;
}

function parseVolumeUsd(raw: Record<string, unknown>): number | null {
  return firstNumber([
    raw.volume_5m_usd,
    raw.volume_1h_usd,
    raw.volume_24h_usd,
    raw.volume5mUsd,
    raw.volume1hUsd,
    raw.volume24hUsd,
    raw.volume_usd,
    raw.volumeUsd,
    raw.volume,
    readPath(raw, ["volume", "m5"]),
    readPath(raw, ["volume", "h1"]),
    readPath(raw, ["volume", "h24"]),
    readPath(raw, ["volume", "usd"]),
  ]);
}

function parseMomentum(raw: Record<string, unknown>): number | null {
  return firstNumber([
    raw.momentum,
    raw.momentum_score,
    raw.price_change_5m,
    raw.price_change_1h,
    raw.priceChange5m,
    raw.priceChange1h,
    readPath(raw, ["priceChange", "m5"]),
    readPath(raw, ["priceChange", "h1"]),
  ]);
}

function parseMint(raw: Record<string, unknown>, fallbackMint?: string): string {
  return (
    firstText([
      raw.mint,
      raw.coinMint,
      raw.token_mint,
      raw.tokenMint,
      raw.address,
      raw.ca,
      fallbackMint,
    ]) || ""
  );
}

function parseMetadata(raw: Record<string, unknown>, fallbackMint: string) {
  return {
    symbol:
      firstText([raw.symbol, raw.ticker, raw.token_symbol, raw.tokenSymbol]) || fallbackMint.slice(0, 6),
    name: firstText([raw.name, raw.token_name, raw.tokenName]) || fallbackMint.slice(0, 6),
    imageUri:
      firstText([raw.image_uri, raw.image, raw.imageUrl, raw.logoURI, raw.logo_uri, raw.logo]) || null,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function extractListPayload(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw.filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
  const root = asObject(raw);
  const direct = root.coins ?? root.data ?? root.items ?? root.results;
  if (Array.isArray(direct)) {
    return direct.filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
  }
  return [];
}

function mapRawToCandidate(raw: Record<string, unknown>, source: string): FlashCryptoGraduationCandidate | null {
  const mint = parseMint(raw);
  if (!mint) return null;

  const didGraduateParsed = parseDidGraduate(raw);
  const progressParsed = parseProgressPct(raw, didGraduateParsed.didGraduate);
  const remainingParsed = parseRemainingToGraduate(raw, progressParsed.progressPct);
  const meta = parseMetadata(raw, mint);

  return {
    mint,
    symbol: meta.symbol,
    name: meta.name,
    imageUri: meta.imageUri,
    progressPct: progressParsed.progressPct ?? 0,
    didGraduate: didGraduateParsed.didGraduate,
    remainingToGraduate: remainingParsed.remaining,
    provider: "pump_fun",
    source,
    fetchedAt: new Date().toISOString(),
    lastTradeAt: parseLastTradeAt(raw),
    volumeUsd: parseVolumeUsd(raw),
    activityCount: parseActivityCount(raw),
    momentum: parseMomentum(raw),
    raw,
    progressField: progressParsed.field,
    didGraduateField: didGraduateParsed.field,
    remainingField: remainingParsed.field,
    progressFallback: progressParsed.fallback,
    remainingFallback: remainingParsed.fallback,
  };
}

async function fetchCoinByMint(mint: string): Promise<FlashCryptoGraduationCandidate | null> {
  let lastError: string | null = null;
  for (const base of PUMP_FRONTEND_APIS) {
    const endpoint = `${base}/coins/${encodeURIComponent(mint)}`;
    try {
      const json = await fetchJson(endpoint);
      const raw = asObject(asObject(json).coin || json);
      const candidate = mapRawToCandidate(
        raw,
        `pump_fun:frontend-api.coins_by_mint:${base.includes("v3") ? "v3" : "v1"}`,
      );
      if (candidate) {
        logGraduation(
          `token=${mint} source=${candidate.source} progress=${candidate.progressPct.toFixed(2)} didGraduate=${candidate.didGraduate} progressField=${candidate.progressField || "none"} didField=${candidate.didGraduateField || "none"} fallback=${candidate.progressFallback || "none"}`,
          {
            endpoint,
            keys: Object.keys(raw).slice(0, 12),
            hasBondingCurveProgress:
              raw.bonding_curve_progress != null ||
              raw.bondingCurveProgress != null,
            hasRealTokenReserves:
              firstNumber([raw.real_token_reserves, raw.realTokenReserves]) != null,
          },
        );
        return candidate;
      }
    } catch (error: any) {
      lastError = String(error?.message || error || "unknown error");
      logGraduation("coin-by-mint fetch failed", { token: mint, endpoint, error: lastError });
    }
  }
  if (lastError) throw new Error(lastError);
  return null;
}

export async function getFlashCryptoGraduationSnapshot(rawMint: string): Promise<FlashCryptoGraduationSnapshot> {
  const mint = parsePumpTokenInput(rawMint);
  const byMint = await fetchCoinByMint(mint);
  let candidate = byMint;
  if (!candidate) {
    throw new Error(`pump.fun graduation snapshot unavailable for mint=${mint}`);
  }

  if (!candidate.symbol || !candidate.name || !candidate.imageUri) {
    try {
      const token = await fetchPumpToken(mint);
      candidate = {
        ...candidate,
        symbol: candidate.symbol || token.symbol,
        name: candidate.name || token.name,
        imageUri: candidate.imageUri || token.imageUri,
      };
    } catch {
      // keep pump.fun metadata only
    }
  }

  logGraduation(
    `token=${candidate.mint} source=${candidate.source} progress=${candidate.progressPct.toFixed(2)} didGraduate=${candidate.didGraduate} progressField=${candidate.progressField || "none"} didField=${candidate.didGraduateField || "none"} fallback=${candidate.progressFallback || "none"}`,
    {
      remainingToGraduate: candidate.remainingToGraduate,
      remainingField: candidate.remainingField,
      remainingFallback: candidate.remainingFallback,
    },
  );

  return {
    mint: candidate.mint,
    symbol: candidate.symbol,
    name: candidate.name,
    imageUri: candidate.imageUri,
    progressPct: clampPct(candidate.progressPct),
    didGraduate: candidate.didGraduate,
    remainingToGraduate: candidate.remainingToGraduate,
    provider: "pump_fun",
    source: candidate.source,
    fetchedAt: new Date().toISOString(),
  };
}

export async function listPumpFunGraduationCandidates(limit = 120): Promise<FlashCryptoGraduationCandidate[]> {
  const capped = Math.max(20, Math.min(300, Math.floor(limit)));
  const pageSize = 30;
  const maxPages = Math.max(1, Math.ceil(capped / pageSize));

  const urls: string[] = [];
  for (const sortBy of ["lastTradeTime", "marketCap"]) {
    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageSize;
      urls.push(
        `${PUMP_ADVANCED_API}/coins/list?offset=${offset}&limit=${pageSize}&sortBy=${sortBy}&sortType=DESC&includeNsfw=false`,
      );
    }
  }
  for (const base of PUMP_FRONTEND_APIS) {
    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageSize;
      urls.push(
        `${base}/coins?offset=${offset}&limit=${pageSize}&sort=last_trade_timestamp&order=DESC&includeNsfw=false`,
        `${base}/coins?offset=${offset}&limit=${pageSize}&sort=market_cap&order=DESC&includeNsfw=false`,
      );
    }
  }

  const out = new Map<string, FlashCryptoGraduationCandidate>();
  for (const url of urls) {
    try {
      const json = await fetchJson(url);
      const items = extractListPayload(json);
      if (!items.length) continue;
      for (const raw of items) {
        const source = url.includes(PUMP_ADVANCED_API)
          ? "pump_fun:advanced-api-v2.coins_list"
          : "pump_fun:frontend-api.coins_list";
        const candidate = mapRawToCandidate(raw, source);
        if (!candidate) continue;
        const current = out.get(candidate.mint);
        if (!current || (candidate.progressPct > current.progressPct)) {
          out.set(candidate.mint, candidate);
        }
      }
      if (out.size >= capped) break;
    } catch {
      // try next endpoint
    }
  }

  return Array.from(out.values()).slice(0, capped);
}

export async function getFlashCryptoGraduationStartSnapshot(rawMint: string): Promise<FlashCryptoGraduationSnapshot> {
  return getFlashCryptoGraduationSnapshot(rawMint);
}

export async function getFlashCryptoGraduationEndSnapshot(rawMint: string): Promise<FlashCryptoGraduationSnapshot> {
  return getFlashCryptoGraduationSnapshot(rawMint);
}
