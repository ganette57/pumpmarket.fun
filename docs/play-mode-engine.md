# Play Mode — Phase 1 engine

Isolated virtual-USD economy running alongside Real Mode. Backend only:
nothing in this phase is wired to the feed, Quick Buy, TradingPanel,
dashboard or leaderboard.

- Migration: `app/supabase/migrations/20260721_play_mode_core.sql`
- Tests: `app/supabase/tests/20260721_play_mode_core_test.sql`
- Server libs: `app/src/lib/playEngine.ts`, `app/src/lib/playAuth.ts`
- Routes: `app/src/app/api/play/**`

---

## 1. Real-mode isolation

Play reads shared market **content** and **resolution**; it never writes a
Real economic field.

| Real concern | Play interaction |
|---|---|
| `markets.outcome_names`, `market_type` | read (outcome count + labels) |
| `markets.resolution_status`, `winning_outcome`, `resolved` | read (settlement trigger) |
| `markets.is_blocked`, `end_date` | read (tradability gate) |
| `markets.outcome_supplies`, `yes_supply`, `no_supply`, `total_volume` | **never touched** |
| `transactions` | **never touched** |
| Solana / Anchor / wallet transactions | **never called** |
| Platform fee, creator fee, escrow, claims, refunds | **never touched** |

All four `public.markets` references in the migration are `SELECT`. Play
money never leaves the `play_*` tables. Phase 1 added only new files — it
modified zero existing files.

---

## 2. Economic model

### What Real does (authoritative, unchanged)

From `programs/funmarket-pump/src/lib.rs`:

```
BASE_PRICE_LAMPORTS       = 10_000_000   (0.01 SOL)
SLOPE_LAMPORTS_PER_SUPPLY = 1_000        (0.000001 SOL per unit of supply)
PLATFORM_FEE_BPS = 100 (1%)   CREATOR_FEE_BPS = 200 (2%)

cost(q0, n) = n*BASE + SLOPE * n*(2*q0 + n - 1)/2     -- linear_cost_lamports
payout      = user_shares * market_lamports / total_winning_supply
refund      = pos.net_cost_lamports                   -- on cancel, fees kept
MAX_OUTCOMES = 10
```

Linear discrete curve — **not** LMSR, despite `math_lmsr.rs` and
`LMSR_MIGRATION.md` being present. `trade_inner` never calls it.

### What Play does (separate implementation, virtual USD)

Same curve shape, no fees, dollar-denominated input, fractional shares:

```
price(supply) = base_price_usd + slope_usd_per_share * supply
cost(q0, n)   = n*base + slope * n*(2*q0 + n)/2        -- continuous integral
shares(q0, S) = ( sqrt((base + slope*q0)^2 + 2*slope*S) - (base + slope*q0) ) / slope
payout        = trade.shares / SUM(user winning shares) * final_pool
refund        = stake_usd                              -- on cancel, in full
```

**Documented divergence:** Real's `-1` term exists only because it sums
over integer share indices. Play takes a dollar amount and issues
fractional shares, so the continuous integral of the same line is the
correct analogue. Same economics, no behavioural difference at the scale
either operates at. **Real was not changed.**

**Payout denominator is user-held winning shares, not the state's supply
array.** The seed supply (below) is a pricing device that nobody paid for;
including it in the denominator would permanently strand a slice of the
pool.

### Configuration — `play_settings` (single row, id = 1)

| Column | Default | Effect |
|---|---|---|
| `initial_supply_per_outcome` | `5000` | Seed given to every outcome on first interaction. **Higher = less sensitive**, trades move odds less. **Lower = the first trader dominates.** |
| `base_price_usd` | `1.00` | Price at zero supply. |
| `slope_usd_per_share` | `0.0002` | Steepness. **Higher = faster odds movement + worse fills.** |
| `daily_grant_usd` | `10000.00` | Daily bankroll. |
| `max_outcomes` | `10` | Matches on-chain `MAX_OUTCOMES`. |

At the defaults, on a fresh 2-outcome market: a **$500** buy moves the book
about **1.2 points**; a **$10,000 all-in** moves it about **15 points**.

Constants are read at call time and are never baked into stored rows, so
changing them affects future pricing only — existing supplies stand.

### Market initialization

Every outcome starts with the same seed, so a fresh book opens evenly:
2 outcomes → 50/50, 3 → 33/33/33, 4 → 25/25/25/25, up to 10.
Created atomically on first interaction via `INSERT … ON CONFLICT`, so
concurrent first trades cannot produce two states.

### Rounding

| Quantity | Type | Rule |
|---|---|---|
| stake | `numeric(18,2)` | truncated to the cent on input |
| shares | `numeric(28,8)` | **truncated**, never rounded — issued shares can never cost more than the stake paid |
| supplies | `numeric(28,8)` | exact accumulation |
| pool | `numeric(18,2)` | exact sum of stakes |
| payout | `numeric(18,2)` | **truncated** to the cent |

Truncating payouts means `SUM(payouts) ≤ pool` always. The remainder
("dust") stays in `virtual_pool_usd`. **Play never mints virtual value.**
No authoritative amount ever passes through a JS float — TypeScript keeps
numerics as strings.

**Zero-winner fallback:** if the winning outcome has no user shares, every
trade settles `lost` with payout 0 and the pool is left in place. Mirrors
Real, where `claim_winnings` requires `user_shares > 0`.

---

## 3. Schema

Five tables. **No `play_positions`** — Play has no sell, partial close or
cash-out, so a trade never changes size and `play_trades` *is* the
position. Settlement aggregates through the partial index
`play_trades_settlement_idx`; a denormalized copy would add a sync hazard
for nothing.

| Table | Purpose |
|---|---|
| `play_settings` | every tunable constant, one row |
| `play_seasons` | weekly competition windows |
| `play_accounts` | Play identity + authoritative balance |
| `play_market_states` | the independent virtual economy per market |
| `play_trades` | immutable buys; also the position ledger |
| `play_ledger` | append-only audit of every balance mutation |

### Why `play_market_states` is global per market, not per season

A Play market state is the order book for a live question. Resetting it at
a Monday 00:00 UTC boundary would jump the odds of an in-flight market for
reasons that have nothing to do with the market — confusing for traders,
unfair to positions opened the previous week (which stay open until the
market resolves).

**Seasons scope the leaderboard and the bankroll. They do not scope market
prices.** `UNIQUE(market_address)`; `created_in_season_id` is audit only.

### Why `play_accounts.id` is a UUID, not the wallet

`wallet_address` is a unique *secondary* identifier and `privy_user_id` is
already present and nullable. Because `play_trades` and `play_ledger` FK
the surrogate UUID rather than a wallet string, adopting Privy later is a
single column update — not a rewrite of every child row.

(`fun_points_accounts` uses `wallet text primary key`. That pattern is
deliberately **not** repeated here.)

### Idempotency

`play_ledger` has `UNIQUE (account_id, idempotency_key)`. This one
constraint is what makes the following *physically impossible* rather than
merely unlikely:

| Key | Prevents |
|---|---|
| `daily_grant:<YYYY-MM-DD>` | a second grant on the same UTC day |
| `trade_stake:<client_trade_id>` | a double-submitted trade |
| `trade_payout:<trade_id>` / `trade_refund:<trade_id>` | double settlement |
| `season_reset:<season_id>` | a double bankroll reset |

Plus `play_trades UNIQUE (account_id, client_trade_id)`.

Invariant: `play_accounts.balance_usd = SUM(play_ledger.amount_usd)` per
account, verified by test 10.

### RLS

Enabled on all six tables. `play_settings` and `play_seasons` allow public
`SELECT` (the UI needs the season countdown; constants aren't secret).
`play_accounts`, `play_market_states`, `play_trades`, `play_ledger` have
**zero policies** and are explicitly revoked from `anon` / `authenticated`
— server-side only. Every mutating function is `SECURITY DEFINER` with
`SET search_path = public, pg_temp` and `GRANT EXECUTE … TO service_role`
only.

---

## 4. Concurrency

Two mechanisms, both in `play_execute_trade`:

**1. Balance — a conditional single-statement debit.**

```sql
update play_accounts set balance_usd = balance_usd - stake
 where id = :account and balance_usd >= stake
returning ...;
-- zero rows => insufficient funds, transaction aborts
```

Postgres row locking makes read-check-write atomic. Two simultaneous
all-ins: exactly one matches. No advisory lock, no version column, no
retry loop.

**2. Market state — `SELECT … FOR UPDATE`.**

Serializes supply and pool mutation per market, so the authoritative
re-quote under the lock always sees the true current supply. The client's
quote is ignored entirely — a stale quote yields a slightly different
fill, never a corrupted state.

---

## 5. Seasons, grants and P&L attribution

**Weekly boundary: Monday 00:00:00 UTC.** `date_trunc('week', …)` uses the
ISO week, which starts Monday — exact, not approximate.

**Daily grant: $10,000 per UTC day, on first touch.** No retroactive
grants — a user who doesn't play Tuesday never receives Tuesday's money.
Applied automatically at the start of `play_execute_trade` and on
`/api/play/account` and `/api/play/state`.

**Trades are stamped with `season_id` and `trade_date` at trade time and
these never change.**

### A trade that resolves after a season boundary

| | Where it goes |
|---|---|
| Realized P&L | the season the trade was **placed** in |
| Payout money | the account's **current** balance |
| Ledger row | the season in which the money **moved** |

User-facing: *"Your winnings always land in your bankroll. The scoreboard
credit goes to the week you made the call."*

**Rollover resets the bankroll only.** Market states (odds), trades and
ledger history are all preserved, and open positions remain fully
settleable. Manual/admin-triggered for Phase 1 — **no Vercel cron is
registered**. The RPC is a no-op unless the open season's `ends_at` is
actually in the past, so an accidental call can't wipe a live week.

---

## 6. API routes

All Play routes are `POST` — including reads. A signature belongs in a
body, not in a URL that lands in access logs and browser history.

| Route | Auth | Notes |
|---|---|---|
| `POST /api/play/account` | signed wallet | ensure account + daily grant |
| `POST /api/play/state` | signed wallet | balance, season, open positions, optional market book |
| `POST /api/play/quote` | signed wallet | informational, writes nothing |
| `POST /api/play/trade` | signed wallet | atomic execution |
| `POST /api/play/history` | signed wallet | scoped server-side to the signer |
| `POST /api/play/settle` | **admin cookie** | manual settlement (operator tool) |
| `GET\|POST /api/play/season/rollover` | **admin cookie** | inspect / roll the season |

### Signed-wallet authentication

Reuses the ed25519 scheme already running in production for live-session
host actions (`app/src/app/api/live-sessions/[id]/status/route.ts`) — no
new dependency, no new concept for the frontend.

The client signs a canonical message with `signMessage()`:

```
FUNMARKET_PLAY|<action>|<part>|…|<ts>

account   FUNMARKET_PLAY|account|<ts>
state     FUNMARKET_PLAY|state|<ts>
history   FUNMARKET_PLAY|history|<ts>
quote     FUNMARKET_PLAY|quote|<market>|<outcome>|<stake>|<ts>
trade     FUNMARKET_PLAY|trade|<market>|<outcome>|<stake>|<client_trade_id>|<ts>
```

and posts `{ wallet, signature, ts, … }`. The server verifies
`nacl.sign.detached.verify` against the base58 public key with a 2-minute
drift window. **A wallet address in a body is never identity on its own.**

Action parameters are inside the signed message, so a signature
authorizing a $10 quote cannot be replayed as a $10,000 trade.

> ### ⚠️ Known limitation — must be fixed before public exposure
>
> There is no server-issued nonce, so a captured signature can be
> **replayed inside the 2-minute window**. This is contained today:
> `/api/play/trade` is bound to `client_trade_id` and the unique index
> makes a replay a no-op returning the original trade; every other route
> is a read. This matches the security level of the existing live-session
> routes.
>
> **A nonce table (issue → sign → consume) is required before Play Mode is
> exposed to the public.** Tracked as the Phase 1.5 hardening step.

---

## 7. Testing

```bash
psql "$DEV_DATABASE_URL" -f app/supabase/tests/20260721_play_mode_core_test.sql
```

The whole suite runs in one transaction and ends with `ROLLBACK`, so it
leaves the database exactly as it found it — including the two synthetic
`public.markets` rows it writes. Every check is a plpgsql `ASSERT`; the
script aborts on the first failure with the offending values.

| # | Covers |
|---|---|
| 1 | pricing round-trip, monotonicity, convexity |
| 2 | fresh markets open 50/50 and 33/33/33; state creation idempotent |
| 3 | account dedupe; daily grant idempotent (exactly one ledger row) |
| 4 | supplies, pool, odds movement, worsening consecutive fills |
| 5 | duplicate submit returns the original trade, moves no money |
| 6 | all-in works; overspend rejected atomically with no residue |
| 7 | expired / blocked / proposed / bad-index all rejected |
| 8 | pro-rata settlement, never mints value, idempotent across 3 calls |
| 9 | cancellation refunds exactly once at zero P&L |
| 10 | every balance reconciles against the ledger |
| 11 | rollover resets bankroll, preserves odds and open positions |
| 12 | no Play write reached any Real economic field |

Concurrency needs two sessions and cannot be expressed in one script — the
manual procedure is documented at the bottom of the test file.

---

## 8. Recommended Phase 2 settlement integration

**Not implemented in Phase 1.** When the engine has been exercised against
a real database:

1. At the end of `app/src/app/api/admin/market/approve/commit/route.ts`
   and `.../cancel/commit/route.ts` — after the existing Supabase update
   succeeds — call `settleMarket(market_address)`.
2. Wrap it in `try/catch` and log-only. **A Play failure must never block
   or fail a Real finalization.**
3. Add a sweeper (`/api/cron/play-settle`) over markets that are terminal
   but still have open Play trades, for anything that slips through.

Both commit routes are already service-role and already fire only after
on-chain confirmation, so they are the correct trigger point. Settlement
is idempotent, so the inline call and the sweeper are safe to both run.
