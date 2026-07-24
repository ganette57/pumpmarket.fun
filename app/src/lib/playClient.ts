// src/lib/playClient.ts
//
// Typed browser client for the Play backend.
//
// All fetch logic lives here — presentation components never call fetch and
// never know a route path. Every response shape below was read off the
// actual route handlers in src/app/api/play/**, not assumed.
//
// MONEY IS A DECIMAL STRING. It is never parsed into a JS number anywhere
// in this file. The backend is inconsistent about NUMERIC serialization
// (a bare NUMERIC RPC scalar arrives as a JS number, so 10000.00 becomes
// 10000, while jsonb_build_object values arrive as JSON numbers too), so
// `decimal()` normalizes either form to a canonical string exactly once,
// at the boundary. Downstream code only ever sees strings.

/* -------------------------------------------------------------------------- */
/*  Errors                                                                     */
/* -------------------------------------------------------------------------- */

export type PlayErrorKind =
  | "unauthenticated" // 401 — no/expired Play session
  | "rejected" // 403 — signature verification failed
  | "invalid" // 400 — bad amount, closed market, insufficient balance…
  | "network" // fetch threw / offline
  | "server"; // 5xx or unparseable

export class PlayApiError extends Error {
  kind: PlayErrorKind;
  status: number;
  constructor(message: string, kind: PlayErrorKind, status = 0) {
    super(message);
    this.name = "PlayApiError";
    this.kind = kind;
    this.status = status;
  }
  /** True when the caller should re-run the sign-in handshake. */
  get needsSession() {
    return this.kind === "unauthenticated";
  }
}

function kindForStatus(status: number): PlayErrorKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "rejected";
  if (status >= 400 && status < 500) return "invalid";
  return "server";
}

/* -------------------------------------------------------------------------- */
/*  Decimal handling                                                           */
/* -------------------------------------------------------------------------- */

/** Normalizes a backend NUMERIC (string or number) to a decimal string. */
export function decimal(v: unknown): string {
  if (v === null || v === undefined) return "0";
  const s = String(v).trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? s : "0";
}

// BigInt literals (100n) need target >= ES2020 and this project targets ES5;
// the esnext lib still provides the BigInt() constructor, so build the
// constants by call instead. Money stays exact — no binary float anywhere.
const BIG_ZERO = BigInt(0);
const BIG_HUNDRED = BigInt(100);

/** Exact integer cents from a decimal string — never uses binary float. */
export function toCents(v: unknown): bigint | null {
  const s = decimal(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [i, f = ""] = (neg ? s.slice(1) : s).split(".");
  const cents = BigInt(i) * BIG_HUNDRED + BigInt((f + "00").slice(0, 2));
  return neg ? -cents : cents;
}

/** "$10,000.00" — display only. */
export function formatUsd(v: unknown, opts?: { compact?: boolean }): string {
  const c = toCents(v);
  if (c === null) return "$0.00";
  const neg = c < BIG_ZERO;
  const abs = neg ? -c : c;
  const whole = (abs / BIG_HUNDRED).toString();
  const frac = (abs % BIG_HUNDRED).toString().padStart(2, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (opts?.compact && frac === "00") return `${neg ? "-" : ""}$${grouped}`;
  return `${neg ? "-" : ""}$${grouped}.${frac}`;
}

/* -------------------------------------------------------------------------- */
/*  Response types (mirrors src/app/api/play/**)                               */
/* -------------------------------------------------------------------------- */

export type PlayAccountView = {
  id: string;
  wallet_address: string;
  balance_usd: string;
  last_grant_date: string | null;
  is_eligible: boolean;
};

export type PlaySeasonView = {
  id: number;
  starts_at: string;
  ends_at: string;
  status: string;
};

export type PlayNonceResponse = {
  nonce: string;
  message: string;
  expires_at: string;
};

export type PlayVerifyResponse = {
  account: PlayAccountView;
  season: PlaySeasonView;
  session_expires_in_sec: number;
};

export type PlayOpenTrade = {
  id: string;
  market_address: string;
  outcome_index: number;
  outcome_name: string | null;
  stake_usd: string;
  shares: string;
  status: string;
  created_at: string;
};

export type PlayStateResponse = {
  account: PlayAccountView;
  season: PlaySeasonView;
  session_expires_at: number;
  open_trades: PlayOpenTrade[];
  market_state: unknown | null;
};

export type PlayQuoteView = {
  market_address: string;
  outcome_index: number;
  stake_usd: string;
  shares: string;
  avg_price_usd: string | null;
  estimated_payout_usd: string;
  estimated_multiple: string | null;
  balance_usd: string;
  implied_probs: string[];
  implied_probs_after: string[];
  state_version: number;
};

export type PlayMarketSnapshotView = {
  market_address: string;
  outcome_count: number;
  supplies: string[];
  probabilities: number[];
  virtual_pool_usd: string;
  status: string;
  version: number;
  /** No Play trades yet — this is the backend-defined opening book. */
  seeded: boolean;
  updated_at: string | null;
};

export type PlayTradeResponse = {
  replayed: boolean;
  trade: {
    id: string;
    market_address: string;
    outcome_index: number;
    outcome_name: string | null;
    stake_usd: string;
    shares: string;
    status: string;
  };
  balance_usd: string;
};

/* -------------------------------------------------------------------------- */
/*  Transport                                                                  */
/* -------------------------------------------------------------------------- */

async function post<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The Play session is an httpOnly cookie — it must ride along.
      credentials: "include",
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new PlayApiError(
      "Network error — check your connection and try again.",
      "network"
    );
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const msg =
      (json && typeof json.error === "string" && json.error) ||
      "Something went wrong.";
    throw new PlayApiError(msg, kindForStatus(res.status), res.status);
  }

  return json as T;
}

/* -------------------------------------------------------------------------- */
/*  Endpoints                                                                  */
/* -------------------------------------------------------------------------- */

export const playClient = {
  /** Step 1 of sign-in: get a single-use challenge for this wallet. */
  requestNonce(wallet: string) {
    return post<PlayNonceResponse>("/api/play/auth/nonce", { wallet });
  },

  /** Step 2 of sign-in: exchange a signature for the Play session cookie. */
  verify(args: { wallet: string; nonce: string; signature: string }) {
    return post<PlayVerifyResponse>("/api/play/auth/verify", args);
  },

  logout() {
    return post<{ ok: true }>("/api/play/auth/logout");
  },

  /** Balance, season, open positions. 401 when there is no live session. */
  async state(marketAddress?: string) {
    const raw = await post<PlayStateResponse>(
      "/api/play/state",
      marketAddress ? { market_address: marketAddress } : {}
    );
    return {
      ...raw,
      account: { ...raw.account, balance_usd: decimal(raw.account?.balance_usd) },
    };
  },

  /** Informational only — the server re-prices under a row lock on execute. */
  async quote(args: {
    marketAddress: string;
    outcomeIndex: number;
    stakeUsd: string;
  }) {
    const raw = await post<{ quote: PlayQuoteView }>("/api/play/quote", {
      market_address: args.marketAddress,
      outcome_index: args.outcomeIndex,
      stake_usd: args.stakeUsd,
    });
    const q = raw.quote;
    return {
      ...q,
      shares: decimal(q.shares),
      stake_usd: decimal(q.stake_usd),
      estimated_payout_usd: decimal(q.estimated_payout_usd),
      balance_usd: decimal(q.balance_usd),
    };
  },

  /**
   * Executes a virtual buy. `clientTradeId` is the idempotency key: a
   * replayed request returns the ORIGINAL trade with replayed=true and
   * moves no money, so a double-tap can never double-spend.
   */
  async trade(args: {
    marketAddress: string;
    outcomeIndex: number;
    stakeUsd: string;
    clientTradeId: string;
  }) {
    const raw = await post<PlayTradeResponse>("/api/play/trade", {
      market_address: args.marketAddress,
      outcome_index: args.outcomeIndex,
      stake_usd: args.stakeUsd,
      client_trade_id: args.clientTradeId,
    });
    return {
      ...raw,
      balance_usd: decimal(raw.balance_usd),
      trade: {
        ...raw.trade,
        stake_usd: decimal(raw.trade?.stake_usd),
        shares: decimal(raw.trade?.shares),
      },
    };
  },

  /**
   * Batch Play book for feed cards. Public — no session required, because
   * odds are public market data (the Real supplies are already shown to
   * signed-out visitors). Returns nothing user-scoped.
   */
  async marketSnapshots(addresses: string[]) {
    const raw = await post<{
      snapshots: Record<string, PlayMarketSnapshotView>;
    }>("/api/play/markets", { market_addresses: addresses });
    return raw.snapshots ?? {};
  },

  history(args?: { status?: string; limit?: number }) {
    return post<{ account_id: string; trades: PlayOpenTrade[] }>(
      "/api/play/history",
      args ?? {}
    );
  },
};
