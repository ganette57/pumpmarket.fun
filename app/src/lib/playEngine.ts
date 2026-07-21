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
  market_address?: string;
  resolution_status?: string;
  winning_outcome?: number | null;
  /** True when the market finalized but nobody held the winning outcome. */
  no_winning_positions?: boolean;
  /** True when every open trade was refunded rather than paid pro-rata. */
  refunded_all?: boolean;
  trades_settled: number;
  final_pool_usd?: string;
  paid_out_usd?: string;
  dust_usd?: string;
  total_winning_shares?: string;
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
