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
  /** Present on the no-op branch that created the very first season. */
  season_id?: number;
  closed_season_id?: number;
  new_season_id?: number;
  new_starts_at?: string;
  new_ends_at?: string;
  /**
   * True for the weekly admin rollover, which zeroes every bankroll. False
   * for the automatic season roll that play_current_season() performs when
   * it finds an expired season — that one is pure bookkeeping and never
   * touches a balance. See 20260729_play_season_lifecycle.sql.
   */
  reset_bankrolls?: boolean;
  accounts_reset?: number;
  balance_cleared_usd?: string;
};

/** Raised for engine-level refusals (insufficient balance, closed market…). */
export class PlayEngineError extends Error {
  status: number;
  /**
   * The engine's own words, when `message` had to be replaced by something
   * safe to show a trader. Never sent to a public client — it exists so the
   * admin UI and the server logs keep the diagnosis that `message` drops.
   * Undefined whenever `message` is already the engine's text.
   */
  detail?: string;
  constructor(message: string, status = 400, detail?: string) {
    super(message);
    this.name = "PlayEngineError";
    this.status = status;
    this.detail = detail;
  }
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The season is infrastructure, not a rule of the game. A trader who is
 * told "no open season covers now(); run play_rollover_season()" has been
 * handed a database chore they cannot do anything about — so these
 * refusals, alone among the engine's, do not reach the client verbatim.
 *
 * play_current_season() now heals an expired season by itself, so any
 * message matched here means the automatic recovery ALSO failed. That is an
 * operator's problem: the raw text is logged and travels on the error's
 * `detail`, never in what the trader reads.
 */
function isSeasonUnavailable(raw: string): boolean {
  return (
    /no (open|active) season/i.test(raw) ||
    /could not open (a )?new season/i.test(raw)
  );
}

// Postgres RAISE EXCEPTION messages arrive prefixed with "play: ". Anything
// that starts with that prefix is a deliberate, user-safe refusal. Anything
// else is an internal fault and must not leak to the client.
function toEngineError(error: { message?: string } | null): PlayEngineError {
  const raw = String(error?.message || "Play engine error");
  if (raw.startsWith("play: ")) {
    const detail = raw.slice("play: ".length);
    if (isSeasonUnavailable(detail)) {
      console.error("[playEngine] season unavailable after auto-recovery:", raw);
      return new PlayEngineError(
        "Play trading is temporarily unavailable. Please try again.",
        503,
        detail
      );
    }
    return new PlayEngineError(detail, 400);
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
  /**
   * ACTUAL cumulative USD staked per outcome — SUM(play_trades.stake_usd)
   * grouped by outcome_index, index-stable and always outcome_count long
   * ("0.00" for outcomes nobody bought).
   *
   * This is NOT derivable from the other fields. `supplies` are virtual
   * shares (they include the seeded opening book, which no user paid for)
   * and `virtual_pool_usd` is the market total, so `total × probability`
   * answers a different question than "what did people actually stake on
   * this outcome". The UI needs the latter; only the trade ledger has it.
   */
  stake_by_outcome_usd: string[];
};

/**
 * Ceiling on trade rows scanned for the staked-per-outcome sums in ONE batch
 * snapshot call. Mirrors the chart replay's PLAY_HISTORY_MAX_TRADES ceiling.
 * Play is buy-only with no partial closes, so rows accrue slowly; if a batch
 * ever exceeded this the sums would undercount, hence the explicit cap rather
 * than an unbounded read.
 */
const PLAY_STAKE_MAX_TRADES = 5000;

/**
 * SUM(stake_usd) per (market_address, outcome_index), in EXACT integer cents.
 *
 * stake_usd is numeric(18,2); parsing it into a binary float and adding would
 * drift, so each value is converted to cents by string surgery and summed as
 * an integer. Returns a per-address sparse map — callers pad to outcome_count.
 *
 * Idempotency needs no handling here: play_trades is unique on
 * (account_id, client_trade_id), so a replayed submit never inserted a second
 * row and therefore can never be counted twice.
 */
function sumStakeCentsByOutcome(
  rows: Array<{
    market_address?: unknown;
    outcome_index?: unknown;
    stake_usd?: unknown;
  }>,
  addresses: string[]
): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const addr of addresses) out.set(addr, new Map());

  for (const r of rows) {
    const addr = String(r?.market_address ?? "");
    const byOutcome = out.get(addr);
    if (!byOutcome) continue; // not a requested market — ignore

    const idx = Number(r?.outcome_index);
    if (!Number.isInteger(idx) || idx < 0) continue;

    const cents = decimalToCents(r?.stake_usd);
    if (cents === null) continue;

    byOutcome.set(idx, (byOutcome.get(idx) ?? 0) + cents);
  }
  return out;
}

/** "800.00" | 800 → 80000 cents, exactly. Null when unparseable. */
export function decimalToCents(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isFinite(cents)) return null;
  return neg ? -cents : cents;
}

/** Integer cents → "1234.56". */
export function centsToDecimal(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(
    2,
    "0"
  )}`;
}

/**
 * Pads a sparse per-outcome cents map into a dense, index-stable decimal array
 * of exactly `count` entries. Outcomes nobody bought read "0.00" — they are
 * real zeros, not missing data.
 */
function denseStakeArray(
  byOutcome: Map<number, number> | undefined,
  count: number
): string[] {
  const n = Math.max(0, count);
  return Array.from({ length: n }, (_, i) =>
    centsToDecimal(byOutcome?.get(i) ?? 0)
  );
}

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

  const [settingsRes, statesRes, marketsRes, stakesRes] = await Promise.all([
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
    // Actual staked-per-outcome. Summed in Node because this PostgREST has
    // aggregate functions disabled (PGRST123), so `stake_usd.sum()` with a
    // GROUP BY is not available. The rows are three narrow columns and never
    // leave the server — only the summed array is serialized.
    supa
      .from("play_trades")
      .select("market_address,outcome_index,stake_usd")
      .in("market_address", addresses)
      .limit(PLAY_STAKE_MAX_TRADES),
  ]);

  if (statesRes.error) throw toEngineError(statesRes.error);
  if (stakesRes.error) throw toEngineError(stakesRes.error);

  const stakeCents = sumStakeCentsByOutcome(
    (stakesRes.data as any[]) || [],
    addresses
  );

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
    const count = Number((row as any).outcome_count) || supplies.length;
    out[addr] = {
      market_address: addr,
      outcome_count: count,
      supplies,
      probabilities: probabilities(supplies),
      virtual_pool_usd: String((row as any).virtual_pool_usd ?? "0"),
      status: ((row as any).status || "open") as PlayMarketStateStatus,
      version: Number((row as any).version) || 0,
      seeded: false,
      updated_at: (row as any).updated_at ?? null,
      stake_by_outcome_usd: denseStakeArray(stakeCents.get(addr), count),
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
      // Untouched market: the seeded book is virtual liquidity nobody paid
      // for, so every outcome is a real $0.00 of user stake.
      stake_by_outcome_usd: denseStakeArray(undefined, n),
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
/*  Settlement book (read-only)                                                */
/* -------------------------------------------------------------------------- */

/**
 * The two market-wide numbers play_settle_market feeds into its pro-rata
 * payout, read without settling anything.
 *
 * These are INPUTS, not a payout. Consistent with the header of this file, no
 * payout arithmetic happens server-side here; src/lib/playPayoutMath.ts owns
 * the mirror of the SQL formula, and it is the only place that mirror exists.
 *
 * Nothing user-scoped is in here — the pool is market-wide and the share total
 * is an aggregate over every trader, the same class of public book data
 * `stake_by_outcome_usd` already exposes on /api/play/markets. No account id,
 * balance, wallet or individual trade can be reconstructed from it.
 */
export type PlaySettlementBook = {
  market_address: string;
  /** The proposed (or final) winning outcome these numbers describe. */
  winning_outcome: number;
  /** play_market_states.virtual_pool_usd — the SQL's `final_pool`. */
  virtual_pool_usd: string;
  /**
   * SUM(shares) over OPEN play_trades on the winning outcome — the SQL's
   * `total_winning`. Sourced from the trade ledger exactly as the SQL sources
   * it, so the seeded opening book in `outcome_supplies` can never leak in.
   */
  total_winning_shares: string;
  /** Play state status. Anything but 'open' means settlement already ran. */
  status: PlayMarketStateStatus;
  version: number;
};

/**
 * Ceiling on open winning trades summed for one market. Beyond it the sum
 * could silently undercount, which would OVERSTATE every winner's estimate —
 * so the book comes back null instead and the UI shows no payout at all.
 */
const PLAY_WINNING_MAX_TRADES = 5000;

/** Exact sum of numeric(28,8) values, in integer 1e-8 units. Never a float. */
function sumSharesScaled(rows: Array<{ shares?: unknown }>): bigint | null {
  const SCALE = 8;
  let total = BigInt(0);
  for (const r of rows) {
    const s = String(r?.shares ?? "").trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null; // unreadable row — refuse to guess
    const neg = s.startsWith("-");
    const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
    const scaled =
      BigInt(whole || "0") * BigInt("100000000") +
      BigInt((frac + "0".repeat(SCALE)).slice(0, SCALE) || "0");
    total += neg ? -scaled : scaled;
  }
  return total;
}

/** 1e-8 units -> "1234.50000000". */
function sharesFromScaled(scaled: bigint): string {
  const neg = scaled < BigInt(0);
  const abs = neg ? -scaled : scaled;
  const unit = BigInt("100000000");
  return `${neg ? "-" : ""}${(abs / unit).toString()}.${(abs % unit)
    .toString()
    .padStart(8, "0")}`;
}

/**
 * Reads the settlement book for one market and one proposed outcome.
 *
 * READ-ONLY. It calls no RPC, settles nothing, credits nothing and mutates no
 * row — two SELECTs and an exact integer sum.
 *
 * Returns null when the answer cannot be stated exactly: no Play state row, a
 * row that is unreadable, or more open winning trades than can be summed in
 * one pass. Callers must treat null as "no estimate", never as zero.
 *
 * The numbers are stable from proposal onward: play_assert_market_tradable
 * refuses every trade once markets.resolution_status leaves 'open', so no new
 * stake can enter the pool or the winning supply between the proposal and
 * finalization.
 */
export async function getPlaySettlementBook(
  marketAddress: string,
  winningOutcome: number
): Promise<PlaySettlementBook | null> {
  if (!Number.isInteger(winningOutcome) || winningOutcome < 0) return null;

  const supa = supabaseServer();

  const stateRes = await supa
    .from("play_market_states")
    .select("market_address,virtual_pool_usd,status,version")
    .eq("market_address", marketAddress)
    .maybeSingle();
  if (stateRes.error) throw toEngineError(stateRes.error);
  if (!stateRes.data) return null; // no Play economy on this market

  // Summed in Node because this PostgREST has aggregate functions disabled
  // (PGRST123), the same reason getPlayMarketSnapshots sums stakes here. The
  // rows are a single column and never leave the server — only the total is
  // serialized. `count` is exact so a server-side row cap can never be
  // mistaken for a complete read.
  const tradesRes = await supa
    .from("play_trades")
    .select("shares", { count: "exact" })
    .eq("market_address", marketAddress)
    .eq("status", "open")
    .eq("outcome_index", winningOutcome)
    .limit(PLAY_WINNING_MAX_TRADES);
  if (tradesRes.error) throw toEngineError(tradesRes.error);

  const rows = (tradesRes.data as Array<{ shares?: unknown }>) || [];
  if (typeof tradesRes.count === "number" && tradesRes.count > rows.length) {
    return null; // truncated read — an undercount would overstate every payout
  }

  const total = sumSharesScaled(rows);
  if (total === null) return null;

  const pool = String((stateRes.data as any).virtual_pool_usd ?? "");
  if (!/^-?\d+(\.\d+)?$/.test(pool.trim())) return null;

  return {
    market_address: marketAddress,
    winning_outcome: winningOutcome,
    virtual_pool_usd: pool.trim(),
    total_winning_shares: sharesFromScaled(total),
    status: ((stateRes.data as any).status || "open") as PlayMarketStateStatus,
    version: Number((stateRes.data as any).version) || 0,
  };
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

/* -------------------------------------------------------------------------- */
/*  Play market activity (public feed)                                         */
/* -------------------------------------------------------------------------- */

/**
 * ONE public Play trade, as shown in an activity list.
 *
 * This is a deliberately narrow projection of play_trades. What is NOT here is
 * the point: no account_id, no client_trade_id (the idempotency key), no
 * season/date attribution, no balance, no ledger. `trader_label` is already
 * truncated server-side, so a full Play wallet never reaches the browser.
 */
export type PlayMarketActivityRow = {
  /** play_trades.id — the row's own PK. Used as a list key / page cursor. */
  id: string;
  outcome_index: number;
  outcome_name: string | null;
  /** Play is buy-only; there is no sell path in play_execute_trade. */
  side: "buy";
  shares: string;
  stake_usd: string;
  created_at: string;
  /** "abcd…wxyz" from the Play wallet, or "Player" when unavailable. */
  trader_label: string;
  status: PlayTradeStatus;
};

export type PlayMarketActivity = {
  market_address: string;
  outcome_names: string[];
  rows: PlayMarketActivityRow[];
  /** Cursor for the next (older) page — null when the list is exhausted. */
  next_before: string | null;
};

/** Default rows per activity read. */
const PLAY_ACTIVITY_DEFAULT_LIMIT = 30;
/** Hard ceiling — a caller cannot ask for the whole ledger. */
const PLAY_ACTIVITY_MAX_LIMIT = 100;

const ACTIVITY_COLS =
  "id,account_id,outcome_index,outcome_name,stake_usd,shares,status,created_at";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cursors are opaque to callers but must be safe to interpolate into a
 * PostgREST filter, so both halves are validated, not just parsed.
 */
function parseActivityCursor(raw: string): { createdAt: string; id: string } {
  const [ts, id] = String(raw).split("|");
  const at = new Date(String(ts));
  if (Number.isNaN(at.getTime()) || !UUID_RE.test(String(id))) {
    throw new PlayEngineError("before is not a valid activity cursor");
  }
  return { createdAt: at.toISOString(), id: String(id) };
}

/** "abcd…wxyz" — the same shape the Real activity surfaces already display. */
function shortWallet(wallet: unknown): string {
  const s = String(wallet ?? "").trim();
  if (!s) return "Player";
  return s.length <= 10 ? s : `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/**
 * Authoritative public activity for one Play market: the newest trades from
 * the append-only play_trades ledger.
 *
 * WHY EVERY STATUS COUNTS AS ACTIVITY
 * -----------------------------------
 * play_execute_trade only ever INSERTs on success, inside the same transaction
 * that debits the account — a rejected or rolled-back trade leaves no row at
 * all. And (account_id, client_trade_id) is unique, so a replayed submit
 * returns the ORIGINAL row instead of adding a second one. So every row in this
 * table is a trade that really happened, whatever it later settled to
 * ('open' | 'won' | 'lost' | 'refunded'). Filtering by status would hide real
 * history on a resolved market, so we do not filter.
 *
 * Ordering is (created_at desc, id desc): the id tiebreak makes two trades
 * sharing a timestamp deterministic, which is what stops rows shuffling
 * between refetches.
 *
 * Wallets are resolved server-side through play_accounts and TRUNCATED here.
 * The browser never receives a full Play wallet, an account id or an
 * idempotency key from this path.
 */
export async function getPlayMarketActivity(
  marketAddress: string,
  opts?: { limit?: number; before?: string }
): Promise<PlayMarketActivity> {
  const addr = normalizeMarketAddress(marketAddress);
  const supa = supabaseServer();

  const limit = Math.min(
    Math.max(Math.floor(Number(opts?.limit) || PLAY_ACTIVITY_DEFAULT_LIMIT), 1),
    PLAY_ACTIVITY_MAX_LIMIT
  );

  let tradesQ = supa
    .from("play_trades")
    .select(ACTIVITY_COLS)
    .eq("market_address", addr)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  // Keyset pagination on the FULL sort key ("<created_at>|<id>"), not on the
  // timestamp alone: two trades can share a created_at, and a timestamp-only
  // cursor would silently skip whichever of them straddles the page boundary.
  if (opts?.before) {
    const cursor = parseActivityCursor(opts.before);
    tradesQ = tradesQ.or(
      `created_at.lt.${cursor.createdAt},` +
        `and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  const [tradesRes, marketRes] = await Promise.all([
    tradesQ,
    supa
      .from("markets")
      .select("outcome_names")
      .eq("market_address", addr)
      .maybeSingle(),
  ]);

  if (tradesRes.error) throw toEngineError(tradesRes.error);

  const trades = ((tradesRes.data as any[]) || []).filter(Boolean);

  const names: string[] = Array.isArray((marketRes.data as any)?.outcome_names)
    ? (marketRes.data as any).outcome_names.map((n: unknown) => String(n))
    : [];

  // Resolve wallets in one batched read, then truncate. Never returned raw.
  const accountIds = Array.from(
    new Set(trades.map((t) => String(t.account_id)).filter(Boolean))
  );
  const labelByAccount = new Map<string, string>();
  if (accountIds.length > 0) {
    const { data: accounts, error: accountsError } = await supa
      .from("play_accounts")
      .select("id,wallet_address")
      .in("id", accountIds);
    if (accountsError) throw toEngineError(accountsError);
    for (const a of accounts || []) {
      labelByAccount.set(
        String((a as any).id),
        shortWallet((a as any).wallet_address)
      );
    }
  }

  const rows: PlayMarketActivityRow[] = trades.map((t) => {
    const idx = Number(t.outcome_index);
    return {
      id: String(t.id),
      outcome_index: Number.isFinite(idx) ? idx : 0,
      outcome_name:
        (t.outcome_name != null ? String(t.outcome_name) : null) ??
        (names[idx] != null ? String(names[idx]) : null),
      side: "buy",
      shares: String(t.shares ?? "0"),
      stake_usd: String(t.stake_usd ?? "0"),
      created_at: String(t.created_at),
      trader_label: labelByAccount.get(String(t.account_id)) ?? "Player",
      status: (String(t.status || "open") as PlayTradeStatus),
    };
  });

  const last = rows[rows.length - 1];

  return {
    market_address: addr,
    outcome_names: names,
    rows,
    // A short page means the ledger is exhausted for this market.
    next_before:
      rows.length === limit && last ? `${last.created_at}|${last.id}` : null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Play profile (grouped positions + realized P&L)                            */
/* -------------------------------------------------------------------------- */

/**
 * ONE grouped Play position: everything a wallet bought on a single
 * (market_address, outcome_index), collapsed into one row.
 *
 * Play is buy-only, so a "position" really is just the sum of its buys —
 * there is no partial close to net off and no cost basis to re-derive.
 */
export type PlayProfilePosition = {
  market_address: string;
  /** markets.question. Null when the market row is gone/unreadable. */
  market_title: string | null;
  outcome_index: number;
  outcome_name: string | null;
  /** SUM(stake_usd) over the group, exact. */
  total_stake_usd: string;
  /** SUM(shares) over the group, exact to 8 dp. */
  total_shares: string;
  /** How many individual buys were collapsed into this row. */
  trade_count: number;
  status: PlayTradeStatus;
  /** SUM(payout_usd) over SETTLED trades. Null while nothing has settled. */
  payout_usd: string | null;
  /** SUM(realized_pnl_usd) over SETTLED trades. Null while none has settled. */
  realized_pnl_usd: string | null;
  first_trade_at: string;
  last_trade_at: string;
};

export type PlayProfile = {
  wallet_address: string;
  /** profiles.display_name — the SAME identity Real Mode shows. */
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  /** True when the request carried a Play session for THIS wallet. */
  is_owner: boolean;
  /** Owner-only. Always null for a public viewer — see the route header. */
  balance_usd: string | null;
  /** SUM(realized_pnl_usd) over settled trades only. "0.00" when none. */
  realized_pnl_usd: string;
  /** Raw buys — every play_trades row. */
  trade_count: number;
  /** Grouped (market, outcome) positions — what the UI labels "Picks". */
  position_count: number;
  positions: PlayProfilePosition[];
  /** True when the ledger read hit its ceiling and totals are partial. */
  truncated: boolean;
};

/**
 * Ceiling on trade rows scanned for ONE profile. Play is buy-only on a
 * $10,000 daily bankroll, so a real account is orders of magnitude below
 * this; the cap exists so a pathological account cannot turn the profile
 * into an unbounded read. `truncated` reports when it bites.
 */
const PLAY_PROFILE_MAX_TRADES = 2000;

/** Wallets are compared and queried exactly as play_normalize_wallet stores them. */
export function normalizeWallet(input: unknown): string {
  const s = String(input ?? "").trim();
  if (s.length < 32 || s.length > 64) {
    throw new PlayEngineError("wallet is missing or malformed");
  }
  return s;
}

/** "1234.56789012" → 123456789012 units at 8 dp. Null when unparseable. */
function decimalToUnits8(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [whole, frac = ""] = (neg ? s.slice(1) : s).split(".");
  const units = Number(whole) * 1e8 + Number((frac + "00000000").slice(0, 8));
  if (!Number.isSafeInteger(units)) return null;
  return neg ? -units : units;
}

/** 123456789012 units → "1234.56789012". */
function units8ToDecimal(units: number): string {
  const neg = units < 0;
  const abs = Math.abs(Math.round(units));
  const whole = Math.floor(abs / 1e8);
  const frac = String(abs % 1e8).padStart(8, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/**
 * The status of a GROUP of buys on one outcome.
 *
 * In practice every trade in a group shares a status: settlement walks all
 * of a market's open rows in one transaction and the state then becomes
 * terminal, so no later buy can join a settled group. This is the defensive
 * rule for the mixed case anyway: an unsettled buy dominates (the position
 * is still live), and among settled rows a win dominates a loss dominates a
 * refund. It never invents a status that no trade actually has.
 */
export function groupStatus(counts: Record<PlayTradeStatus, number>): PlayTradeStatus {
  if (counts.open > 0) return "open";
  if (counts.won > 0) return "won";
  if (counts.lost > 0) return "lost";
  return "refunded";
}

/**
 * A wallet's Play profile: identity, grouped positions and authoritative
 * realized P&L.
 *
 * WHY P&L IS READ, NEVER DERIVED
 * ------------------------------
 * play_settle_market writes realized_pnl_usd on every trade it settles, in
 * the same transaction that moves the money (20260722_play_settle_idempotent.sql):
 * won → payout − stake, lost → −stake, refunded → 0. This function only ever
 * SUMS that column. It never multiplies a stake by a current probability and
 * never treats an open position's quote as profit — an open trade carries
 * null P&L by CHECK constraint and is excluded from every total here.
 *
 * GROUPING
 * --------
 * The key is (market_address, outcome_index). Buying YES and NO on the same
 * market yields two rows, never one merged row, because they are two
 * independent bets with independent outcomes.
 *
 * PRIVACY
 * -------
 * `viewerWallet` is the wallet proven by the Play session cookie, not a
 * client-supplied field. balance_usd is populated only when it matches the
 * requested wallet. The projection carries no account id, no client_trade_id,
 * no ledger row and no session data.
 */
export async function getPlayProfile(
  walletAddress: string,
  opts?: { viewerWallet?: string | null }
): Promise<PlayProfile> {
  const wallet = normalizeWallet(walletAddress);
  const isOwner = !!opts?.viewerWallet && opts.viewerWallet === wallet;
  const supa = supabaseServer();

  const [profileRes, accountRes] = await Promise.all([
    supa
      .from("profiles")
      .select("wallet_address,display_name,avatar_url,bio")
      .eq("wallet_address", wallet)
      .maybeSingle(),
    supa
      .from("play_accounts")
      .select("id,balance_usd")
      .eq("wallet_address", wallet)
      .maybeSingle(),
  ]);

  if (accountRes.error) throw toEngineError(accountRes.error);

  const identity = (profileRes.data as any) ?? null;
  const account = (accountRes.data as any) ?? null;

  const base: PlayProfile = {
    wallet_address: wallet,
    username: identity?.display_name ?? null,
    avatar_url: identity?.avatar_url ?? null,
    bio: identity?.bio ?? null,
    is_owner: isOwner,
    // No Play account yet: the owner has no balance to show, and a public
    // viewer never gets one regardless.
    balance_usd: isOwner && account ? decimalOrZero(account.balance_usd) : null,
    realized_pnl_usd: "0.00",
    trade_count: 0,
    position_count: 0,
    positions: [],
    truncated: false,
  };

  // Never played — a valid, complete profile with zeroed Play stats.
  if (!account?.id) return base;

  const { data: tradeRows, error: tradesError } = await supa
    .from("play_trades")
    .select(
      "market_address,outcome_index,outcome_name,stake_usd,shares,status," +
        "payout_usd,realized_pnl_usd,created_at"
    )
    .eq("account_id", account.id)
    .order("created_at", { ascending: false })
    .limit(PLAY_PROFILE_MAX_TRADES);

  if (tradesError) throw toEngineError(tradesError);

  const trades = ((tradeRows as any[]) || []).filter(Boolean);
  if (trades.length === 0) return base;

  type Group = {
    market_address: string;
    outcome_index: number;
    outcome_name: string | null;
    stakeCents: number;
    shareUnits: number;
    payoutCents: number;
    pnlCents: number;
    settledCount: number;
    tradeCount: number;
    counts: Record<PlayTradeStatus, number>;
    firstAt: string;
    lastAt: string;
  };

  const groups = new Map<string, Group>();
  let totalPnlCents = 0;

  for (const t of trades) {
    const addr = String(t.market_address ?? "");
    const idx = Number(t.outcome_index);
    if (!addr || !Number.isInteger(idx) || idx < 0) continue;

    const key = `${addr}|${idx}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        market_address: addr,
        outcome_index: idx,
        outcome_name: t.outcome_name != null ? String(t.outcome_name) : null,
        stakeCents: 0,
        shareUnits: 0,
        payoutCents: 0,
        pnlCents: 0,
        settledCount: 0,
        tradeCount: 0,
        counts: { open: 0, won: 0, lost: 0, refunded: 0 },
        firstAt: String(t.created_at),
        lastAt: String(t.created_at),
      };
      groups.set(key, g);
    }

    if (g.outcome_name == null && t.outcome_name != null) {
      g.outcome_name = String(t.outcome_name);
    }

    g.stakeCents += decimalToCents(t.stake_usd) ?? 0;
    g.shareUnits += decimalToUnits8(t.shares) ?? 0;
    g.tradeCount += 1;

    const status = (String(t.status || "open") as PlayTradeStatus);
    if (status in g.counts) g.counts[status] += 1;
    else g.counts.open += 1;

    // Settled rows carry BOTH money fields by CHECK constraint; open rows
    // carry neither, so an open position contributes nothing to any total.
    if (status !== "open") {
      g.settledCount += 1;
      g.payoutCents += decimalToCents(t.payout_usd) ?? 0;
      const pnl = decimalToCents(t.realized_pnl_usd) ?? 0;
      g.pnlCents += pnl;
      totalPnlCents += pnl;
    }

    const at = String(t.created_at);
    if (msOf(at) < msOf(g.firstAt)) g.firstAt = at;
    if (msOf(at) > msOf(g.lastAt)) g.lastAt = at;
  }

  // Market titles + fallback outcome names, in one batched read.
  const addresses = Array.from(new Set(Array.from(groups.values()).map((g) => g.market_address)));
  const titles = new Map<string, string | null>();
  const outcomeNames = new Map<string, string[]>();
  if (addresses.length > 0) {
    const { data: marketRows } = await supa
      .from("markets")
      .select("market_address,question,outcome_names")
      .in("market_address", addresses);
    for (const m of marketRows || []) {
      const addr = String((m as any).market_address);
      titles.set(addr, (m as any).question ?? null);
      const names = (m as any).outcome_names;
      if (Array.isArray(names)) outcomeNames.set(addr, names.map((n) => String(n)));
    }
  }

  const positions: PlayProfilePosition[] = Array.from(groups.values())
    .map((g) => ({
      market_address: g.market_address,
      market_title: titles.get(g.market_address) ?? null,
      outcome_index: g.outcome_index,
      outcome_name:
        g.outcome_name ?? outcomeNames.get(g.market_address)?.[g.outcome_index] ?? null,
      total_stake_usd: centsToDecimal(g.stakeCents),
      total_shares: units8ToDecimal(g.shareUnits),
      trade_count: g.tradeCount,
      status: groupStatus(g.counts),
      payout_usd: g.settledCount > 0 ? centsToDecimal(g.payoutCents) : null,
      realized_pnl_usd: g.settledCount > 0 ? centsToDecimal(g.pnlCents) : null,
      first_trade_at: g.firstAt,
      last_trade_at: g.lastAt,
    }))
    // Newest activity first — same ordering language as every Play surface.
    .sort((a, b) => msOf(b.last_trade_at) - msOf(a.last_trade_at));

  return {
    ...base,
    realized_pnl_usd: centsToDecimal(totalPnlCents),
    trade_count: trades.length,
    position_count: positions.length,
    positions,
    truncated: trades.length === PLAY_PROFILE_MAX_TRADES,
  };
}

/** Canonical decimal string for a backend NUMERIC, or "0.00" when absent. */
function decimalOrZero(v: unknown): string {
  const cents = decimalToCents(v);
  return cents === null ? "0.00" : centsToDecimal(cents);
}

/** Epoch ms for an ISO timestamp; 0 when unparseable so ordering stays total. */
export function msOf(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/* -------------------------------------------------------------------------- */
/*  Leaderboard                                                                */
/* -------------------------------------------------------------------------- */

export type PlayLeaderboardRow = {
  /** 1-based position in the fully-ordered ranking. */
  rank: number;
  wallet_address: string;
  /** profiles.display_name — the SAME identity Real Mode shows. */
  username: string | null;
  avatar_url: string | null;
  /** SUM(realized_pnl_usd) over settled trades. Signed decimal string. */
  realized_pnl_usd: string;
  /** Settled grouped (market, outcome) positions. */
  picks: number;
  wins: number;
  losses: number;
  /** wins / (wins + losses), 0..1 as a decimal string. Refunds excluded. */
  win_rate: string;
  /** SUM(stake_usd) over settled trades. */
  total_settled_stake_usd: string;
};

export type PlayLeaderboard = {
  /** Only "all" exists today — see the period note below. */
  period: "all";
  rows: PlayLeaderboardRow[];
  /** Eligible players BEFORE the limit was applied. */
  total_players: number;
  /** The caller's own row when a Play session is present and ranked. */
  viewer: PlayLeaderboardRow | null;
  /** True when the settled-trade scan hit its ceiling and totals are partial. */
  truncated: boolean;
  generated_at: string;
};

const PLAY_LEADERBOARD_DEFAULT_LIMIT = 50;
const PLAY_LEADERBOARD_MAX_LIMIT = 100;

/**
 * Ceiling on SETTLED trade rows scanned for one leaderboard build. Play is
 * buy-only on a $10,000 daily bankroll and only settled rows are read, so this
 * is orders of magnitude above the real ledger. `truncated` reports when it
 * bites, and the scan is ordered newest-settled-first so the cap drops the
 * oldest history rather than an arbitrary slice.
 */
const PLAY_LEADERBOARD_MAX_TRADES = 50_000;

const LEADERBOARD_COLS =
  "account_id,market_address,outcome_index,status,stake_usd,realized_pnl_usd";

/**
 * The public Play leaderboard, ranked by AUTHORITATIVE REALIZED P&L.
 *
 * WHAT IS RANKED
 * --------------
 * SUM(play_trades.realized_pnl_usd) over rows whose status is not 'open',
 * grouped by account. realized_pnl_usd is written by play_settle_market in the
 * same transaction that moves the money (won → payout − stake, lost → −stake,
 * refunded → 0). This function only ever SUMS that column.
 *
 * It never ranks on balance, deposits, daily grants, open-position value,
 * snapshot probabilities, chart points or an estimated payout. A player
 * sitting on a huge open position ranks exactly where their SETTLED results
 * put them, which is the whole point of the metric.
 *
 * GROUPING — identical to the Play profile
 * ----------------------------------------
 * Picks/wins/losses are counted over grouped (market_address, outcome_index)
 * positions, the same key getPlayProfile uses. Three buys on the same outcome
 * are ONE pick; YES and NO on the same market are TWO picks, because they are
 * two independent bets. Win rate is therefore never computed from raw buys.
 *
 * A group's status follows the profile's precedence (won > lost > refunded).
 * Open rows are filtered out at the query, so a group here is settled by
 * construction — and in practice a group can never be mixed anyway, since
 * settlement closes every open row of a market in one transaction and the
 * market state then refuses further trades.
 *
 * ELIGIBILITY
 * -----------
 * A player is ranked once they hold at least one WON or LOST group. Refund-only
 * players (cancelled markets, or a market nobody won) have a real P&L of
 * exactly zero and no competitive result, so they are not ranked; their profile
 * still exists and still shows those refunds.
 *
 * ORDERING (total, deterministic)
 * -------------------------------
 *   1. realized P&L desc   2. wins desc   3. settled picks desc
 *   4. wallet_address asc  — a unique final key, so the order is total and
 *      two identical requests can never disagree.
 * Negative players are ranked below zero and positive ones rather than hidden.
 *
 * PERIOD
 * ------
 * All Time only. play_trades DOES carry an authoritative settled_at, so a
 * period cut is possible later; it is deliberately not shipped here because
 * the Real leaderboard exposes no period control to mirror, and a filter no UI
 * offers is a filter nobody can verify.
 *
 * PRIVACY
 * -------
 * The projection carries no balance, no play_accounts UUID, no client_trade_id,
 * no ledger row, no season attribution and no session data. account_id is used
 * internally to resolve the wallet and is never returned.
 */
export async function getPlayLeaderboard(opts?: {
  limit?: number;
  /** Wallet proven by the session cookie — never a client-supplied field. */
  viewerWallet?: string | null;
}): Promise<PlayLeaderboard> {
  const supa = supabaseServer();

  const limit = Math.min(
    Math.max(
      Math.floor(Number(opts?.limit) || PLAY_LEADERBOARD_DEFAULT_LIMIT),
      1
    ),
    PLAY_LEADERBOARD_MAX_LIMIT
  );

  const generatedAt = new Date().toISOString();

  const empty: PlayLeaderboard = {
    period: "all",
    rows: [],
    total_players: 0,
    viewer: null,
    truncated: false,
    generated_at: generatedAt,
  };

  // Settled rows only. Open positions carry null P&L by CHECK constraint and
  // are excluded here at the source, not filtered out later.
  const { data: tradeRows, error: tradesError } = await supa
    .from("play_trades")
    .select(LEADERBOARD_COLS)
    .neq("status", "open")
    .order("settled_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PLAY_LEADERBOARD_MAX_TRADES);

  if (tradesError) throw toEngineError(tradesError);

  const trades = ((tradeRows as any[]) || []).filter(Boolean);
  if (trades.length === 0) return empty;

  type Agg = {
    pnlCents: number;
    stakeCents: number;
    /** group key → status counts, so picks are positions, never buys. */
    groups: Map<string, Record<PlayTradeStatus, number>>;
  };

  const byAccount = new Map<string, Agg>();

  for (const t of trades) {
    const accountId = String(t.account_id ?? "");
    const addr = String(t.market_address ?? "");
    const idx = Number(t.outcome_index);
    if (!accountId || !addr || !Number.isInteger(idx) || idx < 0) continue;

    // Settled only, enforced HERE and not merely by the query's .neq filter.
    // An open row carries null P&L, so it could never move the ranking — but
    // it would otherwise still create a pick and add its stake, which is
    // exactly the unrealized value this metric exists to exclude.
    const status = String(t.status || "") as PlayTradeStatus;
    if (status !== "won" && status !== "lost" && status !== "refunded") continue;

    let a = byAccount.get(accountId);
    if (!a) {
      a = { pnlCents: 0, stakeCents: 0, groups: new Map() };
      byAccount.set(accountId, a);
    }

    a.pnlCents += decimalToCents(t.realized_pnl_usd) ?? 0;
    a.stakeCents += decimalToCents(t.stake_usd) ?? 0;

    const key = `${addr}|${idx}`;
    let counts = a.groups.get(key);
    if (!counts) {
      counts = { open: 0, won: 0, lost: 0, refunded: 0 };
      a.groups.set(key, counts);
    }
    counts[status] += 1;
  }

  // Wallets in one batched read. account_id never leaves this function.
  const accountIds = Array.from(byAccount.keys());
  const walletByAccount = new Map<string, string>();
  if (accountIds.length > 0) {
    const { data: accounts, error: accountsError } = await supa
      .from("play_accounts")
      .select("id,wallet_address")
      .in("id", accountIds);
    if (accountsError) throw toEngineError(accountsError);
    for (const acc of accounts || []) {
      const id = String((acc as any).id ?? "");
      const w = String((acc as any).wallet_address ?? "");
      if (id && w) walletByAccount.set(id, w);
    }
  }

  type Ranked = Omit<PlayLeaderboardRow, "rank">;
  const ranked: Ranked[] = [];

  for (const [accountId, a] of Array.from(byAccount.entries())) {
    const wallet = walletByAccount.get(accountId);
    if (!wallet) continue; // orphan account row — never rank an unknown player

    let wins = 0;
    let losses = 0;
    for (const counts of Array.from(a.groups.values())) {
      // Profile precedence: won > lost > refunded. Refunded groups count as
      // settled picks but never as a win or a loss.
      if (counts.won > 0) wins += 1;
      else if (counts.lost > 0) losses += 1;
    }

    // Eligibility: a decided result is required. Refund-only players are not
    // ranked — a refund is a returned stake, not a competitive outcome.
    if (wins + losses === 0) continue;

    ranked.push({
      wallet_address: wallet,
      username: null,
      avatar_url: null,
      realized_pnl_usd: centsToDecimal(a.pnlCents),
      picks: a.groups.size,
      wins,
      losses,
      win_rate: ratioToDecimal(wins, wins + losses),
      total_settled_stake_usd: centsToDecimal(a.stakeCents),
    });
  }

  if (ranked.length === 0) {
    return { ...empty, truncated: trades.length >= PLAY_LEADERBOARD_MAX_TRADES };
  }

  // Total, deterministic order. Every comparison below is on exact integers or
  // on a unique string, so the sort is stable without relying on Array#sort
  // stability guarantees.
  const pnlCentsOf = new Map(
    ranked.map((r) => [r.wallet_address, decimalToCents(r.realized_pnl_usd) ?? 0])
  );
  ranked.sort((x, y) => {
    const px = pnlCentsOf.get(x.wallet_address) ?? 0;
    const py = pnlCentsOf.get(y.wallet_address) ?? 0;
    if (px !== py) return py - px;
    if (x.wins !== y.wins) return y.wins - x.wins;
    if (x.picks !== y.picks) return y.picks - x.picks;
    return x.wallet_address < y.wallet_address ? -1 : 1;
  });

  const viewerWallet = opts?.viewerWallet ?? null;
  const viewerIndex = viewerWallet
    ? ranked.findIndex((r) => r.wallet_address === viewerWallet)
    : -1;

  // Identity for exactly the rows that will be serialized: the visible page
  // plus the viewer's own row when it falls outside it.
  const visible = ranked.slice(0, limit);
  const needIdentity = new Set(visible.map((r) => r.wallet_address));
  if (viewerIndex >= 0) needIdentity.add(ranked[viewerIndex].wallet_address);

  const identityByWallet = new Map<
    string,
    { display_name: string | null; avatar_url: string | null }
  >();
  if (needIdentity.size > 0) {
    // Best effort: a profile read failure must never break the ranking —
    // rows fall back to the truncated wallet the UI already renders.
    const { data: profileRows } = await supa
      .from("profiles")
      .select("wallet_address,display_name,avatar_url")
      .in("wallet_address", Array.from(needIdentity));
    for (const p of profileRows || []) {
      identityByWallet.set(String((p as any).wallet_address), {
        display_name: (p as any).display_name ?? null,
        avatar_url: (p as any).avatar_url ?? null,
      });
    }
  }

  const withIdentity = (r: Ranked, rank: number): PlayLeaderboardRow => {
    const id = identityByWallet.get(r.wallet_address);
    return {
      ...r,
      rank,
      username: id?.display_name ?? null,
      avatar_url: id?.avatar_url ?? null,
    };
  };

  return {
    period: "all",
    rows: visible.map((r, i) => withIdentity(r, i + 1)),
    total_players: ranked.length,
    viewer:
      viewerIndex >= 0
        ? withIdentity(ranked[viewerIndex], viewerIndex + 1)
        : null,
    truncated: trades.length >= PLAY_LEADERBOARD_MAX_TRADES,
    generated_at: generatedAt,
  };
}

/** wins/decided as a 4-dp decimal string. "0.0000" when nothing is decided. */
export function ratioToDecimal(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0.0000";
  const scaled = Math.round((numerator / denominator) * 10_000);
  return `${Math.floor(scaled / 10_000)}.${String(scaled % 10_000).padStart(4, "0")}`;
}
