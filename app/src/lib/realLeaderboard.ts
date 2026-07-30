// src/lib/realLeaderboard.ts
//
// The Real "Road to $1M" ranking, by CLAIMED PROFIT.
//
// WHY THE METRIC IS NAMED THAT AND NOT "REALIZED PNL"
// ---------------------------------------------------
// claim_winnings pays `user_shares × market_account_lamports /
// total_winning_supply`. That divisor is never decremented and the
// numerator is the market account's LIVE balance — which also holds rent
// and un-withdrawn creator fees, and shrinks with every prior claim. A
// payout is therefore path-dependent on claim ordering, and the pool
// balance at finalization is stored nowhere off-chain.
//
// So an UNCLAIMED win cannot be valued from the database at all. Rather
// than estimate it (which would invent money) or count it as zero (which
// would rank a winner as a loser), a position is excluded from the
// ranking until its claim is actually recorded. What remains is a real,
// fully-determined quantity — completed cash flows — and it is labelled
// as exactly that everywhere it is shown: CLAIMED PROFIT.
//
// WHAT IS SUMMED (all in integer lamports, never binary float)
//   + claim proceeds        (tx_type='claim')
//   + refund proceeds       (tx_type='refund')
//   + completed sell proceeds (trade, is_buy=false — net received)
//   − gross buy cost        (trade, is_buy=true — INCLUDES the 1%
//                            platform + 2% creator fee the user paid,
//                            because transactions.cost stores totalPay)
//
// tx_type='claim_fees' is creator revenue, not a trading result, and is
// never counted.
//
// ENVIRONMENT SAFETY
// ------------------
// Devnet test data, superseded program deployments and orphaned rows must
// never reach a public production ranking. Eligibility is therefore
// positive-gated: a market row must DECLARE the supported cluster and
// program id to be counted. Rows that declare nothing are excluded in
// production — see isEligibleMarket below.

import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import { getSolanaCluster, type SolanaCluster } from "@/utils/explorer";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type RealLeaderboardRow = {
  rank: number;
  wallet_address: string;
  username: string | null;
  avatar_url: string | null;
  /** Claimed profit, signed, as a 9-dp SOL decimal string. */
  claimed_profit_sol: string;
  /** Positions actually counted: wins + losses + refunded. */
  settled_claimed_positions: number;
  wins: number;
  losses: number;
  /** wins / (wins + losses), 0..1. Refunded positions are not in either. */
  win_rate: string;
  /** SUM of gross buy cost over counted positions. */
  total_settled_volume_sol: string;
};

export type RealLeaderboardMeta = {
  generated_at: string;
  /** Ranked wallets BEFORE the display cap. */
  total_traders: number;
  /** Which chain the ranking covers. */
  cluster: SolanaCluster;
  /**
   * True when the data shown is devnet test data rather than production.
   * The UI MUST label the page when this is set.
   */
  is_test_data: boolean;
  /**
   * Winning positions left out because their payout is unclaimed and
   * cannot be valued. Surfaced so the omission is never silent.
   */
  excluded_unclaimed_positions: number;
  /** Eligible transaction rows the ranking was built from. */
  eligible_rows: number;
  /**
   * CUMULATIVE eligible Real BUY volume across every trader — the figure
   * the community road is built on.
   *
   * Not the same quantity as a row's total_settled_volume_sol: this
   * includes buys on markets that are still open, and excludes sells,
   * claims, refunds and creator-fee withdrawals so a round trip cannot be
   * counted twice.
   */
  total_real_volume_sol: string;
};

export type RealLeaderboardView = {
  rows: RealLeaderboardRow[];
  viewer: RealLeaderboardRow | null;
  meta: RealLeaderboardMeta;
};

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

export const REAL_LEADERBOARD_DEFAULT_LIMIT = 100;
const REAL_LEADERBOARD_MAX_LIMIT = 100;

/** Ceiling on transaction rows scanned for one build. */
const REAL_MAX_ROWS = 50_000;

/** Ceiling on market rows loaded for the eligibility gate. */
const REAL_MAX_MARKETS = 20_000;

const LAMPORTS_PER_SOL = 1_000_000_000;

/* -------------------------------------------------------------------------- */
/*  Money — exact integer lamports, never binary float                         */
/* -------------------------------------------------------------------------- */

/**
 * transactions.cost is a SOL amount stored as a double. Rounding to whole
 * lamports at the boundary is what keeps every subsequent sum exact: all
 * arithmetic below is integer, and the only float is the one already in
 * the column.
 */
function solToLamports(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * LAMPORTS_PER_SOL);
}

/** 1234567890 → "1.234567890". Signed, 9 dp, no float. */
export function lamportsToSolString(lamports: number): string {
  const neg = lamports < 0;
  const abs = Math.abs(Math.round(lamports));
  const whole = Math.floor(abs / LAMPORTS_PER_SOL);
  const frac = String(abs % LAMPORTS_PER_SOL).padStart(9, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** wins/decided as a 4-dp decimal string. "0.0000" when nothing is decided. */
function ratioToDecimal(numerator: number, denominator: number): string {
  if (denominator <= 0) return "0.0000";
  const scaled = Math.round((numerator / denominator) * 10_000);
  return `${Math.floor(scaled / 10_000)}.${String(scaled % 10_000).padStart(4, "0")}`;
}

/* -------------------------------------------------------------------------- */
/*  Paged reads                                                                */
/* -------------------------------------------------------------------------- */

/** PostgREST returns at most this many rows per request by default. */
const PAGE = 1000;

/**
 * Read a whole table in pages.
 *
 * `.limit(n)` alone is NOT enough: PostgREST caps a response at its
 * db-max-rows (1000 by default) regardless of the limit asked for, so a
 * single call would silently truncate — and truncating the ledger would
 * not error, it would just quietly produce a wrong ranking. Paging until
 * a short page arrives is the only read here that stays correct as the
 * table grows past that cap. `cap` still bounds the total work.
 */
async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  cap: number
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const to = Math.min(from + PAGE, cap) - 1;
    const { data, error } = await build(from, to);
    if (error) throw new Error(error.message || "read failed");
    const page = (data || []).filter(Boolean);
    out.push(...page);
    if (page.length < PAGE) break; // short page → end of table
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Environment gate                                                           */
/* -------------------------------------------------------------------------- */

/** The program id this deployment treats as canonical for its cluster. */
export function supportedProgramId(cluster: SolanaCluster): string {
  const byCluster =
    cluster === "devnet"
      ? process.env.NEXT_PUBLIC_PROGRAM_ID_DEVNET
      : cluster === "mainnet-beta"
        ? process.env.NEXT_PUBLIC_PROGRAM_ID_MAINNET
        : process.env.NEXT_PUBLIC_PROGRAM_ID_TESTNET;
  return String(byCluster || process.env.NEXT_PUBLIC_PROGRAM_ID || "").trim();
}

type MarketRow = {
  id: string;
  market_address: string | null;
  program_id: string | null;
  cluster: string | null;
  resolution_status: string | null;
  cancelled: boolean | null;
  winning_outcome: number | null;
};

function normalizeCluster(raw: unknown): SolanaCluster | null {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "mainnet" || s === "mainnet-beta") return "mainnet-beta";
  if (s === "devnet") return "devnet";
  if (s === "testnet") return "testnet";
  return null;
}

/**
 * May this market's trades enter the ranking?
 *
 * PRODUCTION (mainnet) is positive-gated: the row must DECLARE both the
 * supported cluster and the supported program id. A row that declares
 * nothing is excluded, because "unlabelled" is exactly what a devnet
 * market, a superseded deployment and an orphan all look like — and the
 * markets table currently carries no cluster/program on ANY row, so this
 * gate is what keeps 632 orphaned and legacy rows out of a public board.
 *
 * NON-PRODUCTION clusters additionally accept an undeclared row, so a
 * developer can see the page work against local devnet history. Every
 * response built that way is flagged `is_test_data`, and the UI is
 * required to label it DEVNET TEST DATA.
 */
function isEligibleMarket(m: MarketRow, cluster: SolanaCluster, program: string): boolean {
  const declaredCluster = normalizeCluster(m.cluster);
  const declaredProgram = String(m.program_id || "").trim();

  if (declaredCluster && declaredCluster !== cluster) return false;
  if (declaredProgram && program && declaredProgram !== program) return false;

  if (cluster === "mainnet-beta") {
    // Production: nothing undeclared is ever counted.
    return !!declaredCluster && !!declaredProgram;
  }

  // Dev/test clusters: an undeclared row is allowed, and the whole
  // response is flagged as test data because of it.
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Ranking                                                                    */
/* -------------------------------------------------------------------------- */

type Position = {
  wallet: string;
  marketKey: string;
  market: MarketRow;
  /** outcome_index → net shares (buys minus sells). Kept for audit. */
  shares: Map<number, number>;
  /** Gross buy cost minus sell proceeds, in lamports. */
  netCostLamports: number;
  /** Gross buy cost only — the "volume" figure. */
  grossBuyLamports: number;
  /** Claim + refund proceeds recorded for this (wallet, market). */
  settlementLamports: number;
  hasSettlementRecord: boolean;
};

/**
 * The Real leaderboard, ranked by CLAIMED PROFIT in SOL.
 *
 * GROUPING
 * --------
 * The unit is (wallet, market): multiple buys on the same market are one
 * position, which is what a claim settles against. Per-outcome share
 * counts are tracked inside the group so the winning side can be
 * identified for the win/loss split — opposite outcomes stay separate
 * there — but a claim is market-level on-chain, so the money is grouped
 * at market level too.
 *
 * WHAT COUNTS
 *   finalized + user held winning shares + claim recorded  → WIN,  counted
 *   finalized + user held winning shares + NO claim        → EXCLUDED
 *   finalized + user held no winning shares                → LOSS, counted
 *   cancelled + refund recorded                            → counted at 0
 *   cancelled + no refund recorded                         → EXCLUDED
 *   market not terminal (open position)                    → EXCLUDED
 *
 * ORDER (total, deterministic)
 *   1. claimed profit desc  2. wins desc
 *   3. settled positions desc  4. wallet asc — unique, so two identical
 *      requests can never disagree.
 */
export async function getRealLeaderboard(opts?: {
  limit?: number;
  /** Wallet whose own row to resolve. Public data — no session required. */
  viewerWallet?: string | null;
}): Promise<RealLeaderboardView> {
  const supa = supabaseServer();
  const generatedAt = new Date().toISOString();
  const cluster = getSolanaCluster();
  const program = supportedProgramId(cluster);

  const limit = Math.min(
    Math.max(Math.floor(Number(opts?.limit) || REAL_LEADERBOARD_DEFAULT_LIMIT), 1),
    REAL_LEADERBOARD_MAX_LIMIT
  );

  const emptyMeta: RealLeaderboardMeta = {
    generated_at: generatedAt,
    total_traders: 0,
    cluster,
    is_test_data: false,
    excluded_unclaimed_positions: 0,
    eligible_rows: 0,
    total_real_volume_sol: "0.000000000",
  };
  const empty: RealLeaderboardView = { rows: [], viewer: null, meta: emptyMeta };

  /* ---- markets, and the eligibility gate ---- */
  const markets = await readAll<MarketRow>(
    (from, to) =>
      supa
        .from("markets")
        .select(
          "id,market_address,program_id,cluster,resolution_status,cancelled,winning_outcome"
        )
        .range(from, to) as any,
    REAL_MAX_MARKETS
  );

  const byId = new Map<string, MarketRow>();
  const byAddress = new Map<string, MarketRow>();
  let sawUndeclared = false;

  for (const m of markets) {
    if (!isEligibleMarket(m, cluster, program)) continue;
    if (!normalizeCluster(m.cluster) || !String(m.program_id || "").trim()) {
      sawUndeclared = true;
    }
    byId.set(String(m.id), m);
    if (m.market_address) byAddress.set(String(m.market_address), m);
  }

  if (byId.size === 0) {
    return { ...empty, meta: { ...emptyMeta, is_test_data: false } };
  }

  /* ---- transactions ---- */
  const txs = await readAll<any>(
    (from, to) =>
      supa
        .from("transactions")
        .select(
          "market_id,market_address,user_address,tx_type,is_buy,is_yes," +
            "outcome_index,shares,amount,cost"
        )
        .range(from, to) as any,
    REAL_MAX_ROWS
  );

  const marketOf = (t: any): MarketRow | null => {
    const byIdHit = t.market_id ? byId.get(String(t.market_id)) : null;
    if (byIdHit) return byIdHit;
    return t.market_address ? byAddress.get(String(t.market_address)) ?? null : null;
  };

  const isTerminal = (m: MarketRow) =>
    m.resolution_status === "finalized" ||
    m.resolution_status === "cancelled" ||
    m.cancelled === true;

  const isCancelled = (m: MarketRow) =>
    m.cancelled === true || m.resolution_status === "cancelled";

  const positions = new Map<string, Position>();
  let eligibleRows = 0;
  let communityVolumeLamports = 0;

  for (const t of txs) {
    const m = marketOf(t);
    // Orphaned, or from another cluster/program — never counted at all.
    if (!m) continue;

    const wallet = String(t.user_address || "").trim();
    if (!wallet) continue;

    /* ---- COMMUNITY VOLUME ---------------------------------------------
     * Counted for every eligible BUY, including buys on markets that are
     * still open. Volume is what was traded, not what has settled — a
     * trade contributes to the community road the moment it happens,
     * which is exactly what the page promises.
     *
     * BUYS ONLY, so a round trip is not counted twice: a sell returns
     * lamports from the same pool a buy put in, and adding both would
     * inflate the road with money that only moved once. Claims, refunds
     * and creator-fee withdrawals are settlement flows, not trading, and
     * are excluded here as well.
     *
     * This is a DIFFERENT quantity from the per-trader
     * total_settled_volume_sol below, which covers only the positions the
     * ranking actually counted.
     * ------------------------------------------------------------------ */
    if (String(t.tx_type || "trade") === "trade" && t.is_buy) {
      communityVolumeLamports += solToLamports(t.cost);
    }

    // The RANKING additionally requires a settled market.
    if (!isTerminal(m)) continue;

    const marketKey = String(m.market_address || m.id);
    const key = `${wallet}|${marketKey}`;

    let p = positions.get(key);
    if (!p) {
      p = {
        wallet,
        marketKey,
        market: m,
        shares: new Map(),
        netCostLamports: 0,
        grossBuyLamports: 0,
        settlementLamports: 0,
        hasSettlementRecord: false,
      };
      positions.set(key, p);
    }

    const type = String(t.tx_type || "trade");
    const lamports = solToLamports(t.cost);

    if (type === "claim" || type === "refund") {
      p.settlementLamports += lamports;
      p.hasSettlementRecord = true;
      eligibleRows += 1;
      continue;
    }

    // Creator fee withdrawals are not a trading result.
    if (type === "claim_fees") continue;
    if (type !== "trade") continue;

    // Legacy rows carry the outcome in is_yes rather than outcome_index.
    const idx = Number.isInteger(t.outcome_index)
      ? Number(t.outcome_index)
      : t.is_yes === true
        ? 0
        : t.is_yes === false
          ? 1
          : null;
    if (idx === null || idx < 0) continue;

    const shares = Number(t.shares ?? t.amount ?? 0) || 0;

    if (t.is_buy) {
      p.shares.set(idx, (p.shares.get(idx) ?? 0) + shares);
      p.netCostLamports += lamports;
      p.grossBuyLamports += lamports;
    } else {
      p.shares.set(idx, (p.shares.get(idx) ?? 0) - shares);
      // A sell returns lamports, so it reduces the cost basis.
      p.netCostLamports -= lamports;
    }
    eligibleRows += 1;
  }

  /* ---- fold positions into per-wallet totals ---- */
  type Agg = {
    profitLamports: number;
    volumeLamports: number;
    wins: number;
    losses: number;
    counted: number;
  };

  const byWallet = new Map<string, Agg>();
  let excludedUnclaimed = 0;

  const aggFor = (wallet: string): Agg => {
    let a = byWallet.get(wallet);
    if (!a) {
      a = { profitLamports: 0, volumeLamports: 0, wins: 0, losses: 0, counted: 0 };
      byWallet.set(wallet, a);
    }
    return a;
  };

  for (const p of Array.from(positions.values())) {
    const m = p.market;

    if (isCancelled(m)) {
      // A refund returns the stake. With both records present the position
      // is a wash by definition, so it contributes exactly zero rather
      // than the rounding noise of (refund − cost).
      if (!p.hasSettlementRecord) continue; // refund not claimed — excluded
      const a = aggFor(p.wallet);
      a.volumeLamports += p.grossBuyLamports;
      a.counted += 1;
      continue;
    }

    const winning = m.winning_outcome;
    const winningShares =
      winning != null && Number.isInteger(winning) ? p.shares.get(Number(winning)) ?? 0 : 0;

    if (winningShares > 0) {
      if (!p.hasSettlementRecord) {
        // Held the winning side but never claimed. The payout is not
        // computable off-chain, so the whole position stands aside.
        excludedUnclaimed += 1;
        continue;
      }
      const a = aggFor(p.wallet);
      a.profitLamports += p.settlementLamports - p.netCostLamports;
      a.volumeLamports += p.grossBuyLamports;
      a.wins += 1;
      a.counted += 1;
      continue;
    }

    // No winning shares: a fully determined loss of the net cost paid.
    // A stray settlement record (partial sell then claim) is still added.
    const a = aggFor(p.wallet);
    a.profitLamports += p.settlementLamports - p.netCostLamports;
    a.volumeLamports += p.grossBuyLamports;
    a.losses += 1;
    a.counted += 1;
  }

  type Ranked = Omit<RealLeaderboardRow, "rank" | "username" | "avatar_url">;
  const ranked: Ranked[] = [];

  for (const [wallet, a] of Array.from(byWallet.entries())) {
    // No eligible completed activity — not ranked.
    if (a.counted === 0) continue;
    ranked.push({
      wallet_address: wallet,
      claimed_profit_sol: lamportsToSolString(a.profitLamports),
      settled_claimed_positions: a.counted,
      wins: a.wins,
      losses: a.losses,
      win_rate: ratioToDecimal(a.wins, a.wins + a.losses),
      total_settled_volume_sol: lamportsToSolString(a.volumeLamports),
    });
  }

  const meta: RealLeaderboardMeta = {
    generated_at: generatedAt,
    total_traders: ranked.length,
    cluster,
    is_test_data: cluster !== "mainnet-beta" && sawUndeclared,
    excluded_unclaimed_positions: excludedUnclaimed,
    eligible_rows: eligibleRows,
    total_real_volume_sol: lamportsToSolString(communityVolumeLamports),
  };

  // The road is community-wide, so volume survives an empty RANKING: a
  // market can be traded heavily and still have nothing settled to rank.
  if (ranked.length === 0) return { rows: [], viewer: null, meta };

  // Total, deterministic order on exact integers and a unique final key.
  const profitOf = new Map(
    ranked.map((r) => [r.wallet_address, solToLamports(r.claimed_profit_sol)])
  );
  ranked.sort((x, y) => {
    const px = profitOf.get(x.wallet_address) ?? 0;
    const py = profitOf.get(y.wallet_address) ?? 0;
    if (px !== py) return py - px;
    if (x.wins !== y.wins) return y.wins - x.wins;
    if (x.settled_claimed_positions !== y.settled_claimed_positions) {
      return y.settled_claimed_positions - x.settled_claimed_positions;
    }
    return x.wallet_address < y.wallet_address ? -1 : 1;
  });

  const viewerWallet = String(opts?.viewerWallet || "").trim() || null;
  const viewerIndex = viewerWallet
    ? ranked.findIndex((r) => r.wallet_address === viewerWallet)
    : -1;

  // Identity for exactly the rows that will be serialized.
  const visible = ranked.slice(0, limit);
  const needIdentity = new Set(visible.map((r) => r.wallet_address));
  if (viewerIndex >= 0) needIdentity.add(ranked[viewerIndex].wallet_address);

  const identity = new Map<
    string,
    { display_name: string | null; avatar_url: string | null }
  >();
  if (needIdentity.size > 0) {
    // Best effort: a profile read failure must never break the ranking.
    const { data: profileRows } = await supa
      .from("profiles")
      .select("wallet_address,display_name,avatar_url")
      .in("wallet_address", Array.from(needIdentity));
    for (const p of (profileRows as any[]) || []) {
      identity.set(String(p.wallet_address), {
        display_name: p.display_name ?? null,
        avatar_url: p.avatar_url ?? null,
      });
    }
  }

  const withIdentity = (r: Ranked, rank: number): RealLeaderboardRow => {
    const id = identity.get(r.wallet_address);
    return {
      ...r,
      rank,
      username: id?.display_name ?? null,
      avatar_url: id?.avatar_url ?? null,
    };
  };

  return {
    rows: visible.map((r, i) => withIdentity(r, i + 1)),
    viewer:
      viewerIndex >= 0 ? withIdentity(ranked[viewerIndex], viewerIndex + 1) : null,
    meta,
  };
}
