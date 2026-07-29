// src/lib/playContests.ts
//
// The trusted server side of the Admin Play Contest.
//
// WHAT THIS MODULE OWNS
// ---------------------
//   * the period ranking (the ONLY implementation — neither the admin UI
//     nor the public page ranks anything itself, and neither ever
//     receives raw trades to rank);
//   * the freeze snapshot and its idempotency;
//   * verification, prize-status tracking and the winner audit read;
//   * the PUBLIC projection of a contest — a separate selector and a
//     separate, strictly narrower row shape, never the admin one.
//
// WHAT IT DELIBERATELY DOES NOT OWN
// ---------------------------------
// Money. Not one line here moves a balance, credits a bonus, mints a
// trading credit, touches a vault or calls Solana. `prize_amount_usd`,
// `prize_status` and `payment_reference` are an OPERATOR RECORD of a
// payment decision made somewhere else; marking a row paid records a
// fact and sends nothing.
//
// RANKING SEMANTICS — identical to the public Play leaderboard
// ------------------------------------------------------------
// Same authoritative source (SUM of play_trades.realized_pnl_usd over
// settled rows), same (market_address, outcome_index) grouping, same
// refund handling, same total deterministic order. The ONE difference is
// the eligibility filter: the public board is All Time, this one keeps
// only rows whose SETTLED_AT falls inside the contest window.
//
// settled_at is the authoritative timestamp for eligibility, never
// created_at. A pick placed before the contest opened but decided inside
// it counts; a pick placed inside the window but still undecided does
// not — because it has no realized result to rank.

import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import {
  PlayEngineError,
  centsToDecimal,
  decimalToCents,
  groupStatus,
  msOf,
  normalizeWallet,
  ratioToDecimal,
  type PlayTradeStatus,
} from "@/lib/playEngine";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type PlayContestStatus =
  | "draft"
  | "live"
  | "ended"
  | "under_review"
  | "verified"
  | "paid"
  /** Ran normally, produced no payable ranking, needs nothing further. */
  | "closed"
  | "cancelled";

export type PlayPrizeStatus =
  | "pending"
  | "verified"
  | "paid"
  | "disputed"
  | "cancelled";

export const PLAY_CONTEST_STATUSES: PlayContestStatus[] = [
  "draft",
  "live",
  "ended",
  "under_review",
  "verified",
  "paid",
  "closed",
  "cancelled",
];

/**
 * Statuses that are DONE. A terminal contest is history: it is never
 * returned as the current manageable contest, so closing one is what
 * frees the operator to create the next.
 *
 * `paid` is terminal because every prize is recorded. `closed` because
 * there was never a prize to record. `cancelled` because the period is
 * disowned. Everything else still wants an admin action.
 */
export const PLAY_CONTEST_TERMINAL_STATUSES: PlayContestStatus[] = [
  "paid",
  "closed",
  "cancelled",
];

/** Postgres `in` list for a .not("status", "in", …) filter. */
const TERMINAL_STATUS_FILTER = `(${PLAY_CONTEST_TERMINAL_STATUSES.join(",")})`;

export const PLAY_PRIZE_STATUSES: PlayPrizeStatus[] = [
  "pending",
  "verified",
  "paid",
  "disputed",
  "cancelled",
];

export type PlayContest = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: PlayContestStatus;
  prize_pool_usd: string;
  first_prize_usd: string;
  second_prize_usd: string;
  third_prize_usd: string;
  frozen_at: string | null;
  verified_at: string | null;
  created_by: string | null;
  frozen_by: string | null;
  verified_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** One ranked player for a contest period. No account id, ever. */
export type PlayContestRankingRow = {
  rank: number;
  wallet_address: string;
  /** profiles.display_name — the SAME identity every other surface shows. */
  username: string | null;
  avatar_url: string | null;
  realized_pnl_usd: string;
  /** Settled grouped (market, outcome) positions inside the window. */
  settled_picks: number;
  wins: number;
  losses: number;
  /** wins / (wins + losses). Refunded positions are not in the denominator. */
  win_rate: string;
  total_settled_stake_usd: string;
};

export type PlayContestResult = PlayContestRankingRow & {
  id: string;
  contest_id: string;
  prize_amount_usd: string;
  prize_status: PlayPrizeStatus;
  payment_reference: string | null;
  admin_note: string | null;
  frozen_at: string;
  verified_at: string | null;
  paid_at: string | null;
};

/** A market with contest-period Play activity that is still undecided. */
export type PlayContestUnresolvedMarket = {
  market_address: string;
  market_title: string | null;
  /** Open play_trades rows placed inside the window. */
  open_trades: number;
  /** play_market_states.status — 'open' or absent means Play has not settled. */
  play_state_status: string | null;
  /** markets.resolution_status, for the operator's Real-side context. */
  resolution_status: string | null;
};

export type PlayContestWindowState = "not_started" | "live" | "ended";

export type PlayContestPreview = {
  contest_id: string;
  starts_at: string;
  ends_at: string;
  window_state: PlayContestWindowState;
  /** LIVE PREVIEW — recalculated on every call. Never a stored winner. */
  rows: PlayContestRankingRow[];
  /** Eligible players BEFORE the display cap. */
  total_players: number;
  /** True when the settled-trade scan hit its ceiling and totals are partial. */
  truncated: boolean;
  generated_at: string;
  /** Operator-facing warnings. Never suppressed, never auto-resolved. */
  warnings: string[];
  unresolved_markets: PlayContestUnresolvedMarket[];
  /**
   * Server-evaluated availability of the two exits. The UI renders these
   * rather than re-deriving the policy, and the actions re-evaluate it
   * themselves — the client is never the authority on either.
   */
  can_freeze: boolean;
  freeze_blocked_reason: string | null;
  can_close: boolean;
  close_blocked_reason: string | null;
};

export type PlayContestAuditPosition = {
  market_address: string;
  market_title: string | null;
  outcome_index: number;
  outcome_name: string | null;
  total_stake_usd: string;
  payout_usd: string;
  realized_pnl_usd: string;
  status: PlayTradeStatus;
  /** Individual buys collapsed into this position. */
  trade_count: number;
  /** Latest settled_at in the group — the timestamp eligibility was judged on. */
  settled_at: string;
  /** markets.winning_outcome — the authoritative Real resolution. */
  winning_outcome: number | null;
  winning_outcome_name: string | null;
};

export type PlayContestWinnerAudit = {
  wallet_address: string;
  username: string | null;
  avatar_url: string | null;
  starts_at: string;
  ends_at: string;
  /** Recomputed from the same rows the ranking used, for reconciliation. */
  totals: {
    realized_pnl_usd: string;
    settled_picks: number;
    wins: number;
    losses: number;
    win_rate: string;
    total_settled_stake_usd: string;
  };
  positions: PlayContestAuditPosition[];
  truncated: boolean;
};

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Ceiling on SETTLED trade rows scanned for one contest ranking. Mirrors
 * the public leaderboard's ceiling; a contest window is a strict subset of
 * All Time, so this can only ever bite later than that one does.
 */
const PLAY_CONTEST_MAX_TRADES = 50_000;

/** Ceiling on OPEN trade rows scanned for the unresolved-market audit. */
const PLAY_CONTEST_MAX_OPEN_TRADES = 20_000;

/** Ceiling on settled rows read for ONE winner's audit detail. */
const PLAY_CONTEST_AUDIT_MAX_TRADES = 2_000;

/** Ranked players returned by a live preview. */
export const PLAY_CONTEST_PREVIEW_LIMIT = 50;

/**
 * How many ranked players the freeze stores. Only ranks 1–3 carry a prize;
 * the rest are frozen so a dispute over 3rd place can be settled against the
 * snapshot instead of a recalculation that may since have moved.
 */
export const PLAY_CONTEST_FROZEN_RANKS = 10;

const CONTEST_COLS =
  "id,name,starts_at,ends_at,timezone,status,prize_pool_usd,first_prize_usd," +
  "second_prize_usd,third_prize_usd,frozen_at,verified_at,created_by," +
  "frozen_by,verified_by,notes,created_at,updated_at";

const RESULT_COLS =
  "id,contest_id,rank,wallet_address,realized_pnl_usd,settled_picks,wins," +
  "losses,win_rate,total_settled_stake_usd,prize_amount_usd,prize_status," +
  "payment_reference,admin_note,frozen_at,verified_at,paid_at";

const RANKING_COLS =
  "account_id,market_address,outcome_index,status,stake_usd,realized_pnl_usd";

/** Postgres unique-violation. Two racing freezes land here, not on a duplicate. */
const PG_UNIQUE_VIOLATION = "23505";

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function toEngineError(error: { message?: string } | null): PlayEngineError {
  return new PlayEngineError(error?.message || "Play contest query failed", 500);
}

function rowToContest(r: any): PlayContest {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    starts_at: String(r.starts_at),
    ends_at: String(r.ends_at),
    timezone: String(r.timezone ?? "UTC"),
    status: String(r.status) as PlayContestStatus,
    prize_pool_usd: decimalOr(r.prize_pool_usd),
    first_prize_usd: decimalOr(r.first_prize_usd),
    second_prize_usd: decimalOr(r.second_prize_usd),
    third_prize_usd: decimalOr(r.third_prize_usd),
    frozen_at: r.frozen_at ? String(r.frozen_at) : null,
    verified_at: r.verified_at ? String(r.verified_at) : null,
    created_by: r.created_by ? String(r.created_by) : null,
    frozen_by: r.frozen_by ? String(r.frozen_by) : null,
    verified_by: r.verified_by ? String(r.verified_by) : null,
    notes: r.notes ? String(r.notes) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function rowToResult(r: any): PlayContestResult {
  return {
    id: String(r.id),
    contest_id: String(r.contest_id),
    rank: Number(r.rank),
    wallet_address: String(r.wallet_address),
    username: null,
    avatar_url: null,
    realized_pnl_usd: decimalOr(r.realized_pnl_usd),
    settled_picks: Number(r.settled_picks ?? 0),
    wins: Number(r.wins ?? 0),
    losses: Number(r.losses ?? 0),
    win_rate: String(r.win_rate ?? "0.0000"),
    total_settled_stake_usd: decimalOr(r.total_settled_stake_usd),
    prize_amount_usd: decimalOr(r.prize_amount_usd),
    prize_status: String(r.prize_status) as PlayPrizeStatus,
    payment_reference: r.payment_reference ? String(r.payment_reference) : null,
    admin_note: r.admin_note ? String(r.admin_note) : null,
    frozen_at: String(r.frozen_at),
    verified_at: r.verified_at ? String(r.verified_at) : null,
    paid_at: r.paid_at ? String(r.paid_at) : null,
  };
}

/** Canonical 2-dp decimal string for a NUMERIC, or "0.00" when absent. */
function decimalOr(v: unknown): string {
  const cents = decimalToCents(v);
  return cents === null ? "0.00" : centsToDecimal(cents);
}

function windowState(contest: {
  starts_at: string;
  ends_at: string;
}): PlayContestWindowState {
  const now = Date.now();
  if (now < msOf(contest.starts_at)) return "not_started";
  if (now >= msOf(contest.ends_at)) return "ended";
  return "live";
}

/** The prize a rank carries. Ranks outside the podium carry none. */
function prizeForRank(contest: PlayContest, rank: number): string {
  if (rank === 1) return contest.first_prize_usd;
  if (rank === 2) return contest.second_prize_usd;
  if (rank === 3) return contest.third_prize_usd;
  return "0.00";
}

/** display_name / avatar_url for a set of wallets, best effort. */
async function identityFor(
  wallets: string[]
): Promise<Map<string, { display_name: string | null; avatar_url: string | null }>> {
  const out = new Map<string, { display_name: string | null; avatar_url: string | null }>();
  if (wallets.length === 0) return out;
  const supa = supabaseServer();
  // Best effort: a profile read failure must never break a ranking or a
  // frozen snapshot — rows fall back to the wallet the UI already renders.
  const { data } = await supa
    .from("profiles")
    .select("wallet_address,display_name,avatar_url")
    .in("wallet_address", wallets);
  for (const p of data || []) {
    out.set(String((p as any).wallet_address), {
      display_name: (p as any).display_name ?? null,
      avatar_url: (p as any).avatar_url ?? null,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Period ranking — the single trusted implementation                         */
/* -------------------------------------------------------------------------- */

type RankedPlayer = Omit<PlayContestRankingRow, "rank" | "username" | "avatar_url">;

/**
 * The full ordered ranking for a contest window. Reused verbatim by the
 * live preview and by the freeze, so a frozen snapshot can never disagree
 * with the preview that produced it.
 *
 * WINDOW
 * ------
 * Half-open [starts_at, ends_at). A settlement landing exactly on ends_at
 * belongs to the next period, so two adjacent contests can never both
 * claim the same result.
 *
 * ELIGIBILITY
 * -----------
 *   * settled rows only (status <> 'open'), enforced at the query AND in
 *     the loop — an open row carries null P&L and must never create a pick
 *     or add its stake, which is exactly the unrealized value this metric
 *     exists to exclude;
 *   * settled_at inside the window;
 *   * a player is ranked once they hold at least one WON or LOST group.
 *     Refund-only players have a realized P&L of exactly zero and no
 *     competitive result, so they are not ranked.
 *
 * ORDER (total, deterministic)
 *   1. realized P&L desc  2. wins desc  3. settled picks desc
 *   4. wallet_address asc — unique, so two identical calls cannot disagree.
 */
export async function rankPlayContestPeriod(args: {
  startsAt: string;
  endsAt: string;
}): Promise<{ ranked: RankedPlayer[]; truncated: boolean }> {
  const supa = supabaseServer();

  const { data: tradeRows, error } = await supa
    .from("play_trades")
    .select(RANKING_COLS)
    .neq("status", "open")
    .gte("settled_at", args.startsAt)
    .lt("settled_at", args.endsAt)
    .order("settled_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PLAY_CONTEST_MAX_TRADES);

  if (error) throw toEngineError(error);

  const trades = ((tradeRows as any[]) || []).filter(Boolean);
  const truncated = trades.length >= PLAY_CONTEST_MAX_TRADES;
  if (trades.length === 0) return { ranked: [], truncated: false };

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

  const ranked: RankedPlayer[] = [];

  for (const [accountId, a] of Array.from(byAccount.entries())) {
    const wallet = walletByAccount.get(accountId);
    if (!wallet) continue; // orphan account row — never rank an unknown player

    let wins = 0;
    let losses = 0;
    for (const counts of Array.from(a.groups.values())) {
      // Same precedence as the profile: won > lost > refunded. A refunded
      // group is a settled pick but never a win or a loss.
      const s = groupStatus(counts);
      if (s === "won") wins += 1;
      else if (s === "lost") losses += 1;
    }

    if (wins + losses === 0) continue;

    ranked.push({
      wallet_address: wallet,
      realized_pnl_usd: centsToDecimal(a.pnlCents),
      settled_picks: a.groups.size,
      wins,
      losses,
      win_rate: ratioToDecimal(wins, wins + losses),
      total_settled_stake_usd: centsToDecimal(a.stakeCents),
    });
  }

  const pnlCentsOf = new Map(
    ranked.map((r) => [r.wallet_address, decimalToCents(r.realized_pnl_usd) ?? 0])
  );
  ranked.sort((x, y) => {
    const px = pnlCentsOf.get(x.wallet_address) ?? 0;
    const py = pnlCentsOf.get(y.wallet_address) ?? 0;
    if (px !== py) return py - px;
    if (x.wins !== y.wins) return y.wins - x.wins;
    if (x.settled_picks !== y.settled_picks) return y.settled_picks - x.settled_picks;
    return x.wallet_address < y.wallet_address ? -1 : 1;
  });

  return { ranked, truncated };
}

/* -------------------------------------------------------------------------- */
/*  Unresolved-market audit                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Markets that were PLAYED during the contest window and are still
 * undecided — i.e. they still hold open play_trades rows placed inside the
 * window.
 *
 * WHY THIS MATTERS EVEN THOUGH A LATE SETTLEMENT CANNOT ENTER THE WINDOW
 * ---------------------------------------------------------------------
 * play_settle_market stamps settled_at = now(), so a market resolved after
 * the period closes lands OUTSIDE [starts_at, ends_at) and can never alter
 * a frozen value. The risk is the opposite one: freezing while these are
 * pending silently disqualifies picks players made inside the contest and
 * were still waiting on. That is a fairness decision for a human, so the
 * freeze refuses by default and requires a deliberate override.
 *
 * Nothing here guesses an outcome or pre-settles anything.
 */
export async function getContestUnresolvedMarkets(args: {
  startsAt: string;
  endsAt: string;
}): Promise<PlayContestUnresolvedMarket[]> {
  const supa = supabaseServer();

  const { data, error } = await supa
    .from("play_trades")
    .select("market_address")
    .eq("status", "open")
    .gte("created_at", args.startsAt)
    .lt("created_at", args.endsAt)
    .limit(PLAY_CONTEST_MAX_OPEN_TRADES);

  if (error) throw toEngineError(error);

  const counts = new Map<string, number>();
  for (const row of (data as any[]) || []) {
    const addr = String(row?.market_address ?? "");
    if (!addr) continue;
    counts.set(addr, (counts.get(addr) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const addresses = Array.from(counts.keys());

  const [marketsRes, statesRes] = await Promise.all([
    supa
      .from("markets")
      .select("market_address,question,resolution_status")
      .in("market_address", addresses),
    supa
      .from("play_market_states")
      .select("market_address,status")
      .in("market_address", addresses),
  ]);

  const titles = new Map<string, string | null>();
  const resolution = new Map<string, string | null>();
  for (const m of (marketsRes.data as any[]) || []) {
    const addr = String(m.market_address);
    titles.set(addr, m.question ?? null);
    resolution.set(addr, m.resolution_status ?? null);
  }

  const playStatus = new Map<string, string | null>();
  for (const s of (statesRes.data as any[]) || []) {
    playStatus.set(String(s.market_address), s.status ?? null);
  }

  return addresses
    .map((addr) => ({
      market_address: addr,
      market_title: titles.get(addr) ?? null,
      open_trades: counts.get(addr) ?? 0,
      play_state_status: playStatus.get(addr) ?? null,
      resolution_status: resolution.get(addr) ?? null,
    }))
    .sort((a, b) => b.open_trades - a.open_trades);
}

/* -------------------------------------------------------------------------- */
/*  Contest reads                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The contest the admin is MANAGING: the one whose window contains now,
 * else the most recent non-terminal one.
 *
 * TERMINAL CONTESTS ARE NEVER RETURNED
 * ------------------------------------
 * paid / closed / cancelled are history and are filtered out of both
 * queries. That is the whole lifecycle contract: while a contest is
 * returned here the admin panel manages it and offers no create form, so
 * a contest that can never reach a terminal state strands the operator.
 * They are excluded, never deleted — every historical row stays readable
 * by id and stays in the database.
 *
 * Also advances the stored status through the PRE-FREEZE phases only
 * (draft → live → ended) so the summary card is honest without a cron. It
 * never touches under_review / verified / paid / closed / cancelled —
 * those are operator decisions and no clock may undo one.
 */
export async function getCurrentPlayContest(): Promise<PlayContest | null> {
  const supa = supabaseServer();
  const nowIso = new Date().toISOString();

  const { data: active, error: activeErr } = await supa
    .from("play_contests")
    .select(CONTEST_COLS)
    .not("status", "in", TERMINAL_STATUS_FILTER)
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .order("starts_at", { ascending: false })
    .limit(1);

  if (activeErr) throw toEngineError(activeErr);

  let row = ((active as any[]) || [])[0];

  if (!row) {
    const { data: latest, error: latestErr } = await supa
      .from("play_contests")
      .select(CONTEST_COLS)
      .not("status", "in", TERMINAL_STATUS_FILTER)
      .order("starts_at", { ascending: false })
      .limit(1);
    if (latestErr) throw toEngineError(latestErr);
    row = ((latest as any[]) || [])[0];
  }

  if (!row) return null;

  const contest = rowToContest(row);
  return syncWindowStatus(contest);
}

export async function getPlayContestById(id: string): Promise<PlayContest | null> {
  const supa = supabaseServer();
  const { data, error } = await supa
    .from("play_contests")
    .select(CONTEST_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw toEngineError(error);
  if (!data) return null;
  return syncWindowStatus(rowToContest(data));
}

/** draft → live → ended, from the clock. Never rewinds a human decision. */
async function syncWindowStatus(contest: PlayContest): Promise<PlayContest> {
  if (!["draft", "live", "ended"].includes(contest.status)) return contest;

  const state = windowState(contest);
  const next: PlayContestStatus =
    state === "not_started" ? "draft" : state === "live" ? "live" : "ended";
  if (next === contest.status) return contest;

  const supa = supabaseServer();
  const { data, error } = await supa
    .from("play_contests")
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq("id", contest.id)
    // Guard: only advance a contest still in a pre-freeze phase, so a
    // freeze landing concurrently can never be reverted by this clock.
    .in("status", ["draft", "live", "ended"])
    .select(CONTEST_COLS)
    .maybeSingle();

  if (error) throw toEngineError(error);
  return data ? rowToContest(data) : contest;
}

/** Frozen results for a contest, ordered by rank, with identity attached. */
export async function listPlayContestResults(
  contestId: string
): Promise<PlayContestResult[]> {
  const supa = supabaseServer();
  const { data, error } = await supa
    .from("play_contest_results")
    .select(RESULT_COLS)
    .eq("contest_id", contestId)
    .order("rank", { ascending: true });

  if (error) throw toEngineError(error);

  const rows = ((data as any[]) || []).map(rowToResult);
  if (rows.length === 0) return rows;

  const ids = await identityFor(rows.map((r) => r.wallet_address));
  return rows.map((r) => {
    const id = ids.get(r.wallet_address);
    return {
      ...r,
      username: id?.display_name ?? null,
      avatar_url: id?.avatar_url ?? null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Exit policy — one evaluation, shared by the preview and the actions        */
/* -------------------------------------------------------------------------- */

type ExitInputs = {
  contest: PlayContest;
  windowState: PlayContestWindowState;
  eligiblePlayers: number;
  unresolvedMarkets: number;
  truncated: boolean;
  /** Frozen rows actually on disk, when the caller has counted them. */
  frozenRows?: number;
};

type ExitVerdict = { ok: boolean; reason: string | null };

/**
 * May this contest be CLOSED without winners?
 *
 * A close is the exit for a contest that ran normally and produced nothing
 * payable. It must never become a shortcut past a real ranking, so it is
 * refused whenever a ranking exists, could still exist, or already has.
 *
 * Deliberately no override (unlike freeze): when eligible players exist,
 * the correct action is Freeze, and offering a way around that would let
 * an operator discard real winners with one click.
 */
function evaluateClose(input: ExitInputs): ExitVerdict {
  const { contest } = input;

  if (contest.status === "closed") {
    return { ok: false, reason: "This contest is already closed." };
  }
  if (PLAY_CONTEST_TERMINAL_STATUSES.includes(contest.status)) {
    return { ok: false, reason: `This contest is already ${contest.status}.` };
  }
  if (contest.status !== "ended") {
    return {
      ok: false,
      reason:
        input.windowState === "ended"
          ? `Only an ended contest can be closed; this one is ${contest.status}.`
          : "This contest has not ended yet.",
    };
  }
  if (input.windowState !== "ended") {
    return { ok: false, reason: "This contest has not ended yet." };
  }
  if (contest.frozen_at || (input.frozenRows ?? 0) > 0) {
    return {
      ok: false,
      reason: "Results are already frozen. Verify and record payment instead.",
    };
  }
  if (input.truncated) {
    return {
      ok: false,
      reason:
        "The settled-trade scan hit its ceiling, so an empty ranking cannot be proven.",
    };
  }
  if (input.unresolvedMarkets > 0) {
    return {
      ok: false,
      reason: `${input.unresolvedMarkets} market(s) with contest-period Play activity are still unresolved; those positions could still become eligible.`,
    };
  }
  if (input.eligiblePlayers > 0) {
    return {
      ok: false,
      reason: `${input.eligiblePlayers} eligible player(s) — freeze the results instead of closing.`,
    };
  }
  return { ok: true, reason: null };
}

/** May this contest be FROZEN right now, ignoring the explicit overrides? */
function evaluateFreeze(input: ExitInputs): ExitVerdict {
  const { contest } = input;

  if (contest.frozen_at) {
    return { ok: false, reason: "Results are already frozen." };
  }
  if (PLAY_CONTEST_TERMINAL_STATUSES.includes(contest.status)) {
    return { ok: false, reason: `This contest is ${contest.status}.` };
  }
  if (input.truncated) {
    return {
      ok: false,
      reason: "The settled-trade scan hit its ceiling, so the ranking is partial.",
    };
  }
  if (input.eligiblePlayers === 0) {
    return {
      ok: false,
      reason:
        "No eligible settled players — there is no ranking to snapshot. Close the contest instead.",
    };
  }
  // A live window and unresolved markets are BLOCKS, not impossibilities:
  // both have a deliberate override, so freeze stays offered here.
  return { ok: true, reason: null };
}

/* -------------------------------------------------------------------------- */
/*  Live preview                                                               */
/* -------------------------------------------------------------------------- */

/**
 * LIVE PREVIEW. Recalculated from current authoritative Play data on every
 * call, may still change, and is never stored as a winner. The freeze is
 * the only thing that turns a ranking into a result.
 */
export async function getPlayContestPreview(
  contest: PlayContest,
  opts?: { limit?: number }
): Promise<PlayContestPreview> {
  const limit = Math.min(
    Math.max(Math.floor(Number(opts?.limit) || PLAY_CONTEST_PREVIEW_LIMIT), 1),
    PLAY_CONTEST_PREVIEW_LIMIT
  );

  const generatedAt = new Date().toISOString();
  const state = windowState(contest);

  const [{ ranked, truncated }, unresolved] = await Promise.all([
    rankPlayContestPeriod({
      startsAt: contest.starts_at,
      endsAt: contest.ends_at,
    }),
    getContestUnresolvedMarkets({
      startsAt: contest.starts_at,
      endsAt: contest.ends_at,
    }),
  ]);

  const visible = ranked.slice(0, limit);
  const ids = await identityFor(visible.map((r) => r.wallet_address));

  const rows: PlayContestRankingRow[] = visible.map((r, i) => {
    const id = ids.get(r.wallet_address);
    return {
      ...r,
      rank: i + 1,
      username: id?.display_name ?? null,
      avatar_url: id?.avatar_url ?? null,
    };
  });

  const warnings: string[] = [];
  if (state === "not_started") {
    warnings.push("This contest has not started. No result can be eligible yet.");
  }
  if (state === "live") {
    warnings.push("This contest is still live. The ranking will keep changing.");
  }
  if (unresolved.length > 0) {
    warnings.push(
      `${unresolved.length} market(s) with contest-period Play activity are still unresolved.`
    );
  }
  if (ranked.length === 0) {
    warnings.push(
      state === "ended"
        ? "This contest has no eligible settled players. Close it to create the next contest."
        : "No eligible settled Play results in this period yet."
    );
  }
  if (truncated) {
    warnings.push(
      "The settled-trade scan hit its ceiling; totals may be partial. Do not freeze."
    );
  }

  const exitInputs: ExitInputs = {
    contest,
    windowState: state,
    eligiblePlayers: ranked.length,
    unresolvedMarkets: unresolved.length,
    truncated,
  };
  const freezeVerdict = evaluateFreeze(exitInputs);
  const closeVerdict = evaluateClose(exitInputs);

  return {
    contest_id: contest.id,
    starts_at: contest.starts_at,
    ends_at: contest.ends_at,
    window_state: state,
    rows,
    total_players: ranked.length,
    truncated,
    generated_at: generatedAt,
    warnings,
    unresolved_markets: unresolved,
    can_freeze: freezeVerdict.ok,
    freeze_blocked_reason: freezeVerdict.reason,
    can_close: closeVerdict.ok,
    close_blocked_reason: closeVerdict.reason,
  };
}

/* -------------------------------------------------------------------------- */
/*  Freeze                                                                     */
/* -------------------------------------------------------------------------- */

export type FreezeOutcome = {
  contest: PlayContest;
  results: PlayContestResult[];
  /** True when THIS call wrote the snapshot; false when it already existed. */
  froze: boolean;
  /** Unresolved markets at the moment of the freeze, for the audit trail. */
  unresolved_markets: PlayContestUnresolvedMarket[];
};

/**
 * Freeze the ranking into an immutable snapshot.
 *
 * PRECONDITIONS
 *   * the contest window must have ended, unless `overrideNotEnded`;
 *   * no market with contest-period Play activity may still be unresolved,
 *     unless `overrideUnresolved`;
 *   * a truncated scan is refused outright — a partial ranking must never
 *     become a payable result, and no override exists for it.
 *
 * IDEMPOTENCY
 * Once frozen_at is set, this returns the EXISTING rows untouched and never
 * recalculates. A concurrent second freeze loses the unique index on
 * (contest_id, rank) / (contest_id, wallet_address) and is reported as a
 * no-op rather than a duplicate winner.
 *
 * Settlements landing after this call change the live preview and the
 * all-time leaderboard. They change nothing here.
 */
export async function freezePlayContest(args: {
  contest: PlayContest;
  adminWallet: string;
  overrideUnresolved?: boolean;
  overrideNotEnded?: boolean;
}): Promise<FreezeOutcome> {
  const supa = supabaseServer();
  const { contest, adminWallet } = args;

  // Already frozen: return the stored snapshot verbatim. No recalculation.
  if (contest.frozen_at) {
    return {
      contest,
      results: await listPlayContestResults(contest.id),
      froze: false,
      unresolved_markets: [],
    };
  }

  const state = windowState(contest);
  if (state !== "ended" && !args.overrideNotEnded) {
    throw new PlayEngineError(
      state === "not_started"
        ? "This contest has not started. Nothing can be frozen yet."
        : "This contest is still live. Freeze after it ends, or pass the explicit override.",
      409
    );
  }

  const unresolved = await getContestUnresolvedMarkets({
    startsAt: contest.starts_at,
    endsAt: contest.ends_at,
  });

  if (unresolved.length > 0 && !args.overrideUnresolved) {
    throw new PlayEngineError(
      `Blocked: ${unresolved.length} market(s) with contest-period Play activity are still unresolved. ` +
        "Resolve them, or freeze again with the explicit override.",
      409
    );
  }

  const { ranked, truncated } = await rankPlayContestPeriod({
    startsAt: contest.starts_at,
    endsAt: contest.ends_at,
  });

  if (truncated) {
    throw new PlayEngineError(
      "Refusing to freeze: the settled-trade scan hit its ceiling, so the ranking is partial.",
      409
    );
  }

  if (ranked.length === 0) {
    throw new PlayEngineError(
      "Refusing to freeze: no eligible settled Play results in this period.",
      409
    );
  }

  const frozenAt = new Date().toISOString();
  const winners = ranked.slice(0, PLAY_CONTEST_FROZEN_RANKS);

  const payload = winners.map((r, i) => ({
    contest_id: contest.id,
    rank: i + 1,
    wallet_address: r.wallet_address,
    realized_pnl_usd: r.realized_pnl_usd,
    settled_picks: r.settled_picks,
    wins: r.wins,
    losses: r.losses,
    win_rate: r.win_rate,
    total_settled_stake_usd: r.total_settled_stake_usd,
    prize_amount_usd: prizeForRank(contest, i + 1),
    prize_status: "pending" as PlayPrizeStatus,
    frozen_at: frozenAt,
    created_at: frozenAt,
    updated_at: frozenAt,
  }));

  const { error: insertErr } = await supa
    .from("play_contest_results")
    .insert(payload);

  if (insertErr) {
    // A racing freeze already wrote this snapshot. Report its rows; never
    // write a second set and never overwrite the first.
    if ((insertErr as any)?.code === PG_UNIQUE_VIOLATION) {
      const existing = await getPlayContestById(contest.id);
      return {
        contest: existing ?? contest,
        results: await listPlayContestResults(contest.id),
        froze: false,
        unresolved_markets: unresolved,
      };
    }
    throw toEngineError(insertErr);
  }

  // Only the first writer stamps the contest: the `frozen_at is null`
  // guard makes this update the transaction boundary for the whole freeze.
  const { data: updated, error: updateErr } = await supa
    .from("play_contests")
    .update({
      status: "under_review",
      frozen_at: frozenAt,
      frozen_by: adminWallet,
      updated_at: frozenAt,
    })
    .eq("id", contest.id)
    .is("frozen_at", null)
    .select(CONTEST_COLS)
    .maybeSingle();

  if (updateErr) throw toEngineError(updateErr);

  const finalContest = updated
    ? rowToContest(updated)
    : (await getPlayContestById(contest.id)) ?? contest;

  return {
    contest: finalContest,
    results: await listPlayContestResults(contest.id),
    froze: true,
    unresolved_markets: unresolved,
  };
}

/* -------------------------------------------------------------------------- */
/*  Close — the exit for a contest with nothing to freeze                      */
/* -------------------------------------------------------------------------- */

export type CloseOutcome = {
  contest: PlayContest;
  /** True when THIS call closed it; false when it was already closed. */
  closed: boolean;
};

/**
 * Close a contest that ran normally and produced no payable ranking.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ended` is not a resting state — while a contest sits there it is still
 * returned as the current manageable contest, so the create form never
 * appears and the next contest can never be launched. A period with zero
 * eligible settled players cannot be frozen (there is no ranking), cannot
 * honestly be `paid` (nothing was won) and must not be called `cancelled`
 * (it ran exactly as intended). `closed` is that missing resting state.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It is never a shortcut past a real ranking. It re-derives the ranking
 * server-side and refuses if ANY eligible player exists — with no
 * override, because the correct action there is Freeze and a one-click
 * bypass would let an operator discard real winners. It also refuses
 * while a contest-period market is still unresolved, since those
 * positions could still become eligible.
 *
 * It creates no result row, moves no money, and touches no play_trades.
 *
 * IDEMPOTENT. A repeat on an already-closed contest returns it unchanged.
 */
export async function closePlayContest(args: {
  contest: PlayContest;
  adminWallet: string;
  note?: string | null;
}): Promise<CloseOutcome> {
  const supa = supabaseServer();
  const { contest } = args;

  // Idempotent: closing a closed contest is a no-op, not an error.
  if (contest.status === "closed") {
    return { contest, closed: false };
  }

  // Frozen rows are checked on disk, not just via contest.frozen_at, so a
  // snapshot can never be orphaned behind a closed contest.
  const { count: frozenRows, error: countErr } = await supa
    .from("play_contest_results")
    .select("id", { count: "exact", head: true })
    .eq("contest_id", contest.id);

  if (countErr) throw toEngineError(countErr);

  const [{ ranked, truncated }, unresolved] = await Promise.all([
    rankPlayContestPeriod({
      startsAt: contest.starts_at,
      endsAt: contest.ends_at,
    }),
    getContestUnresolvedMarkets({
      startsAt: contest.starts_at,
      endsAt: contest.ends_at,
    }),
  ]);

  const verdict = evaluateClose({
    contest,
    windowState: windowState(contest),
    eligiblePlayers: ranked.length,
    unresolvedMarkets: unresolved.length,
    truncated,
    frozenRows: frozenRows ?? 0,
  });

  if (!verdict.ok) {
    throw new PlayEngineError(verdict.reason ?? "This contest cannot be closed.", 409);
  }

  const now = new Date().toISOString();
  const note = args.note ? String(args.note).trim().slice(0, 2000) : "";

  const patch: Record<string, unknown> = { status: "closed", updated_at: now };
  if (note) {
    // No closed_by column exists and the spec asks for no new schema, so
    // the operator's note carries the human context. The acting wallet is
    // in the route's server log.
    patch.notes = contest.notes ? `${contest.notes}\n${note}` : note;
  }

  const { data: updated, error } = await supa
    .from("play_contests")
    .update(patch)
    .eq("id", contest.id)
    // Guard: a freeze landing concurrently wins. Only a contest still
    // ended-and-unfrozen may be closed, re-checked at write time.
    .eq("status", "ended")
    .is("frozen_at", null)
    .select(CONTEST_COLS)
    .maybeSingle();

  if (error) throw toEngineError(error);

  if (!updated) {
    // Something changed under us — report the current truth, never a
    // success the database did not agree to.
    const fresh = await getPlayContestById(contest.id);
    if (fresh?.status === "closed") return { contest: fresh, closed: false };
    throw new PlayEngineError(
      "This contest changed while it was being closed. Refresh the preview and retry.",
      409
    );
  }

  return { contest: rowToContest(updated), closed: true };
}

/* -------------------------------------------------------------------------- */
/*  Verify                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Confirm that the frozen snapshot has been reviewed.
 *
 * Recalculates nothing. Mutates no rank, no P&L and no prize amount. It
 * records WHO reviewed WHAT and WHEN, and moves pending prize rows to
 * 'verified' so the payment tracker can tell a reviewed row from a raw one.
 * It sends nothing.
 */
export async function verifyPlayContest(args: {
  contest: PlayContest;
  adminWallet: string;
}): Promise<{ contest: PlayContest; results: PlayContestResult[]; verified: boolean }> {
  const supa = supabaseServer();
  const { contest, adminWallet } = args;

  if (!contest.frozen_at) {
    throw new PlayEngineError("Freeze the results before verifying them.", 409);
  }

  if (contest.verified_at) {
    return {
      contest,
      results: await listPlayContestResults(contest.id),
      verified: false,
    };
  }

  const verifiedAt = new Date().toISOString();

  // A contest whose prizes were all recorded paid before verification is
  // already 'paid'. Verifying it records WHO reviewed it without rewinding
  // that — a status is never walked backwards by a later confirmation.
  const nextStatus: PlayContestStatus =
    contest.status === "paid" ? "paid" : "verified";

  const { data: updated, error } = await supa
    .from("play_contests")
    .update({
      status: nextStatus,
      verified_at: verifiedAt,
      verified_by: adminWallet,
      updated_at: verifiedAt,
    })
    .eq("id", contest.id)
    .is("verified_at", null)
    .select(CONTEST_COLS)
    .maybeSingle();

  if (error) throw toEngineError(error);

  // Stamp the frozen rows the same way — pending only. A row an operator
  // already moved to paid / disputed / cancelled keeps its state.
  const { error: rowsErr } = await supa
    .from("play_contest_results")
    .update({ prize_status: "verified", verified_at: verifiedAt, updated_at: verifiedAt })
    .eq("contest_id", contest.id)
    .eq("prize_status", "pending");

  if (rowsErr) throw toEngineError(rowsErr);

  return {
    contest: updated ? rowToContest(updated) : contest,
    results: await listPlayContestResults(contest.id),
    verified: !!updated,
  };
}

/* -------------------------------------------------------------------------- */
/*  Payment tracking                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Update the PAYMENT RECORD of one frozen winner.
 *
 * Touches prize_status, payment_reference, admin_note and paid_at, and
 * nothing else. Rank, realized P&L, picks, wins, losses, win rate, settled
 * stake and prize amount are frozen values and are never writable here.
 *
 * Marking a row paid records that a payment happened somewhere else. It
 * moves no money, calls no chain and creates no Play balance.
 */
export async function updatePlayContestResult(args: {
  contestId: string;
  resultId: string;
  prizeStatus?: PlayPrizeStatus;
  paymentReference?: string | null;
  adminNote?: string | null;
}): Promise<{ result: PlayContestResult; contest: PlayContest | null }> {
  const supa = supabaseServer();
  const now = new Date().toISOString();

  const { data: existing, error: readErr } = await supa
    .from("play_contest_results")
    .select(RESULT_COLS)
    .eq("id", args.resultId)
    .eq("contest_id", args.contestId)
    .maybeSingle();

  if (readErr) throw toEngineError(readErr);
  if (!existing) throw new PlayEngineError("Frozen result not found.", 404);

  const current = rowToResult(existing);
  const nextStatus = args.prizeStatus ?? current.prize_status;

  const patch: Record<string, unknown> = { updated_at: now };
  if (args.prizeStatus) patch.prize_status = args.prizeStatus;
  if (args.paymentReference !== undefined) {
    patch.payment_reference = args.paymentReference || null;
  }
  if (args.adminNote !== undefined) patch.admin_note = args.adminNote || null;

  // paid_at is the timestamp of the RECORD, kept in step with the status.
  if (nextStatus === "paid") {
    patch.paid_at = current.paid_at ?? now;
  } else if (args.prizeStatus && current.prize_status === "paid") {
    patch.paid_at = null;
  }

  const { data: updated, error } = await supa
    .from("play_contest_results")
    .update(patch)
    .eq("id", args.resultId)
    .eq("contest_id", args.contestId)
    .select(RESULT_COLS)
    .maybeSingle();

  if (error) throw toEngineError(error);
  if (!updated) throw new PlayEngineError("Frozen result not found.", 404);

  const contest = await maybeCompleteContest(args.contestId);

  return { result: rowToResult(updated), contest };
}

/**
 * Move a verified contest to 'paid' once every prize-bearing frozen row is
 * paid. A disputed or cancelled prize row blocks the transition — a contest
 * is never reported complete while a winner is still contested.
 */
async function maybeCompleteContest(contestId: string): Promise<PlayContest | null> {
  const supa = supabaseServer();

  const contest = await getPlayContestById(contestId);
  if (!contest) return null;
  if (contest.status !== "verified" && contest.status !== "under_review") return contest;

  const { data, error } = await supa
    .from("play_contest_results")
    .select("prize_amount_usd,prize_status")
    .eq("contest_id", contestId);

  if (error) throw toEngineError(error);

  const rows = ((data as any[]) || []).filter(
    (r) => (decimalToCents(r.prize_amount_usd) ?? 0) > 0
  );
  if (rows.length === 0) return contest;

  const anyBlocked = rows.some(
    (r) => r.prize_status === "disputed" || r.prize_status === "cancelled"
  );
  const allPaid = rows.every((r) => r.prize_status === "paid");
  if (anyBlocked || !allPaid) return contest;

  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await supa
    .from("play_contests")
    .update({ status: "paid", updated_at: now })
    .eq("id", contestId)
    .in("status", ["under_review", "verified"])
    .select(CONTEST_COLS)
    .maybeSingle();

  if (updateErr) throw toEngineError(updateErr);
  return updated ? rowToContest(updated) : contest;
}

/* -------------------------------------------------------------------------- */
/*  Winner audit                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The positions that produced ONE winner's contest-period result.
 *
 * Grouped exactly as the Play profile groups: key (market_address,
 * outcome_index), so three buys on the same outcome are one position and
 * YES/NO on the same market are two. The totals here are recomputed from
 * the same rows the ranking used, so an operator can reconcile them
 * against the frozen row line by line and see where a disputed number
 * came from.
 *
 * PRIVACY: no play_accounts UUID, no client_trade_id, no ledger row, no
 * season attribution, no session data and no balance.
 */
export async function getPlayContestWinnerAudit(args: {
  contest: PlayContest;
  wallet: string;
}): Promise<PlayContestWinnerAudit> {
  const wallet = normalizeWallet(args.wallet);
  const supa = supabaseServer();

  const [identityRes, accountRes] = await Promise.all([
    supa
      .from("profiles")
      .select("wallet_address,display_name,avatar_url")
      .eq("wallet_address", wallet)
      .maybeSingle(),
    supa
      .from("play_accounts")
      .select("id")
      .eq("wallet_address", wallet)
      .maybeSingle(),
  ]);

  if (accountRes.error) throw toEngineError(accountRes.error);

  const identity = (identityRes.data as any) ?? null;

  const base: PlayContestWinnerAudit = {
    wallet_address: wallet,
    username: identity?.display_name ?? null,
    avatar_url: identity?.avatar_url ?? null,
    starts_at: args.contest.starts_at,
    ends_at: args.contest.ends_at,
    totals: {
      realized_pnl_usd: "0.00",
      settled_picks: 0,
      wins: 0,
      losses: 0,
      win_rate: "0.0000",
      total_settled_stake_usd: "0.00",
    },
    positions: [],
    truncated: false,
  };

  const accountId = (accountRes.data as any)?.id;
  if (!accountId) return base;

  const { data: tradeRows, error } = await supa
    .from("play_trades")
    .select(
      "market_address,outcome_index,outcome_name,stake_usd,status," +
        "payout_usd,realized_pnl_usd,settled_at"
    )
    .eq("account_id", accountId)
    .neq("status", "open")
    .gte("settled_at", args.contest.starts_at)
    .lt("settled_at", args.contest.ends_at)
    .order("settled_at", { ascending: false })
    .limit(PLAY_CONTEST_AUDIT_MAX_TRADES);

  if (error) throw toEngineError(error);

  const trades = ((tradeRows as any[]) || []).filter(Boolean);
  if (trades.length === 0) return base;

  type Group = {
    market_address: string;
    outcome_index: number;
    outcome_name: string | null;
    stakeCents: number;
    payoutCents: number;
    pnlCents: number;
    tradeCount: number;
    counts: Record<PlayTradeStatus, number>;
    settledAt: string;
  };

  const groups = new Map<string, Group>();
  let totalPnlCents = 0;
  let totalStakeCents = 0;

  for (const t of trades) {
    const addr = String(t.market_address ?? "");
    const idx = Number(t.outcome_index);
    if (!addr || !Number.isInteger(idx) || idx < 0) continue;

    const status = String(t.status || "") as PlayTradeStatus;
    if (status !== "won" && status !== "lost" && status !== "refunded") continue;

    const key = `${addr}|${idx}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        market_address: addr,
        outcome_index: idx,
        outcome_name: t.outcome_name != null ? String(t.outcome_name) : null,
        stakeCents: 0,
        payoutCents: 0,
        pnlCents: 0,
        tradeCount: 0,
        counts: { open: 0, won: 0, lost: 0, refunded: 0 },
        settledAt: String(t.settled_at),
      };
      groups.set(key, g);
    }

    if (g.outcome_name == null && t.outcome_name != null) {
      g.outcome_name = String(t.outcome_name);
    }

    const stake = decimalToCents(t.stake_usd) ?? 0;
    const pnl = decimalToCents(t.realized_pnl_usd) ?? 0;
    g.stakeCents += stake;
    g.payoutCents += decimalToCents(t.payout_usd) ?? 0;
    g.pnlCents += pnl;
    g.tradeCount += 1;
    g.counts[status] += 1;

    totalStakeCents += stake;
    totalPnlCents += pnl;

    const at = String(t.settled_at);
    if (msOf(at) > msOf(g.settledAt)) g.settledAt = at;
  }

  // Market titles, outcome names and the AUTHORITATIVE winning outcome.
  const addresses = Array.from(
    new Set(Array.from(groups.values()).map((g) => g.market_address))
  );
  const titles = new Map<string, string | null>();
  const outcomeNames = new Map<string, string[]>();
  const winningOutcome = new Map<string, number | null>();
  const marketTypes = new Map<string, number | null>();

  if (addresses.length > 0) {
    const { data: marketRows } = await supa
      .from("markets")
      .select("market_address,question,outcome_names,winning_outcome,market_type")
      .in("market_address", addresses);
    for (const m of (marketRows as any[]) || []) {
      const addr = String(m.market_address);
      titles.set(addr, m.question ?? null);
      if (Array.isArray(m.outcome_names)) {
        outcomeNames.set(addr, m.outcome_names.map((n: unknown) => String(n)));
      }
      winningOutcome.set(
        addr,
        Number.isFinite(Number(m.winning_outcome)) ? Number(m.winning_outcome) : null
      );
      marketTypes.set(
        addr,
        Number.isFinite(Number(m.market_type)) ? Number(m.market_type) : null
      );
    }
  }

  function labelFor(addr: string, idx: number | null): string | null {
    if (idx == null) return null;
    const names = outcomeNames.get(addr);
    if (names && names[idx] != null) return names[idx];
    // Binary markets carry no outcome_names array.
    if ((marketTypes.get(addr) ?? 0) === 0) return idx === 0 ? "YES" : idx === 1 ? "NO" : null;
    return null;
  }

  let wins = 0;
  let losses = 0;

  const positions: PlayContestAuditPosition[] = Array.from(groups.values())
    .map((g) => {
      const status = groupStatus(g.counts);
      if (status === "won") wins += 1;
      else if (status === "lost") losses += 1;
      const wo = winningOutcome.get(g.market_address) ?? null;
      return {
        market_address: g.market_address,
        market_title: titles.get(g.market_address) ?? null,
        outcome_index: g.outcome_index,
        outcome_name: g.outcome_name ?? labelFor(g.market_address, g.outcome_index),
        total_stake_usd: centsToDecimal(g.stakeCents),
        payout_usd: centsToDecimal(g.payoutCents),
        realized_pnl_usd: centsToDecimal(g.pnlCents),
        status,
        trade_count: g.tradeCount,
        settled_at: g.settledAt,
        winning_outcome: wo,
        winning_outcome_name: labelFor(g.market_address, wo),
      };
    })
    .sort((a, b) => msOf(b.settled_at) - msOf(a.settled_at));

  return {
    ...base,
    totals: {
      realized_pnl_usd: centsToDecimal(totalPnlCents),
      settled_picks: positions.length,
      wins,
      losses,
      win_rate: ratioToDecimal(wins, wins + losses),
      total_settled_stake_usd: centsToDecimal(totalStakeCents),
    },
    positions,
    truncated: trades.length >= PLAY_CONTEST_AUDIT_MAX_TRADES,
  };
}

/* -------------------------------------------------------------------------- */
/*  Creation                                                                   */
/* -------------------------------------------------------------------------- */

export type CreateContestInput = {
  name: string;
  startsAt: string;
  endsAt: string;
  prizePoolUsd: string;
  firstPrizeUsd: string;
  secondPrizeUsd: string;
  thirdPrizeUsd: string;
  adminWallet: string;
  notes?: string | null;
};

/**
 * Create one manually configured contest period.
 *
 * Validation is server-side and total: the form cannot skip it, and the
 * database repeats every money rule as a CHECK constraint. No recurrence,
 * no scheduling, no automation — one period, created deliberately.
 */
export async function createPlayContest(
  input: CreateContestInput
): Promise<PlayContest> {
  const supa = supabaseServer();

  const name = String(input.name ?? "").trim();
  if (name.length < 1 || name.length > 120) {
    throw new PlayEngineError("Name must be between 1 and 120 characters.", 400);
  }

  const startsMs = msOf(input.startsAt);
  const endsMs = msOf(input.endsAt);
  if (!startsMs || !endsMs) {
    throw new PlayEngineError("Start and end must both be valid timestamps.", 400);
  }
  if (endsMs <= startsMs) {
    throw new PlayEngineError("End must be after start.", 400);
  }

  const pool = decimalToCents(input.prizePoolUsd);
  const first = decimalToCents(input.firstPrizeUsd);
  const second = decimalToCents(input.secondPrizeUsd);
  const third = decimalToCents(input.thirdPrizeUsd);

  if (pool === null || first === null || second === null || third === null) {
    throw new PlayEngineError("Prize amounts must be valid numbers.", 400);
  }
  if (pool < 0 || first < 0 || second < 0 || third < 0) {
    throw new PlayEngineError("Prize amounts cannot be negative.", 400);
  }
  if (first + second + third !== pool) {
    throw new PlayEngineError(
      `Prizes must sum to the pool: ${centsToDecimal(first)} + ${centsToDecimal(
        second
      )} + ${centsToDecimal(third)} = ${centsToDecimal(
        first + second + third
      )}, pool is ${centsToDecimal(pool)}.`,
      400
    );
  }

  // Both timestamps are stored and compared in UTC.
  const startsAt = new Date(startsMs).toISOString();
  const endsAt = new Date(endsMs).toISOString();

  // No overlapping contest period. `cancelled` is the ONE status excluded:
  // a cancelled contest never counted, so its instants are free again. A
  // `closed` or `paid` contest DID run — real Play results settled inside
  // its window and it is the historical record of them — so it still
  // blocks, and letting a second contest claim the same instants would let
  // two contests claim the same settled results.
  //
  // This never blocks the create-the-next-contest flow, because the next
  // contest is scheduled for a LATER window. The database repeats the rule
  // as an exclusion constraint; this check exists to return a usable
  // message instead of a raw constraint error.
  const { data: clash, error: clashErr } = await supa
    .from("play_contests")
    .select("id,name,status,starts_at,ends_at")
    .neq("status", "cancelled")
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt)
    .limit(1);

  if (clashErr) throw toEngineError(clashErr);
  if (((clash as any[]) || []).length > 0) {
    const c = (clash as any[])[0];
    throw new PlayEngineError(
      `Overlaps the ${c.status} contest "${c.name}" (${c.starts_at} → ${c.ends_at}). ` +
        "Pick a window that starts after it ends.",
      409
    );
  }

  const now = new Date().toISOString();
  const status: PlayContestStatus =
    endsMs <= Date.now() ? "ended" : startsMs <= Date.now() ? "live" : "draft";

  const { data, error } = await supa
    .from("play_contests")
    .insert({
      name,
      starts_at: startsAt,
      ends_at: endsAt,
      timezone: "UTC",
      status,
      prize_pool_usd: centsToDecimal(pool),
      first_prize_usd: centsToDecimal(first),
      second_prize_usd: centsToDecimal(second),
      third_prize_usd: centsToDecimal(third),
      created_by: input.adminWallet,
      notes: input.notes ? String(input.notes).slice(0, 2000) : null,
      created_at: now,
      updated_at: now,
    })
    .select(CONTEST_COLS)
    .maybeSingle();

  if (error) {
    if ((error as any)?.code === PG_UNIQUE_VIOLATION || (error as any)?.code === "23P01") {
      throw new PlayEngineError(
        "Overlaps an existing contest period. Cancel that contest first.",
        409
      );
    }
    throw toEngineError(error);
  }
  if (!data) throw new PlayEngineError("Contest was not created.", 500);

  return rowToContest(data);
}

/* -------------------------------------------------------------------------- */
/*  Cancel — the emergency exit, available before a freeze                     */
/* -------------------------------------------------------------------------- */

export type CancelOutcome = {
  contest: PlayContest;
  /** True when THIS call cancelled it; false when it was already cancelled. */
  cancelled: boolean;
};

/** Statuses a contest can be cancelled FROM. Everything else is refused. */
const CANCELLABLE_STATUSES: PlayContestStatus[] = ["draft", "live", "ended"];

/**
 * Disown a contest period before any ranking has been frozen.
 *
 * DIFFERENT FROM CLOSE, ON PURPOSE
 * --------------------------------
 * `closed` says "this ran and produced nothing payable" — history worth
 * keeping. `cancelled` says "this period does not count as a competition
 * at all", which is why it is the one status the overlap constraint
 * ignores: those instants become free to schedule again.
 *
 * Allowed from draft / live / ended only. Once results are frozen the
 * snapshot is the record a prize is paid against, so under_review,
 * verified and paid are refused outright — cancelling one would orphan a
 * frozen winner. `closed` is refused because it is already terminal.
 *
 * WHAT IT DOES NOT TOUCH
 * ----------------------
 * Not one play_trade, not one settlement, not one balance, not one
 * result row. Cancelling a LIVE contest discards the competition period
 * for prize purposes and nothing else: every trade a player made inside
 * it stays exactly as it was, still settles normally, and still counts on
 * the all-time leaderboard and on their profile.
 *
 * IDEMPOTENT. A repeat returns the contest unchanged.
 */
export async function cancelPlayContest(args: {
  contest: PlayContest;
  adminWallet: string;
  reason?: string | null;
}): Promise<CancelOutcome> {
  const supa = supabaseServer();
  const { contest } = args;

  if (contest.status === "cancelled") {
    return { contest, cancelled: false };
  }

  if (contest.frozen_at) {
    throw new PlayEngineError(
      "Results are already frozen. A frozen contest cannot be cancelled — its snapshot is the record prizes are paid against.",
      409
    );
  }

  if (!CANCELLABLE_STATUSES.includes(contest.status)) {
    throw new PlayEngineError(
      `A ${contest.status} contest cannot be cancelled.`,
      409
    );
  }

  const now = new Date().toISOString();
  const reason = args.reason ? String(args.reason).trim().slice(0, 2000) : "";

  const patch: Record<string, unknown> = { status: "cancelled", updated_at: now };
  if (reason) {
    patch.notes = contest.notes ? `${contest.notes}\n${reason}` : reason;
  }

  const { data: updated, error } = await supa
    .from("play_contests")
    .update(patch)
    .eq("id", contest.id)
    // Re-checked at write time: a freeze landing concurrently wins.
    .in("status", CANCELLABLE_STATUSES)
    .is("frozen_at", null)
    .select(CONTEST_COLS)
    .maybeSingle();

  if (error) throw toEngineError(error);

  if (!updated) {
    const fresh = await getPlayContestById(contest.id);
    if (fresh?.status === "cancelled") return { contest: fresh, cancelled: false };
    throw new PlayEngineError(
      "This contest changed while it was being cancelled. Refresh the preview and retry.",
      409
    );
  }

  return { contest: rowToContest(updated), cancelled: true };
}

/* ========================================================================== */
/*  PUBLIC PROJECTION                                                          */
/* ========================================================================== */
//
// Everything below is what an anonymous visitor to /leaderboard may see.
// It is a SEPARATE selector and a SEPARATE, strictly narrower row shape —
// never the admin one with fields removed at the edge, because that is the
// shape that leaks the first time somebody adds a column.
//
// NEVER CROSSES THIS LINE
// -----------------------
// created_by, frozen_by, verified_by, notes, timezone, prize_status,
// payment_reference, admin_note, paid_at, dispute notes, play_accounts
// UUIDs, client_trade_id, ledger rows, session data, balances.

/** A contest as the public page sees it. Exactly these fields, no more. */
export type PlayPublicContest = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  status: PlayContestStatus;
  prize_pool_usd: string;
  first_prize_usd: string;
  second_prize_usd: string;
  third_prize_usd: string;
  frozen_at: string | null;
  verified_at: string | null;
};

/** One ranked player as the public page sees them. */
export type PlayPublicRankingRow = {
  rank: number;
  wallet_address: string;
  username: string | null;
  avatar_url: string | null;
  realized_pnl_usd: string;
  wins: number;
  losses: number;
  settled_picks: number;
  win_rate: string;
};

export type PlayPublicRankingState = "preview" | "frozen" | "none";

export type PlayPublicContestView = {
  contest: PlayPublicContest | null;
  ranking: PlayPublicRankingRow[];
  /** The caller's own row, when a Play session is present and they rank. */
  viewer: PlayPublicRankingRow | null;
  meta: {
    generated_at: string;
    /** Eligible players BEFORE the display cap. */
    total_players: number;
    /** Contest-period markets still undecided. Always 0 once frozen. */
    unresolved_markets: number;
    /**
     * `preview` — recalculated now, may still change.
     * `frozen`  — the immutable snapshot, never recalculated.
     * `none`    — no contest is scheduled.
     */
    ranking_state: PlayPublicRankingState;
    truncated: boolean;
  };
};

/** Ranked players the public page receives. Matches the old All-Time cap. */
export const PLAY_PUBLIC_CONTEST_LIMIT = 100;

/**
 * Which contest the PUBLIC page shows, in priority order. Lower wins.
 *
 * A running competition outranks an upcoming one, which outranks results
 * still being settled up. `paid` sits last so it stays visible as the most
 * recent official result right up until a newer draft or live contest
 * exists to replace it — at which point the newer one simply outranks it.
 *
 * `closed` and `cancelled` are never shown: one produced nothing payable,
 * the other was disowned. Neither is a competition a visitor can enter or
 * a result they can read.
 */
const PUBLIC_CONTEST_PRIORITY: Record<PlayContestStatus, number> = {
  live: 1,
  draft: 2,
  ended: 3,
  under_review: 4,
  verified: 5,
  paid: 6,
  closed: Number.POSITIVE_INFINITY,
  cancelled: Number.POSITIVE_INFINITY,
};

/** How many candidate rows the public selector considers. */
const PUBLIC_CONTEST_SCAN = 20;

/**
 * The contest the public page shows.
 *
 * DELIBERATELY NOT getCurrentPlayContest
 * --------------------------------------
 * The admin selector answers "what still needs an action from me", so it
 * drops `paid` — correct there, wrong here, because a paid contest is
 * precisely the finished result a visitor should still be able to read.
 * The two questions are different, so they get two selectors rather than
 * one with a flag.
 *
 * Priority is computed on the EFFECTIVE status: a draft whose window has
 * already opened is treated as live even if no read has synced its stored
 * status yet, so the public page can never advertise "starts in…" for a
 * competition that is already running.
 */
export async function getPublicPlayContest(): Promise<PlayContest | null> {
  const supa = supabaseServer();

  const { data, error } = await supa
    .from("play_contests")
    .select(CONTEST_COLS)
    .not("status", "in", "(closed,cancelled)")
    .order("starts_at", { ascending: false })
    .limit(PUBLIC_CONTEST_SCAN);

  if (error) throw toEngineError(error);

  const rows = ((data as any[]) || []).map(rowToContest);
  if (rows.length === 0) return null;

  /** Stored status, corrected by the clock for the pre-freeze phases. */
  const effectiveStatus = (c: PlayContest): PlayContestStatus => {
    if (!["draft", "live", "ended"].includes(c.status)) return c.status;
    const w = windowState(c);
    return w === "not_started" ? "draft" : w === "live" ? "live" : "ended";
  };

  let best: PlayContest | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;

  for (const c of rows) {
    const p = PUBLIC_CONTEST_PRIORITY[effectiveStatus(c)] ?? Number.POSITIVE_INFINITY;
    if (p === Number.POSITIVE_INFINITY) continue;
    // Rows arrive newest-first, so a strict `<` keeps the newest of a tie.
    if (p < bestPriority) {
      best = c;
      bestPriority = p;
    }
  }

  if (!best) return null;

  // Persist the clock-derived status, so the public page and the admin
  // panel never disagree about whether a contest is live.
  return syncWindowStatus(best);
}

/** The admin contest shape, narrowed to the public one. */
function toPublicContest(c: PlayContest): PlayPublicContest {
  return {
    id: c.id,
    name: c.name,
    starts_at: c.starts_at,
    ends_at: c.ends_at,
    status: c.status,
    prize_pool_usd: c.prize_pool_usd,
    first_prize_usd: c.first_prize_usd,
    second_prize_usd: c.second_prize_usd,
    third_prize_usd: c.third_prize_usd,
    frozen_at: c.frozen_at,
    verified_at: c.verified_at,
  };
}

/**
 * The public contest view: the selected contest, its ranking, the caller's
 * own row, and the meta a visitor needs to know how final any of it is.
 *
 * RANKING SOURCE — decided by frozen_at, not by a status string
 * ------------------------------------------------------------
 * Frozen  → play_contest_results, read verbatim. Never recalculated, so a
 *           settlement landing after the freeze cannot move a published
 *           result. This is what `under_review`, `verified` and `paid`
 *           all read from.
 * Not yet → rankPlayContestPeriod, the SAME trusted helper the admin
 *           preview and the freeze use. The public page therefore cannot
 *           show a ranking that disagrees with the one the admin froze.
 *
 * `viewerWallet` is proven from the Play session cookie by the caller and
 * is never a request field, so a visitor can only ever ask about
 * themselves. The viewer row carries the same public stats as any other
 * row and never a balance.
 */
export async function getPublicPlayContestView(opts?: {
  limit?: number;
  viewerWallet?: string | null;
}): Promise<PlayPublicContestView> {
  const generatedAt = new Date().toISOString();
  const viewerWallet = opts?.viewerWallet ?? null;

  const limit = Math.min(
    Math.max(Math.floor(Number(opts?.limit) || PLAY_PUBLIC_CONTEST_LIMIT), 1),
    PLAY_PUBLIC_CONTEST_LIMIT
  );

  const empty: PlayPublicContestView = {
    contest: null,
    ranking: [],
    viewer: null,
    meta: {
      generated_at: generatedAt,
      total_players: 0,
      unresolved_markets: 0,
      ranking_state: "none",
      truncated: false,
    },
  };

  const contest = await getPublicPlayContest();
  if (!contest) return empty;

  const publicContest = toPublicContest(contest);

  /* ---- Frozen: the snapshot, verbatim ---------------------------------- */
  if (contest.frozen_at) {
    const frozen = await listPlayContestResults(contest.id);

    // Narrowed HERE, not at the route: prize_status, payment_reference,
    // admin_note, paid_at and verified_at never leave this function.
    const ranking: PlayPublicRankingRow[] = frozen.map((r) => ({
      rank: r.rank,
      wallet_address: r.wallet_address,
      username: r.username,
      avatar_url: r.avatar_url,
      realized_pnl_usd: r.realized_pnl_usd,
      wins: r.wins,
      losses: r.losses,
      settled_picks: r.settled_picks,
      win_rate: r.win_rate,
    }));

    return {
      contest: publicContest,
      ranking: ranking.slice(0, limit),
      viewer: viewerWallet
        ? ranking.find((r) => r.wallet_address === viewerWallet) ?? null
        : null,
      meta: {
        generated_at: generatedAt,
        // The snapshot stores a bounded number of ranks, so this is the
        // size of the OFFICIAL result, not of the field that played.
        total_players: ranking.length,
        // A frozen result cannot be moved by a late settlement, so an
        // unresolved market is no longer information a visitor can act on.
        unresolved_markets: 0,
        ranking_state: "frozen",
        truncated: false,
      },
    };
  }

  /* ---- Not frozen: the live period ranking ----------------------------- */
  const [{ ranked, truncated }, unresolved] = await Promise.all([
    rankPlayContestPeriod({
      startsAt: contest.starts_at,
      endsAt: contest.ends_at,
    }),
    getContestUnresolvedMarkets({
      startsAt: contest.starts_at,
      endsAt: contest.ends_at,
    }),
  ]);

  const visible = ranked.slice(0, limit);

  // Identity for exactly the rows that will be serialized: the visible
  // page plus the viewer's own row when it falls outside it.
  const viewerIndex = viewerWallet
    ? ranked.findIndex((r) => r.wallet_address === viewerWallet)
    : -1;

  const needIdentity = new Set(visible.map((r) => r.wallet_address));
  if (viewerIndex >= 0) needIdentity.add(ranked[viewerIndex].wallet_address);

  const ids = await identityFor(Array.from(needIdentity));

  const toRow = (
    r: Omit<PlayContestRankingRow, "rank" | "username" | "avatar_url">,
    rank: number
  ): PlayPublicRankingRow => {
    const id = ids.get(r.wallet_address);
    return {
      rank,
      wallet_address: r.wallet_address,
      username: id?.display_name ?? null,
      avatar_url: id?.avatar_url ?? null,
      realized_pnl_usd: r.realized_pnl_usd,
      wins: r.wins,
      losses: r.losses,
      settled_picks: r.settled_picks,
      win_rate: r.win_rate,
    };
  };

  return {
    contest: publicContest,
    ranking: visible.map((r, i) => toRow(r, i + 1)),
    viewer:
      viewerIndex >= 0 ? toRow(ranked[viewerIndex], viewerIndex + 1) : null,
    meta: {
      generated_at: generatedAt,
      total_players: ranked.length,
      unresolved_markets: unresolved.length,
      ranking_state: "preview",
      truncated,
    },
  };
}
