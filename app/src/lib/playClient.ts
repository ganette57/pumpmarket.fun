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

export type PlayTradeStatusView = "open" | "won" | "lost" | "refunded";

/** One of the caller's own Play trades, as /api/play/history returns it. */
export type PlayHistoryTradeView = {
  id: string;
  market_address: string;
  outcome_index: number;
  outcome_name: string | null;
  stake_usd: string;
  shares: string;
  status: PlayTradeStatusView;
  /** Null until the trade settles — never render null as 0. */
  payout_usd: string | null;
  realized_pnl_usd: string | null;
  created_at: string;
  settled_at: string | null;
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
  /**
   * ACTUAL cumulative USD staked per outcome, index-stable, one entry per
   * outcome ("0.00" where nobody bought). Not `virtual_pool_usd × probability`
   * — that is a different quantity, because `supplies` include the seeded
   * opening book no user paid for.
   */
  stake_by_outcome_usd: string[];
};

/**
 * The two market-wide inputs play_settle_market's pro-rata payout divides by,
 * as /api/play/settlement-preview returns them. Inputs only — the payout
 * itself is computed by src/lib/playPayoutMath.ts, which owns the single
 * mirror of the SQL formula.
 */
export type PlaySettlementBookView = {
  market_address: string;
  winning_outcome: number;
  /** The SQL's `final_pool`. */
  virtual_pool_usd: string;
  /** The SQL's `total_winning` — SUM(shares) over ALL open winning trades. */
  total_winning_shares: string;
  status: string;
  version: number;
};

export type PlayHistoryPointView = {
  /** ISO timestamp. */
  t: string;
  /** 0 = opening book, then trade sequence 1..N. */
  seq: number;
  /** Implied probability per outcome, 0..100, index-stable. */
  pct: number[];
  /** Cumulative virtual pool USD (decimal string). */
  pool_usd: string;
};

export type PlayMarketHistoryView = {
  market_address: string;
  outcome_count: number;
  outcome_names: string[];
  status: string;
  version: number;
  seeded: boolean;
  points: PlayHistoryPointView[];
};

/** One public Play trade in a market activity list. Nothing user-scoped. */
export type PlayActivityRowView = {
  id: string;
  outcome_index: number;
  outcome_name: string | null;
  /** Play is buy-only — there is no sell path in the engine. */
  side: "buy";
  shares: string;
  stake_usd: string;
  created_at: string;
  /** Already truncated by the server ("abcd…wxyz") or the neutral "Player". */
  trader_label: string;
  status: string;
};

export type PlayMarketActivityView = {
  market_address: string;
  outcome_names: string[];
  rows: PlayActivityRowView[];
  /** Opaque cursor for the next (older) page — null when exhausted. */
  next_before: string | null;
};

/** One grouped (market, outcome) Play position on a profile. */
export type PlayProfilePositionView = {
  market_address: string;
  market_title: string | null;
  outcome_index: number;
  outcome_name: string | null;
  total_stake_usd: string;
  total_shares: string;
  /** Individual buys collapsed into this row. */
  trade_count: number;
  status: "open" | "won" | "lost" | "refunded";
  /** Null while nothing in the group has settled. */
  payout_usd: string | null;
  /** Null while nothing in the group has settled — NEVER a quoted value. */
  realized_pnl_usd: string | null;
  first_trade_at: string;
  last_trade_at: string;
};

export type PlayProfileView = {
  wallet_address: string;
  /** profiles.display_name — the same identity Real Mode shows. */
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  is_owner: boolean;
  /** Owner-only; null for a public viewer. */
  balance_usd: string | null;
  realized_pnl_usd: string;
  trade_count: number;
  position_count: number;
  positions: PlayProfilePositionView[];
  truncated: boolean;
};

/** One ranked player on the public Play leaderboard. */
export type PlayLeaderboardRowView = {
  rank: number;
  wallet_address: string;
  /** profiles.display_name — the same identity Real Mode shows. */
  username: string | null;
  avatar_url: string | null;
  /** SUM(realized_pnl_usd) over settled trades. Signed decimal string. */
  realized_pnl_usd: string;
  /** Settled grouped (market, outcome) positions — never raw buys. */
  picks: number;
  wins: number;
  losses: number;
  /** wins / (wins + losses) as a 0..1 decimal string. Refunds excluded. */
  win_rate: string;
  total_settled_stake_usd: string;
};

export type PlayLeaderboardView = {
  period: "all";
  rows: PlayLeaderboardRowView[];
  /** Eligible players before the limit — may exceed rows.length. */
  total_players: number;
  /** The caller's own row when a Play session is present and ranked. */
  viewer: PlayLeaderboardRowView | null;
  truncated: boolean;
  generated_at: string;
};

/* ----- Public Play competition (mirrors /api/play/contest) ----------------- */

export type PlayContestStatusView =
  | "draft"
  | "live"
  | "ended"
  | "under_review"
  | "verified"
  | "paid"
  | "closed"
  | "cancelled";

/** The contest as the public page sees it. No admin field reaches here. */
export type PlayPublicContestView = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  status: PlayContestStatusView;
  prize_pool_usd: string;
  first_prize_usd: string;
  second_prize_usd: string;
  third_prize_usd: string;
  frozen_at: string | null;
  verified_at: string | null;
};

/** One ranked player in a contest. Narrower than the All-Time row. */
export type PlayContestRowView = {
  rank: number;
  wallet_address: string;
  username: string | null;
  avatar_url: string | null;
  realized_pnl_usd: string;
  wins: number;
  losses: number;
  /** Settled grouped (market, outcome) positions — never raw buys. */
  settled_picks: number;
  /** wins / (wins + losses) as a 0..1 decimal string. Refunds excluded. */
  win_rate: string;
};

/**
 * `preview` — recalculated now, may still change as markets settle.
 * `frozen`  — the immutable official snapshot.
 * `none`    — no competition is scheduled.
 */
export type PlayContestRankingState = "preview" | "frozen" | "none";

export type PlayContestResponse = {
  contest: PlayPublicContestView | null;
  ranking: PlayContestRowView[];
  viewer: PlayContestRowView | null;
  meta: {
    generated_at: string;
    total_players: number;
    unresolved_markets: number;
    ranking_state: PlayContestRankingState;
    truncated: boolean;
  };
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

async function post<T>(
  path: string,
  body?: unknown,
  opts?: { bearer?: string }
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Only the Privy sign-in call sends one. It is a short-lived
        // Privy access token, not a FunMarket credential — the session
        // this endpoint returns is the httpOnly cookie, as always.
        ...(opts?.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}),
      },
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

  /**
   * The Google/Privy sign-in path — one call, no challenge, no signature.
   *
   * The token is the ONLY thing sent: the server derives the Privy user
   * and their embedded wallet from it. Returns the same shape as verify()
   * and sets the same play_session cookie, so every caller downstream is
   * identical whichever door the user came through.
   */
  privyLogin(accessToken: string) {
    return post<PlayVerifyResponse>("/api/play/auth/privy", undefined, {
      bearer: accessToken,
    });
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

  /**
   * The session wallet's OWN Play trades. The account comes from the session
   * cookie, so there is no parameter that could read another wallet.
   *
   * Money stays as decimal strings — `payout_usd` / `realized_pnl_usd` are
   * null until the trade settles, and a null must never be shown as 0.
   */
  async history(args?: { status?: PlayTradeStatusView; limit?: number }) {
    const raw = await post<{ account_id: string; trades: PlayHistoryTradeView[] }>(
      "/api/play/history",
      args ?? {}
    );
    return (raw.trades ?? []).map((t) => ({
      ...t,
      stake_usd: decimal(t.stake_usd),
      shares: decimal(t.shares),
      payout_usd:
        t.payout_usd === null || t.payout_usd === undefined ? null : decimal(t.payout_usd),
      realized_pnl_usd:
        t.realized_pnl_usd === null || t.realized_pnl_usd === undefined
          ? null
          : decimal(t.realized_pnl_usd),
    })) as PlayHistoryTradeView[];
  },

  /**
   * The settlement book for one market and one proposed outcome, so a
   * provisional result can show an estimated payout.
   *
   * Read-only end to end: the route runs no RPC, settles nothing and credits
   * nothing. Returns null when the numbers cannot be stated exactly — the
   * caller must then show no payout at all rather than a zero.
   */
  async settlementPreview(args: {
    marketAddress: string;
    winningOutcome: number;
  }): Promise<PlaySettlementBookView | null> {
    const raw = await post<{ book: PlaySettlementBookView | null }>(
      "/api/play/settlement-preview",
      {
        market_address: args.marketAddress,
        winning_outcome: args.winningOutcome,
      }
    );
    const book = raw?.book;
    if (!book) return null;
    // decimal() would coerce an unreadable value to "0"; a zero pool or a
    // zero winning supply must stay unknown, so they are checked instead.
    const pool = String(book.virtual_pool_usd ?? "").trim();
    const total = String(book.total_winning_shares ?? "").trim();
    if (!/^-?\d+(\.\d+)?$/.test(pool) || !/^-?\d+(\.\d+)?$/.test(total)) {
      return null;
    }
    return { ...book, virtual_pool_usd: pool, total_winning_shares: total };
  },

  /**
   * Authoritative Play probability history for one market's chart. Public —
   * no session required (odds are public market data). Returns index-stable
   * per-outcome percentages over time, never Real data. pool_usd is kept as a
   * decimal string.
   */
  async marketHistory(marketAddress: string, opts?: { maxPoints?: number }) {
    const raw = await post<{ history: PlayMarketHistoryView }>(
      "/api/play/markets/history",
      {
        market_address: marketAddress,
        ...(opts?.maxPoints ? { max_points: opts.maxPoints } : {}),
      }
    );
    const h = raw.history;
    return {
      ...h,
      points: (h?.points ?? []).map((p) => ({
        ...p,
        pool_usd: decimal(p.pool_usd),
      })),
    } as PlayMarketHistoryView;
  },

  /**
   * One wallet's Play profile: identity, grouped positions, realized P&L.
   *
   * Public by wallet — no session required for the performance record. The
   * CURRENT BALANCE is the exception: the server releases balance_usd only
   * when the session cookie proves the caller owns this wallet, so a public
   * read returns `balance_usd: null, is_owner: false`.
   *
   * Money stays a decimal string, as everywhere else here.
   */
  async profile(wallet: string) {
    const raw = await post<{ profile: PlayProfileView }>("/api/play/profile", {
      wallet,
    });
    const p = raw.profile;
    return {
      ...p,
      // Null is meaningful here (owner-only / not settled) and must survive
      // normalization — decimal() would turn it into "0".
      balance_usd: p?.balance_usd == null ? null : decimal(p.balance_usd),
      realized_pnl_usd: decimal(p?.realized_pnl_usd),
      positions: (p?.positions ?? []).map((r) => ({
        ...r,
        total_stake_usd: decimal(r.total_stake_usd),
        total_shares: decimal(r.total_shares),
        payout_usd: r.payout_usd == null ? null : decimal(r.payout_usd),
        realized_pnl_usd:
          r.realized_pnl_usd == null ? null : decimal(r.realized_pnl_usd),
      })),
    } as PlayProfileView;
  },

  /**
   * The public Play leaderboard, ranked by authoritative realized P&L.
   *
   * Public — no session required. When a Play session cookie IS present the
   * response also carries `viewer`: the caller's own row and rank, with the
   * same public stats as any other row and no balance.
   *
   * Money and win rate stay decimal strings, as everywhere else here.
   */
  async leaderboard(opts?: { limit?: number }) {
    const raw = await post<{ leaderboard: PlayLeaderboardView }>(
      "/api/play/leaderboard",
      opts?.limit ? { limit: opts.limit } : {}
    );
    const l = raw.leaderboard;
    const row = (r: PlayLeaderboardRowView): PlayLeaderboardRowView => ({
      ...r,
      realized_pnl_usd: decimal(r.realized_pnl_usd),
      win_rate: decimal(r.win_rate),
      total_settled_stake_usd: decimal(r.total_settled_stake_usd),
    });
    return {
      period: "all",
      rows: (l?.rows ?? []).map(row),
      total_players: Number(l?.total_players) || 0,
      viewer: l?.viewer ? row(l.viewer) : null,
      truncated: !!l?.truncated,
      generated_at: String(l?.generated_at ?? ""),
    } as PlayLeaderboardView;
  },

  /**
   * The current PUBLIC Play competition: the contest, its ranking, and the
   * caller's own row.
   *
   * Public — no session required. When a Play session cookie IS present the
   * response also carries `viewer`: the caller's own row and rank within
   * THIS contest, with the same public stats as any other row and no
   * balance.
   *
   * `meta.ranking_state` says how final the ranking is: `frozen` is the
   * official snapshot and will not move again, `preview` is recalculated
   * and may still change as markets settle.
   *
   * Money and win rate stay decimal strings, as everywhere else here.
   */
  async contest(opts?: { limit?: number }) {
    const raw = await post<PlayContestResponse>(
      "/api/play/contest",
      opts?.limit ? { limit: opts.limit } : {}
    );
    const row = (r: PlayContestRowView): PlayContestRowView => ({
      ...r,
      rank: Number(r.rank) || 0,
      wins: Number(r.wins) || 0,
      losses: Number(r.losses) || 0,
      settled_picks: Number(r.settled_picks) || 0,
      realized_pnl_usd: decimal(r.realized_pnl_usd),
      win_rate: decimal(r.win_rate),
    });
    const c = raw?.contest ?? null;
    return {
      contest: c
        ? {
            ...c,
            prize_pool_usd: decimal(c.prize_pool_usd),
            first_prize_usd: decimal(c.first_prize_usd),
            second_prize_usd: decimal(c.second_prize_usd),
            third_prize_usd: decimal(c.third_prize_usd),
          }
        : null,
      ranking: (raw?.ranking ?? []).map(row),
      viewer: raw?.viewer ? row(raw.viewer) : null,
      meta: {
        generated_at: String(raw?.meta?.generated_at ?? ""),
        total_players: Number(raw?.meta?.total_players) || 0,
        unresolved_markets: Number(raw?.meta?.unresolved_markets) || 0,
        ranking_state: (raw?.meta?.ranking_state ?? "none") as PlayContestRankingState,
        truncated: !!raw?.meta?.truncated,
      },
    } as PlayContestResponse;
  },

  /**
   * Authoritative PUBLIC Play trade activity for one market, newest first.
   * Public — no session required (who traded a market is public in both
   * modes). The server already truncated the wallet and stripped every
   * account-scoped field, so this is the whole safe row.
   *
   * Money and share counts stay decimal strings, as everywhere else here.
   */
  async marketActivity(
    marketAddress: string,
    opts?: { limit?: number; before?: string }
  ) {
    const raw = await post<{ activity: PlayMarketActivityView }>(
      "/api/play/markets/activity",
      {
        market_address: marketAddress,
        ...(opts?.limit ? { limit: opts.limit } : {}),
        ...(opts?.before ? { before: opts.before } : {}),
      }
    );
    const a = raw.activity;
    return {
      market_address: String(a?.market_address ?? marketAddress),
      outcome_names: Array.isArray(a?.outcome_names) ? a.outcome_names : [],
      rows: (a?.rows ?? []).map((r) => ({
        ...r,
        shares: decimal(r.shares),
        stake_usd: decimal(r.stake_usd),
      })),
      next_before: a?.next_before ?? null,
    } as PlayMarketActivityView;
  },
};
