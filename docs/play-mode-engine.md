# Play Mode — Phase 1 engine

Isolated virtual-USD economy running alongside Real Mode. Backend only:
nothing in this phase is wired to the feed, Quick Buy, TradingPanel,
dashboard or leaderboard.

- Migration: `app/supabase/migrations/20260721_play_mode_core.sql`
- Tests: `app/supabase/tests/20260721_play_mode_core_test.sql`
- Server libs: `app/src/lib/playEngine.ts`, `app/src/lib/playAuth.ts`
- Routes: `app/src/app/api/play/**` (incl. `auth/{nonce,verify,logout}`)

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

Every `public.markets` reference in the migration is a `SELECT` (verified
by grep, not by intent). Play money never leaves the `play_*` tables, and
Phase 1 modified zero pre-existing files — the whole diff is new
`play_*` / `api/play/**` files.

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

### No-winning-positions rule (locked)

If a market finalizes on a valid outcome but **no user holds any Play
shares on it** — everybody backed a loser — there is nobody to pay
pro-rata. Rather than strand the pool, the whole market refunds:

| | |
|---|---|
| every open trade | → `refunded` |
| `payout_usd` | = `stake_usd` (exactly) |
| `realized_pnl_usd` | = `0` |
| ledger | one idempotent `trade_refund` row per trade |
| pool | drains to **$0.00** — `SUM(refunds) == SUM(stakes) == pool` |
| state status | **`finalized`**, not `cancelled` — the Real market did resolve |
| `settlement_meta.reason` | `"no_winning_positions"` |
| repeat calls | credit exactly zero |

Seed supply is **never** counted as a user-owned winning share: both the
zero test and the payout denominator read `play_trades`, never
`play_market_states.outcome_supplies`.

`settlement_meta` records only the **first** settlement, so a repeat call
cannot overwrite the audit trail of the run that moved the money.

This is Play-only. Real settlement, claims, refunds and resolution are
untouched — on-chain, `claim_winnings` still simply requires
`user_shares > 0`.

`settle_reason` is one of `pro_rata`, `cancelled`, `no_winning_positions`,
and is returned by `play_settle_market` alongside `no_winning_positions`
and `refunded_all` booleans.

---

## 3. Schema

Six tables. **No `play_positions`** — Play has no sell, partial close or
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
| `play_auth_nonces` | single-use sign-in challenges (see §6) |

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

Enabled on all seven tables. `play_settings` and `play_seasons` allow public
`SELECT` (the UI needs the season countdown; constants aren't secret).
`play_accounts`, `play_market_states`, `play_trades`, `play_ledger`,
`play_auth_nonces` have **zero policies** and are explicitly revoked from `anon` / `authenticated`
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

## 6. Authentication — one signature per session

**The wallet signs exactly once, at sign-in.** Every subsequent Play call
resolves its identity from an httpOnly session cookie. Nothing in the
trading path can ever trigger a Phantom prompt.

This matters for product, not just security: `/api/play/quote` fires on
every keystroke in the amount field. A per-request signature would make
Play unusable.

### The flow

```
 1. POST /api/play/auth/nonce   { wallet }
        -> { nonce, message, expires_at }
        server stores a single-use, wallet-bound challenge (TTL 5 min)

 2. wallet.signMessage(message)          ← the ONE Phantom prompt

 3. POST /api/play/auth/verify  { wallet, nonce, signature }
        -> consumes the nonce ATOMICALLY (single-use)
        -> rebuilds the message from its OWN stored nonce
        -> verifies ed25519
        -> ensures the Play account + daily grant
        -> Set-Cookie: play_session=v1.<wallet>.<exp>.<hmac>
                       HttpOnly; SameSite=Lax; Secure(prod); Path=/;
                       Max-Age=7d

 4. everything else             reads the cookie. No signature. No prompt.

 5. POST /api/play/auth/logout  clears the cookie
```

The signed message is human-readable and contains only the wallet and the
nonce:

```
FunMarket Play — Sign in

Wallet: <wallet>
Nonce: <nonce>

This signature proves you control this wallet.
It is not a transaction and will not move any funds.
```

No timestamp or expiry is embedded on purpose: the nonce already carries
a server-side TTL and is single-use, so a formatted date would add
nothing but a class of "client and server serialized it differently"
verification failures. `playSignInMessage()` is exported so the client
builds the identical string, and the server always rebuilds it from its
own stored nonce.

### Routes

| Route | Auth |
|---|---|
| `POST /api/play/auth/nonce` | none — *is* the start of auth |
| `POST /api/play/auth/verify` | wallet signature over the nonce |
| `POST /api/play/auth/logout` | none (clears the cookie) |
| `POST /api/play/state` | **play_session cookie** |
| `POST /api/play/quote` | **play_session cookie** |
| `POST /api/play/trade` | **play_session cookie** |
| `POST /api/play/history` | **play_session cookie** |
| `POST /api/play/settle` | **admin cookie** (unchanged) |
| `GET\|POST /api/play/season/rollover` | **admin cookie** (unchanged) |

All `POST`, including reads — request data belongs in a body, not in a
URL that lands in access logs and browser history.

**`state`, `quote`, `trade` and `history` never read a wallet address
from the request body.** The wallet comes from the HMAC-signed session
token and nowhere else, so a caller cannot trade against, or read, another
wallet's account by editing a request. `/api/play/account` was removed —
its job is now `/api/play/auth/verify`.

### Replay and expiry

| Control | Mechanism |
|---|---|
| Nonce single-use | `play_consume_nonce` conditional `UPDATE … WHERE consumed_at IS NULL` — two concurrent redemptions race on one row, only one wins |
| Nonce wallet binding | `AND wallet_address = …` in the same statement |
| Nonce TTL | `AND expires_at > now()`, 5 minutes, clamped server-side to 30–900 s |
| Nonce farming | `play_issue_nonce` caps outstanding live challenges at 5 per wallet |
| Nonce table growth | rows older than 1 h are swept on each issue — no cron needed |
| Session expiry | signed into the token as `exp` and checked server-side; the cookie's `Max-Age` is a client-side hint and is never trusted |
| Session forgery | HMAC-SHA256 over `v1.<wallet>.<exp>` with `PLAY_SESSION_SECRET`, compared with `timingSafeEqual` |
| Trade idempotency | unchanged — `client_trade_id` + unique `(account_id, client_trade_id)` |

**Verify consumes the nonce *before* checking the signature.** Deliberate:
a stolen or guessed challenge gets exactly one attempt. The cost is that a
failed signature burns the challenge and the client must request a fresh
one — the right trade for an auth path.

### Required environment variable

```
PLAY_SESSION_SECRET=<random string, >= 32 chars>
```

Deliberately separate from `ADMIN_SESSION_SECRET`: a leaked Play key must
never be able to mint an admin session, or vice versa. The Play routes
return 500 with a clear message if it is unset.

> **Remaining limitation (acceptable for a wallet-only internal beta).**
> The session token is a stateless HMAC, so `logout` expires the browser's
> copy but does not revoke the token server-side — a copy captured before
> logout stays valid until its `exp`. Upgrade path if needed: a session
> table, or a per-account token epoch bumped on logout. Not required for
> the internal beta and not built.

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
| 3B | nonces: single-use, wallet-bound, TTL, outstanding cap |
| 4 | supplies, pool, odds movement, worsening consecutive fills |
| 5 | duplicate submit returns the original trade, moves no money |
| 6 | all-in works; overspend rejected atomically with no residue |
| 7 | expired / blocked / proposed / bad-index all rejected |
| 8 | pro-rata settlement, never mints value, idempotent across 3 calls |
| 8B | no-winner market: full refund, pool drains, meta preserved, 3x idempotent |
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

---

## 9. Odds calibration — simulation findings

```bash
node app/scripts/play-odds-simulation.mjs            # full report
node app/scripts/play-odds-simulation.mjs --show-sql # print the SQL it mirrors
node app/scripts/play-odds-simulation.mjs --seed 20000 --slope 0.0001
```

Standalone: no Supabase, no network, no dependencies, no production
imports. **It changes nothing and recommends only.**

### How it stays aligned with the SQL

1. **Constants are parsed out of the migration**, never retyped — it reads
   the `play_settings` `DEFAULT` clauses from the `.sql` file and hard-fails
   if it can't find them. It cannot silently simulate stale numbers.
2. **`--show-sql` prints the actual SQL bodies** of `play_cost_for_shares`
   and `play_shares_for_stake` for side-by-side review.
3. **Arithmetic is exact decimal**, not float64 — fixed-point on `BigInt`
   at 18 dp with an integer Newton `sqrt`, applying the same `trunc(x, 8)`
   for shares and `trunc(x, 2)` for money that the SQL does.
4. `selfCheck()` asserts the invariants the SQL also guarantees and exits
   non-zero on drift.

The algebra itself is restated once, with the SQL lines quoted directly
above each function.

### Results at the current constants (seed 5000, base $1.00, slope $0.0002)

**Single trade into a fresh binary book:**

| Stake | Shares | Odds after | Move |
|---|---|---|---|
| $100 | 49.88 | 50.24% | +0.24 pts |
| $500 | 246.95 | 51.20% | +1.20 pts |
| $1,000 | 488.09 | 52.32% | +2.32 pts |
| $5,000 | 2,247.45 | 59.17% | +9.17 pts |
| $10,000 (all-in) | 4,142.14 | **64.64%** | **+14.64 pts** |

**Depth:** at 100 users × $500 on one side the book reaches 79.58% and the
100th buyer gets 41% of the shares the first did. The curve stays usable —
it never goes vertical or flat.

**Multi-outcome** books open exactly even (33.33% / 25.00%) and are *less*
sensitive per dollar, because the stake is measured against `n × seed`.

### ⚠️ Finding: displayed odds are a damped view of sentiment

At a steady 60/40 money split the book displays ~52% → ~55% as volume
grows, converging near **56%, not 60%**. At 80/20 it displays **65.5%**.
Two effects stack:

- **seed dilution** — the seed pulls thin books toward 50/50. This *fades*
  as the pool grows.
- **slope compression** — each extra dollar on the popular side buys fewer
  shares, so share-share never equals money-share. This **does not fade**.

Consequence: a trader reading "55%" expects ~1.82x but is paid ~1.67x,
because payout is parimutuel on the pool while the displayed number is
supply-weighted including the seed.

This is inherent to the model, not a bug, and it is invisible until the UI
shows a payout estimate next to a percentage. **The Play UI should show the
estimated payout multiple as the primary number and treat the percentage as
sentiment, or compute the displayed percentage from pool share instead of
supply share.** That is a Phase 2 UI decision, not a constants change.

### Recommendation

| Question | Answer |
|---|---|
| Suitable for internal beta? | **Yes — ship as-is.** |
| Can one user move odds too aggressively? | Borderline. A single all-in moves a fresh binary book **+14.6 pts**. Dramatic, but it is one full day's bankroll and the *second* all-in only adds 6.5 more, so it self-damps. |
| Do $100 / $500 trades feel responsive? | $500 → +1.20 pts: visible, not silly. **$100 → +0.24 pts, which rounds to no visible change at 0-decimal display.** Consider showing one decimal, or accept that $100 is a "small" bet. |
| Does the curve become unusable? | **No.** After 100 × $500 it is at 79.6% and still filling at 41% of the opening rate. Degrades smoothly. |

**No constants were changed.** If adjustment is wanted after internal
testing, two candidates — all figures below are **measured by re-running
the simulation**, not estimated:

| Config | seed | slope | $100 | $500 | $1,000 | all-in |
|---|---|---|---|---|---|---|
| **Current** | `5000` | `0.0002` | +0.24 | +1.20 | +2.32 | **+14.64** |
| **A — calmer whales** | `10000` | `0.0002` | +0.08 | +0.41 | +0.81 | **+6.57** |
| **B — punchier bets** | `2500` | `0.0004` | +0.49 | +2.32 | +4.35 | **+21.13** |

*(percentage points of odds movement on a fresh binary book)*

- **A** halves whale impact but makes ordinary trades nearly invisible —
  a $500 bet barely registers. Pick this only if one user swinging a live
  market turns out to be the bigger problem.
- **B** roughly doubles responsiveness across the board, at the cost of a
  single all-in moving the book **+21 pts**. Pick this if the feed feels
  static during live events.
- **Neither makes $100 visible at integer-percent display** (0.08 / 0.24 /
  0.49 pts all round to 0). That is a display-precision decision, not a
  constants one.

Reproduce any row with:

```bash
node app/scripts/play-odds-simulation.mjs --seed 2500 --slope 0.0004
```

**Awaiting explicit approval before changing seed supply, base price,
slope or grant amount.** The current values stand until then.
