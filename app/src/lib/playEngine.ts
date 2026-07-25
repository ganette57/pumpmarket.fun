// app/src/lib/playEngine.ts
//
// Thin, typed server-side wrappers over the Play Mode Postgres RPCs.
//
// AUTHORITATIVE MATH LIVES IN POSTGRES, NOT HERE.
// This module deliberately contains no pricing, no share calculation, no
// payout formula and no balance arithmetic. It marshals arguments, calls
// the SECURITY DEFINER functions defined in
// supabase/migrations/20260721_play_mode_core.sql, and types the result.
// If you find yourself about to write `base + supply * slope` in this
// file, stop — that is the mistake Real Mode already made five times over
// (see the Phase 0 audit).
//
// Every call uses the service-role client. Play tables have RLS enabled
// with no anon policies, so this is the only path in.

import { supabaseServer } from "@/lib/supabaseServer";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type PlayTradeStatus = "open" | "won" | "lost" | "refunded";
export type PlayMarketStateStatus = "open" | "finalized" | "cancelled";

export type PlayAccount = {
  id: string;
  wallet_address: string;
  privy_user_id: string | null;
  balance_usd: string; // numeric — kept as string, never parsed into a float
  last_grant_date: string | null;
  is_internal: boolean;
  is_eligible: boolean;
  created_at: string;
  updated_at: string;
};

export type PlaySeason = {
  id: number;
  starts_at: string;
  ends_at: string;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
};

export type PlayAuthNonce = {
  nonce: string;
  wallet_address: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
};

export type PlayMarketState = {
  id: string;
  market_address: string;
  created_in_season_id: number | null;
  outcome_count: number;
  outcome_supplies: string[];
  virtual_pool_usd: string;
  status: PlayMarketStateStatus;
  version: number;
  /** Empty while open; on settlement records why it settled that way. */
  settlement_meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
};

/** Why a market settled the way it did. */
export type PlaySettleReason =
  | "pro_rata"
  | "cancelled"
  /** Finalized on a valid outcome that no Play user held — whole market refunded. */
  | "no_winning_positions";

export type PlayTrade = {
  id: string;
  account_id: string;
  season_id: number;
  trade_date: string;
  market_address: string;
  outcome_index: number;
  outcome_name: string | null;
  stake_usd: string;
  shares: string;
  entry_supply: string;
  quoted_cost_usd: string;
  status: PlayTradeStatus;
  payout_usd: string | null;
  realized_pnl_usd: string | null;
  client_trade_id: string;
  created_at: string;
  settled_at: string | null;
};

export type PlayQuote = {
  market_address: string;
  outcome_index: number;
  outcome_count: number;
  supplies: string[];
  supplies_after: string[];
  implied_probs: string[];
  implied_probs_after: string[];
  virtual_pool_usd: string;
  virtual_pool_usd_after: string;
  stake_usd: string;
  shares: string;
  avg_price_usd: string | null;
  estimated_payout_usd: string;
  estimated_multiple: string | null;
  balance_usd: string;
  state_version: number;
  quoted_at: string;
};

export type PlayTradeResult = {
  replayed: boolean;
  trade: PlayTrade;
  balance_usd: string;
  market_state: PlayMarketState;
  implied_probs?: string[];
};

export type PlaySettlementResult = {
  settled: boolean;
  /**
   * On a settled market this is a PlaySettleReason. On a no-op
   * (`settled: false`, or a market with no Play state) it is a free-text
   * explanation such as "market not in a terminal state".
   */
  reason?: PlaySettleReason | string;
  /**
   * false on the settlement that actually moved the money; true on any
   * later call against an already-terminal market. On a repeat call
   * `trades_settled` and `paid_out_usd` describe THIS invocation (both 0),
   * while `reason` / `winning_outcome` / `final_pool_usd` /
   * `original_paid_out_usd` / `original_trades_settled` / `settlement_meta`
   * describe the ORIGINAL settlement, read from persisted state.
   */
  already_settled?: boolean;
  market_address?: string;
  resolution_status?: string;
  winning_outcome?: number | null;
  /** True when the market finalized but nobody held the winning outcome. */
  no_winning_positions?: boolean;
  /** True when every open trade was refunded rather than paid pro-rata. */
  refunded_all?: boolean;
  /** Money moved by THIS invocation (0 on a repeat call). */
  trades_settled: number;
  final_pool_usd?: string;
  /** Money moved by THIS invocation (0 on a repeat call). */
  paid_out_usd?: string;
  dust_usd?: string;
  total_winning_shares?: string;
  /** Repeat-call only: the original settlement's totals, from persisted meta. */
  original_paid_out_usd?: string;
  original_trades_settled?: number;
  settlement_meta?: Record<string, unknown>;
  market_state?: PlayMarketState;
};

export type PlayRolloverResult = {
  rolled: boolean;
  reason?: string;
  closed_season_id?: number;
  new_season_id?: number;
  new_starts_at?: string;
  new_ends_at?: string;
  accounts_reset?: number;
  balance_cleared_usd?: string;
};

/** Raised for engine-level refusals (insufficient balance, closed market…). */
export class PlayEngineError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "PlayEngineError";
    this.status = status;
  }
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// Postgres RAISE EXCEPTION messages arrive prefixed with "play: ". Anything
// that starts with that prefix is a deliberate, user-safe refusal. Anything
// else is an internal fault and must not leak to the client.
function toEngineError(error: { message?: string } | null): PlayEngineError {
  const raw = String(error?.message || "Play engine error");
  if (raw.startsWith("play: ")) {
    return new PlayEngineError(raw.slice("play: ".length), 400);
  }
  console.error("[playEngine] unexpected error:", raw);
  return new PlayEngineError("Play engine error", 500);
}

/**
 * Stake is currency. It is validated here as a *string-safe* 2-decimal
 * value and handed to Postgres as a string so it lands in NUMERIC without
 * ever passing through a JS float.
 */
export function normalizeStake(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : String(input ?? "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(raw)) {
    throw new PlayEngineError(
      "stake_usd must be a positive amount with at most 2 decimals"
    );
  }
  if (Number(raw) <= 0) {
    throw new PlayEngineError("stake_usd must be greater than zero");
  }
  return raw;
}

export function normalizeOutcomeIndex(input: unknown): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 0 || n > 9) {
    throw new PlayEngineError("outcome_index must be an integer in 0..9");
  }
  return n;
}

export function normalizeMarketAddress(input: unknown): string {
  const s = String(input ?? "").trim();
  if (!s || s.length < 32 || s.length > 64) {
    throw new PlayEngineError("market_address is missing or malformed");
  }
  return s;
}

export function normalizeClientTradeId(input: unknown): string {
  const s = String(input ?? "").trim();
  if (!s || s.length > 128) {
    throw new PlayEngineError("client_trade_id is required (max 128 chars)");
  }
  return s;
}

/* -------------------------------------------------------------------------- */
/*  Engine calls                                                               */
/* -------------------------------------------------------------------------- */

export async function ensureAccount(wallet: string): Promise<PlayAccount> {
  const { data, error } = await supabaseServer().rpc("play_ensure_account", {
    wallet_in: wallet,
  });
  if (error) throw toEngineError(error);
  return data as PlayAccount;
}

/** Stores a freshly generated sign-in challenge for a wallet. */
export async function issueNonce(args: {
  wallet: string;
  nonce: string;
  ttlSeconds: number;
}): Promise<PlayAuthNonce> {
  const { data, error } = await supabaseServer().rpc("play_issue_nonce", {
    wallet_in: args.wallet,
    nonce_in: args.nonce,
    ttl_seconds_in: args.ttlSeconds,
  });
  if (error) throw toEngineError(error);
  return data as PlayAuthNonce;
}

/**
 * Atomically spends a challenge. Returns null when the nonce is unknown,
 * bound to a different wallet, already consumed, or expired.
 */
export async function consumeNonce(args: {
  nonce: string;
  wallet: string;
}): Promise<PlayAuthNonce | null> {
  const { data, error } = await supabaseServer().rpc("play_consume_nonce", {
    nonce_in: args.nonce,
    wallet_in: args.wallet,
  });
  if (error) throw toEngineError(error);
  const row = data as PlayAuthNonce | null;
  return row && row.nonce ? row : null;
}

export async function ensureDailyGrant(accountId: string): Promise<string> {
  const { data, error } = await supabaseServer().rpc("play_ensure_daily_grant", {
    account_id_in: accountId,
  });
  if (error) throw toEngineError(error);
  return String(data);
}

export async function currentSeason(): Promise<PlaySeason> {
  const { data, error } = await supabaseServer().rpc("play_current_season");
  if (error) throw toEngineError(error);
  return data as PlaySeason;
}

export async function quote(args: {
  wallet: string;
  marketAddress: string;
  outcomeIndex: number;
  stakeUsd: string;
}): Promise<PlayQuote> {
  const { data, error } = await supabaseServer().rpc("play_quote", {
    wallet_in: args.wallet,
    market_address_in: args.marketAddress,
    outcome_index_in: args.outcomeIndex,
    stake_usd_in: args.stakeUsd,
  });
  if (error) throw toEngineError(error);
  return data as PlayQuote;
}

export async function executeTrade(args: {
  wallet: string;
  marketAddress: string;
  outcomeIndex: number;
  stakeUsd: string;
  clientTradeId: string;
}): Promise<PlayTradeResult> {
  const { data, error } = await supabaseServer().rpc("play_execute_trade", {
    wallet_in: args.wallet,
    market_address_in: args.marketAddress,
    outcome_index_in: args.outcomeIndex,
    stake_usd_in: args.stakeUsd,
    client_trade_id_in: args.clientTradeId,
  });
  if (error) throw toEngineError(error);
  return data as PlayTradeResult;
}

export async function settleMarket(
  marketAddress: string
): Promise<PlaySettlementResult> {
  const { data, error } = await supabaseServer().rpc("play_settle_market", {
    market_address_in: marketAddress,
  });
  if (error) throw toEngineError(error);
  return data as PlaySettlementResult;
}

export async function rolloverSeason(): Promise<PlayRolloverResult> {
  const { data, error } = await supabaseServer().rpc("play_rollover_season");
  if (error) throw toEngineError(error);
  return data as PlayRolloverResult;
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                      */
/* -------------------------------------------------------------------------- */

const TRADE_COLS =
  "id,account_id,season_id,trade_date,market_address,outcome_index,outcome_name," +
  "stake_usd,shares,entry_supply,quoted_cost_usd,status,payout_usd,realized_pnl_usd," +
  "client_trade_id,created_at,settled_at";

export async function getTrades(args: {
  accountId: string;
  limit?: number;
  status?: PlayTradeStatus;
}): Promise<PlayTrade[]> {
  let q = supabaseServer()
    .from("play_trades")
    .select(TRADE_COLS)
    .eq("account_id", args.accountId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(args.limit ?? 50, 1), 200));

  if (args.status) q = q.eq("status", args.status);

  const { data, error } = await q;
  if (error) throw toEngineError(error);
  return (data || []) as unknown as PlayTrade[];
}

/** Public per-market Play book for the feed. No user-scoped data. */
export type PlayMarketSnapshot = {
  market_address: string;
  outcome_count: number;
  supplies: string[];
  /** 0..1, mirrors SQL play_implied_probs (supply_i / SUM(supply)). */
  probabilities: number[];
  virtual_pool_usd: string;
  status: PlayMarketStateStatus;
  version: number;
  /** True when no Play state row exists yet — this is the opening book. */
  seeded: boolean;
  updated_at: string | null;
};

/**
 * Batch Play snapshots for a list of markets.
 *
 * Markets that have never been touched in Play have no play_market_states
 * row. Rather than omit them (which would leave the feed blank or, worse,
 * tempt a Real fallback), we synthesize the SAME opening book the engine
 * would create on first interaction: an equal seed on every outcome, read
 * from play_settings. So a fresh 2-outcome market reports 50/50 and a
 * 3-outcome market 33/33/33 — backend-defined, never client-invented.
 *
 * Only normalization happens here (supply / total). All real pricing —
 * shares for a stake, payouts — stays in Postgres.
 */
export async function getPlayMarketSnapshots(
  addresses: string[]
): Promise<Record<string, PlayMarketSnapshot>> {
  if (addresses.length === 0) return {};
  const supa = supabaseServer();

  const [settingsRes, statesRes, marketsRes] = await Promise.all([
    supa
      .from("play_settings")
      .select("initial_supply_per_outcome")
      .eq("id", 1)
      .maybeSingle(),
    supa
      .from("play_market_states")
      .select(
        "market_address,outcome_count,outcome_supplies,virtual_pool_usd,status,version,updated_at"
      )
      .in("market_address", addresses),
    supa
      .from("markets")
      .select("market_address,outcome_names,market_type")
      .in("market_address", addresses),
  ]);

  if (statesRes.error) throw toEngineError(statesRes.error);

  const seed = String(settingsRes.data?.initial_supply_per_outcome ?? "5000");

  // Outcome count for markets with no Play state yet.
  const outcomeCount = new Map<string, number>();
  for (const m of marketsRes.data || []) {
    const names = (m as any).outcome_names;
    const n = Array.isArray(names) ? names.length : 0;
    outcomeCount.set(
      String((m as any).market_address),
      n >= 2 ? n : Number((m as any).market_type) === 0 ? 2 : 0
    );
  }

  const probabilities = (supplies: string[]): number[] => {
    const nums = supplies.map((s) => Number(s) || 0);
    const total = nums.reduce((a, b) => a + b, 0);
    if (total <= 0) return nums.map(() => 1 / Math.max(nums.length, 1));
    return nums.map((s) => s / total);
  };

  const out: Record<string, PlayMarketSnapshot> = {};

  for (const row of statesRes.data || []) {
    const addr = String((row as any).market_address);
    const supplies = ((row as any).outcome_supplies || []).map((s: unknown) =>
      String(s)
    );
    out[addr] = {
      market_address: addr,
      outcome_count: Number((row as any).outcome_count) || supplies.length,
      supplies,
      probabilities: probabilities(supplies),
      virtual_pool_usd: String((row as any).virtual_pool_usd ?? "0"),
      status: ((row as any).status || "open") as PlayMarketStateStatus,
      version: Number((row as any).version) || 0,
      seeded: false,
      updated_at: (row as any).updated_at ?? null,
    };
  }

  for (const addr of addresses) {
    if (out[addr]) continue;
    const n = outcomeCount.get(addr) ?? 0;
    if (n < 2) continue; // unknown market — omit rather than invent
    const supplies = Array.from({ length: n }, () => seed);
    out[addr] = {
      market_address: addr,
      outcome_count: n,
      supplies,
      probabilities: probabilities(supplies),
      virtual_pool_usd: "0",
      status: "open",
      version: 0,
      seeded: true,
      updated_at: null,
    };
  }

  return out;
}

export async function getMarketState(
  marketAddress: string
): Promise<PlayMarketState | null> {
  const { data, error } = await supabaseServer()
    .from("play_market_states")
    .select("*")
    .eq("market_address", marketAddress)
    .maybeSingle();
  if (error) throw toEngineError(error);
  return (data as PlayMarketState) ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Play chart history                                                         */
/* -------------------------------------------------------------------------- */

/** One point on the Play probability/price chart. index-stable per outcome. */
export type PlayHistoryPoint = {
  /** ISO timestamp of the event (opening book, or a trade). */
  t: string;
  /** 0 = opening book, then the trade sequence number (1..N). */
  seq: number;
  /** Implied probability per outcome, 0..100, ordered by outcome index. */
  pct: number[];
  /** Cumulative virtual pool USD after this point (decimal string). */
  pool_usd: string;
};

export type PlayMarketHistory = {
  market_address: string;
  outcome_count: number;
  outcome_names: string[];
  status: PlayMarketStateStatus;
  /** Authoritative play_market_states.version (change signal), 0 if untouched. */
  version: number;
  /** True when there are no Play trades yet — the chart is the opening book only. */
  seeded: boolean;
  points: PlayHistoryPoint[];
};

/** Hard ceiling on trade rows scanned per market — bounds a pathological read. */
const PLAY_HISTORY_MAX_TRADES = 5000;
/** Default number of points returned after downsampling. */
const PLAY_HISTORY_MAX_POINTS = 500;

/** supply_i / SUM(supply) * 100, mirrors SQL play_implied_probs. Even split on empty. */
function playPctFromSupplies(supplies: number[]): number[] {
  const total = supplies.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (total <= 0) return supplies.map(() => 100 / Math.max(supplies.length, 1));
  return supplies.map((s) => Number((((s > 0 ? s : 0) / total) * 100).toFixed(4)));
}

/**
 * Stride downsample that always keeps the first and last point. Play history
 * is small in practice (buy-only, flash markets), so this only trips on the
 * rare long-lived market. Never smooths values — it drops whole points.
 */
function downsampleHistory(
  points: PlayHistoryPoint[],
  maxPoints: number
): PlayHistoryPoint[] {
  if (points.length <= maxPoints || maxPoints < 2) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: PlayHistoryPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Authoritative Play probability history for one market, reconstructed from
 * the append-only play_trades ledger.
 *
 * WHY REPLAY IS AUTHORITATIVE, NOT DERIVED
 * ----------------------------------------
 * Play is BUY-ONLY. play_execute_trade only ever ADDS `shares` to the bought
 * outcome's supply (see 20260721_play_mode_core.sql) — there is no sell,
 * partial close or transfer, and settlement bumps the version without touching
 * supplies. So the full outcome-supply vector at every version is exactly:
 *
 *     opening_seed  +  Σ shares per outcome, in created_at order
 *
 * The opening seed is recovered EXACTLY from persisted state when a market has
 * been touched (current supply − Σ its trade shares), and falls back to
 * play_settings.initial_supply_per_outcome (the same seed getPlayMarketSnapshots
 * uses) for an untouched market. No client math, no Real data, no fabrication:
 * the last replayed point reconciles to play_market_states.outcome_supplies.
 *
 * Idempotency: play_trades is unique on (account_id, client_trade_id), so a
 * replayed submit never adds a second row and therefore never a second point.
 */
export async function getPlayMarketHistory(
  marketAddress: string,
  opts?: { maxPoints?: number }
): Promise<PlayMarketHistory> {
  const addr = normalizeMarketAddress(marketAddress);
  const supa = supabaseServer();
  const maxPoints = Math.min(
    Math.max(opts?.maxPoints ?? PLAY_HISTORY_MAX_POINTS, 2),
    PLAY_HISTORY_MAX_POINTS
  );

  const [settingsRes, stateRes, marketRes, tradesRes] = await Promise.all([
    supa
      .from("play_settings")
      .select("initial_supply_per_outcome")
      .eq("id", 1)
      .maybeSingle(),
    supa
      .from("play_market_states")
      .select(
        "outcome_count,outcome_supplies,virtual_pool_usd,status,version,created_at"
      )
      .eq("market_address", addr)
      .maybeSingle(),
    supa
      .from("markets")
      .select("outcome_names,market_type,created_at")
      .eq("market_address", addr)
      .maybeSingle(),
    supa
      .from("play_trades")
      .select("created_at,outcome_index,shares,stake_usd")
      .eq("market_address", addr)
      .order("created_at", { ascending: true })
      .limit(PLAY_HISTORY_MAX_TRADES),
  ]);

  if (stateRes.error) throw toEngineError(stateRes.error);
  if (tradesRes.error) throw toEngineError(tradesRes.error);

  const state = (stateRes.data as any) ?? null;
  const marketRow = (marketRes.data as any) ?? null;
  const trades = ((tradesRes.data as any[]) || []).filter(Boolean);

  const names: string[] = Array.isArray(marketRow?.outcome_names)
    ? marketRow.outcome_names.map((n: unknown) => String(n))
    : [];

  const outcomeCount =
    Number(state?.outcome_count) ||
    names.length ||
    (Number(marketRow?.market_type) === 0 ? 2 : 0);

  const baseResult: PlayMarketHistory = {
    market_address: addr,
    outcome_count: outcomeCount >= 2 ? outcomeCount : 0,
    outcome_names: names,
    status: ((state?.status as PlayMarketStateStatus) || "open"),
    version: Number(state?.version) || 0,
    seeded: !state,
    points: [],
  };

  // Unknown market (no state, no outcome metadata) — nothing to draw.
  if (outcomeCount < 2) return baseResult;

  const seed = Number(settingsRes.data?.initial_supply_per_outcome ?? 5000) || 0;

  // Opening supplies: recover the EXACT seed from persisted state where we can,
  // otherwise fall back to the configured seed (equal on every outcome).
  const opening = new Array<number>(outcomeCount).fill(seed);
  if (state && Array.isArray(state.outcome_supplies)) {
    const cur = state.outcome_supplies.map((s: unknown) => Number(s) || 0);
    const bought = new Array<number>(outcomeCount).fill(0);
    for (const tr of trades) {
      const i = Number(tr.outcome_index);
      if (i >= 0 && i < outcomeCount) bought[i] += Number(tr.shares) || 0;
    }
    for (let i = 0; i < outcomeCount; i++) {
      opening[i] = Math.max(0, (cur[i] ?? seed) - (bought[i] ?? 0));
    }
  }

  const points: PlayHistoryPoint[] = [];
  const supplies = [...opening];
  // Money accumulates in integer cents — never a binary float.
  let poolCents = 0;
  const centsToStr = (c: number) => (c / 100).toFixed(2);

  const openingT =
    (state?.created_at as string) ||
    (marketRow?.created_at as string) ||
    (trades[0]?.created_at as string) ||
    new Date().toISOString();

  points.push({
    t: openingT,
    seq: 0,
    pct: playPctFromSupplies(supplies),
    pool_usd: "0.00",
  });

  let seq = 0;
  for (const tr of trades) {
    const i = Number(tr.outcome_index);
    const sh = Number(tr.shares) || 0;
    if (i >= 0 && i < outcomeCount) supplies[i] += sh;
    poolCents += Math.round((Number(tr.stake_usd) || 0) * 100);
    seq += 1;
    points.push({
      t: String(tr.created_at),
      seq,
      pct: playPctFromSupplies(supplies),
      pool_usd: centsToStr(poolCents),
    });
  }

  return {
    ...baseResult,
    seeded: trades.length === 0,
    points: downsampleHistory(points, maxPoints),
  };
}
