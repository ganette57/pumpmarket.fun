# Play Mode — Supabase **Development** validation guide

Manual runbook for validating the Play backend against the **Development**
Supabase project.

> **NOTHING IN THIS GUIDE HAS BEEN EXECUTED.** The environment the code was
> written in has no Postgres, Docker or Supabase CLI. Every SQL statement
> below is unrun. Treat the first execution as the real test — expect to
> find something.

**Never run any of this against Production.**

---

## 0. What you are applying

| | |
|---|---|
| Base migration | `app/supabase/migrations/20260721_play_mode_core.sql` |
| Follow-up migration | `app/supabase/migrations/20260722_play_settle_idempotent.sql` |
| Test suite | `app/supabase/tests/20260721_play_mode_core_test.sql` |
| API smoke test | `app/scripts/play-api-smoke.mjs` |
| Branch | `feat/play-real-mvp` |

**If Dev already has the base migration applied** (the 7 tables and 17
functions exist), you do **not** re-run the base file. Apply only the
follow-up — see §3.1. A brand-new database applies both, in filename
order; they end at the same function definition.

The migration is **additive and idempotent**. It creates `play_*` objects
only. It contains no `DROP`, no `ALTER` of any existing table, and every
reference to `public.markets` is a `SELECT`. Worst case on the wrong
database is unused empty tables — not data loss. That is a reason to stay
calm if you slip, **not** a reason to skip section 1.

---

## 1. Confirm you are on DEVELOPMENT, not PRODUCTION

Do all four. They are independent and cheap.

### 1.1 Check the project ref in the dashboard

Supabase → your **Dev** project → Settings → General. Note the
**Reference ID**. Your connection string must contain that same ref:

```
postgresql://postgres.<REF>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
                        ^^^^^ must match the DEV project ref
```

> Use port **5432** (session pooler) or the direct connection — **not**
> 6543. The transaction pooler is not appropriate for DDL and for the long
> single-transaction test suite.

### 1.2 Print the server's identity

```sql
select current_database()                              as db,
       current_user                                    as role,
       inet_server_addr()                              as server_ip,
       version()                                       as pg_version,
       current_setting('server_version_num')           as pg_version_num;
```

### 1.3 Row-count sanity check

```sql
select 'markets'      as t, count(*) from public.markets
union all select 'transactions', count(*) from public.transactions
union all select 'profiles',     count(*) from public.profiles
union all select 'live_sessions',count(*) from public.live_sessions;
```

**STOP** if these look like production volume. Your Dev project should
have far fewer rows. If you are unsure which is which, you are not ready
to run the migration.

### 1.4 Tripwire — abort automatically if this looks like Production

Edit the threshold to something above your Dev row count and below
Production's, then run it. It commits nothing.

```sql
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.markets;
  IF n > 500 THEN          -- <-- set this for YOUR data
    RAISE EXCEPTION
      'ABORT: % market rows looks like PRODUCTION. Refusing to proceed.', n;
  END IF;
  RAISE NOTICE 'OK: % market rows — consistent with Development.', n;
END $$;
```

---

## 2. Dry-run the migration (commits nothing)

Postgres DDL is transactional, so you can prove the whole migration parses
and executes without persisting a single object. **Do this first.**

```bash
cd app

psql "$DEV_DATABASE_URL" \
  --single-transaction \
  --set ON_ERROR_STOP=1 \
  -f supabase/migrations/20260721_play_mode_core.sql \
  -c "ROLLBACK;"
```

Or explicitly:

```bash
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
\i supabase/migrations/20260721_play_mode_core.sql
ROLLBACK;
SQL
```

**Expected:** a stream of `CREATE TABLE` / `CREATE INDEX` / `CREATE
FUNCTION` / `GRANT` notices, one row from the final
`select public.play_current_season();`, then `ROLLBACK`.

**If it errors**, nothing was created — fix the SQL and repeat. This is the
step most likely to surface a defect, since the file has never run.

Confirm nothing persisted:

```sql
select count(*) from information_schema.tables
 where table_schema = 'public' and table_name like 'play\_%';
-- expected: 0
```

---

## 3. Apply the migration for real

```bash
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260721_play_mode_core.sql
```

> The Supabase **web SQL Editor** cannot run `\i` or `\set`. If you must
> use it, paste the file contents directly and delete any `\`-prefixed
> lines. `psql` is strongly preferred.

---

## 3.1 Apply the settlement-idempotency fix to an already-migrated Dev

Dev already has the base migration installed, so it also has the **old**
`play_settle_market`. Replace it with the follow-up migration. It is a
single `create or replace function` plus its `grant` — additive, touches
no table, and is safe to run any number of times.

```bash
cd app
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260722_play_settle_idempotent.sql
```

Web SQL Editor alternative: open the file, paste its contents, run. It has
no `\`-prefixed lines, so it pastes cleanly.

Confirm the new definition is in place (the fixed body contains the guard):

```sql
select pg_get_functiondef('public.play_settle_market(text)'::regprocedure)
       like '%IDEMPOTENCY GUARD%' as has_fix;
-- expected: t
```

This does **not** disturb any already-settled market: it only redefines
the function. Existing `play_market_states`, `play_trades` and
`play_ledger` rows are untouched.

---

## 4. Verify the schema landed correctly

### 4.1 Tables — expect exactly 7

```sql
select table_name
  from information_schema.tables
 where table_schema = 'public' and table_name like 'play\_%'
 order by table_name;
```

Expected: `play_accounts`, `play_auth_nonces`, `play_ledger`,
`play_market_states`, `play_seasons`, `play_settings`, `play_trades`.

### 4.2 Functions — expect 17

```sql
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       case when p.prosecdef then 'SECURITY DEFINER' else 'invoker' end as secdef,
       p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'play\_%'
 order by p.proname;
```

Expected: `play_assert_market_tradable`, `play_consume_nonce`,
`play_cost_for_shares`, `play_current_season`, `play_ensure_account`,
`play_ensure_daily_grant`, `play_ensure_market_state`, `play_implied_probs`,
`play_issue_nonce`, `play_market_outcome_count`, `play_normalize_wallet`,
`play_quote`, `play_rollover_season`, `play_settle_market`,
`play_shares_for_stake`, `play_week_start`, `play_execute_trade`.

Every data-touching function must show `SECURITY DEFINER` and a
`proconfig` containing `search_path=public, pg_temp`.

### 4.3 RLS — enabled everywhere; policies only on settings + seasons

```sql
select c.relname, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname='public' and p.tablename=c.relname) as policies
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname like 'play\_%' and c.relkind='r'
 order by c.relname;
```

Expected: **`rls_enabled = true` on all 7.** `policies = 1` for
`play_settings` and `play_seasons`; **`policies = 0`** for `play_accounts`,
`play_auth_nonces`, `play_ledger`, `play_market_states`, `play_trades`.

### 4.4 Anon must have no access to the money tables

```sql
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee in ('anon','authenticated') and table_name like 'play\_%'
 order by table_name, privilege_type;
```

Expected: **only** `SELECT` on `play_settings` and `play_seasons`. Any row
naming `play_accounts`, `play_ledger`, `play_trades`, `play_market_states`
or `play_auth_nonces` is a failure — stop and fix before going further.

```sql
select p.proname, array_agg(distinct a.rolname order by a.rolname) as can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral (
    select r.rolname from pg_roles r
     where has_function_privilege(r.rolname, p.oid, 'EXECUTE')
       and r.rolname in ('anon','authenticated','service_role')
  ) a
 where n.nspname='public' and p.proname like 'play\_%'
 group by p.proname order by p.proname;
```

Expected: `play_execute_trade`, `play_settle_market`, `play_quote`,
`play_ensure_*`, `play_issue_nonce`, `play_consume_nonce`,
`play_rollover_season` → **`{service_role}` only**. The pure-math helpers
(`play_cost_for_shares`, `play_shares_for_stake`, `play_implied_probs`,
`play_normalize_wallet`, `play_week_start`) may include anon.

### 4.5 Settings and seeded season

```sql
select * from public.play_settings;
-- expect exactly one row, id=1:
--   initial_supply_per_outcome = 5000
--   base_price_usd             = 1.00000000
--   slope_usd_per_share        = 0.00020000
--   daily_grant_usd            = 10000.00
--   max_outcomes               = 10

select id, starts_at, ends_at, status,
       extract(dow from starts_at at time zone 'UTC') as start_dow,
       ends_at - starts_at as length
  from public.play_seasons order by id;
-- expect exactly one row, status='open', start_dow=1 (Monday), length=7 days
```

### 4.6 Constraints and indexes

```sql
select conrelid::regclass as tbl, conname, contype
  from pg_constraint
 where connamespace='public'::regnamespace
   and conrelid::regclass::text like 'play\_%'
 order by 1,2;

select tablename, indexname, indexdef
  from pg_indexes
 where schemaname='public' and tablename like 'play\_%'
 order by tablename, indexname;
```

Must be present:
- `play_ledger` unique on `(account_id, idempotency_key)`
- `play_trades` unique on `(account_id, client_trade_id)`
- `play_market_states` unique on `(market_address)`
- `play_accounts` unique on `wallet_address`, partial unique on `privy_user_id`
- `play_seasons` exclusion `play_seasons_no_overlap` **or** the fallback
  partial unique `play_seasons_single_open_idx`

---

## 5. Verify no Real table was altered

Run **before** the migration and again **after**, then diff the two outputs.

```sql
-- Column-level fingerprint of every Real table Play reads or is near.
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema='public'
   and table_name in ('markets','transactions','profiles','live_sessions',
                      'bookmarks','fun_points_accounts','fun_points_ledger',
                      'referrals')
 order by table_name, ordinal_position;
```

```sql
-- Row counts must be identical before and after.
select 'markets' t, count(*) from public.markets
union all select 'transactions', count(*) from public.transactions
union all select 'profiles',     count(*) from public.profiles
union all select 'fun_points_accounts', count(*) from public.fun_points_accounts;
```

```sql
-- No trigger or FK was added pointing at a Real table from play_*.
select conrelid::regclass as from_tbl, confrelid::regclass as to_tbl, conname
  from pg_constraint
 where contype='f'
   and (conrelid::regclass::text like 'play\_%'
        or confrelid::regclass::text like 'play\_%')
 order by 1,2;
-- expect: every row has BOTH sides in play_*. Nothing may reference
-- markets / transactions / profiles.
```

```sql
-- Economic fields on markets are untouched by Play.
select coalesce(sum(total_volume),0) as total_volume_sum,
       coalesce(sum(yes_supply),0)   as yes_supply_sum,
       coalesce(sum(no_supply),0)    as no_supply_sum
  from public.markets;
-- identical before and after the migration AND after all Play testing
```

---

## 6. Run the SQL test suite

```bash
cd app
psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/20260721_play_mode_core_test.sql
```

The suite opens its own transaction and ends with `ROLLBACK`, so it leaves
the database exactly as it found it — including the three synthetic
`public.markets` fixture rows it inserts.

### Expected output

```
PASS 1 — pricing primitives round-trip and are monotonic/convex
PASS 2 — fresh markets open evenly and state creation is idempotent
PASS 3 — account creation dedupes and the daily grant is idempotent
PASS 3B — nonces are single-use, wallet-bound, TTL-checked and capped
PASS 4 — supplies, pool, odds and fills behave correctly
PASS 5 — duplicate submit returns the original trade and moves no money
PASS 6 — all-in works, overspend is rejected atomically
PASS 7 — expired / blocked / proposed / bad-index all rejected
PASS 8 — pro-rata settlement is a true no-op on repeat (version/updated_at/meta/ledger/balances frozen)
PASS 8B — no-winner markets refund in full, drain the pool, stay idempotent
PASS 9 — cancellation refunds once and is a true no-op on repeat
PASS 10 — every balance reconciles against the ledger
PASS 11 — rollover resets bankroll, preserves odds and open positions
PASS 12 — no Play write reached any Real economic field
=====================================================
ALL PLAY ENGINE TESTS PASSED
  accounts=N trades=N ledger=N market_states=N
Rolling back — the database is left untouched.
=====================================================
ROLLBACK
```

Any `ASSERT` failure aborts immediately with the offending values in the
message and rolls the whole thing back. Nothing is left behind either way.

Confirm it left no residue:

```sql
select (select count(*) from public.play_accounts)      as accounts,
       (select count(*) from public.play_trades)        as trades,
       (select count(*) from public.play_market_states) as states,
       (select count(*) from public.markets
         where market_address like 'PLAYTEST%')         as fixture_rows;
-- expect 0, 0, 0, 0
```

### If a fixture INSERT fails

The fixtures use the minimum `markets` column set observed in
`app/src/lib/markets.ts::indexMarket`. If your `markets` table has extra
`NOT NULL` columns without defaults, add them to **all three** INSERTs at
the top of the test file.

---

## 7. Concurrency check (two psql sessions)

Not expressible in one script. Open two terminals.

```sql
-- Session A                             -- Session B
BEGIN;
select play_execute_trade(
  'WALLET_A','MARKET_X',0,10000,'a1');
                                         BEGIN;
                                         select play_execute_trade(
                                           'WALLET_A','MARKET_X',0,10000,'b1');
                                         -- blocks on A's market-state row lock
COMMIT;
                                         -- unblocks, then FAILS:
                                         -- "insufficient balance"
                                         ROLLBACK;
```

Expected: exactly one $10,000 all-in succeeds. The conditional
`UPDATE ... WHERE balance_usd >= stake` matches zero rows for the loser.

---

## 8. Environment variable required for the Play session

```bash
PLAY_SESSION_SECRET=<random string, at least 32 characters>
```

Generate one:

```bash
openssl rand -hex 32
```

- Deliberately **separate** from `ADMIN_SESSION_SECRET` — a leaked Play key
  must never be able to mint an admin session.
- Server-only. **Do not** prefix with `NEXT_PUBLIC_`.
- Rotating it invalidates every existing Play session (users sign again).
- Without it, every Play route returns 500 with
  `Missing env: PLAY_SESSION_SECRET`.

Set it in `.env.local` for local dev and in the Vercel **Preview**
environment for the Dev deployment. Existing Supabase vars
(`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are already required and must
point at the **Dev** project.

---

## 9. API test steps

### 9.1 Automated — nonce, verify, state, quote, trade, history

```bash
cd app
npm run dev        # terminal 1

# terminal 2 — pick an open market from the Dev database first:
#   select market_address from public.markets
#    where resolution_status='open' and coalesce(resolved,false)=false
#      and coalesce(is_blocked,false)=false and end_date > now() limit 1;

node scripts/play-api-smoke.mjs --market <MARKET_ADDRESS>
```

Generates a throwaway ed25519 keypair (Solana wallets are ed25519, so it
signs exactly like Phantom) and asserts:

| # | Covers |
|---|---|
| 1 | `/state` without a session → 401 |
| 2 | `/auth/nonce` returns nonce + message + expiry |
| 3 | bad signature → 403, **and burns the nonce** (good signature after → 401) |
| 4 | `/auth/verify` → 200, account created, $10,000 granted, `HttpOnly` + `SameSite=Lax` cookie set; replayed nonce → 401 |
| 5 | `/state` → balance (single daily grant, **no second grant**), season, open trades. `/state` does **not** create the Play market state |
| 6 | `/quote` → shares, odds before/after, estimated payout; **ensures the market state but moves no money and creates no trade** (verified by a follow-up `/state`) |
| 7 | `/trade` → 201; balance debited by exactly the stake; **double submit → 200 `replayed:true`, same trade id, no money moved** |
| 8 | a `wallet` field in the body is **ignored** — identity is session-only |
| 9 | `/history` → our trade appears exactly once with `season_id` + `trade_date` |
| 10 | overspend → 400, balance unchanged |
| 11 | `/auth/logout` clears the cookie |

It refuses to run against anything but localhost.

It prints cleanup SQL for the account it created — run that on Dev when
you're done.

### 9.2 Manual — settlement and rollover (admin cookie required)

Sign in at `/admin/login` with the admin wallet + password, then copy the
`admin_session` cookie from DevTools.

**Settlement.** First push a market to a terminal state on Dev:

```sql
-- pick a market that has open Play trades
select market_address, count(*) from public.play_trades
 where status='open' group by 1;

update public.markets
   set resolution_status='finalized', winning_outcome=0, resolved=true
 where market_address='<MARKET_ADDRESS>';
```

```bash
curl -sS -X POST http://localhost:3000/api/play/settle \
  -H 'Content-Type: application/json' \
  -H 'Cookie: admin_session=<ADMIN_SESSION_COOKIE>' \
  -d '{"market_address":"<MARKET_ADDRESS>"}' | jq
```

**First call** (moves the money):

```json
{ "settled": true, "already_settled": false, "reason": "pro_rata",
  "winning_outcome": 1, "trades_settled": 3,
  "final_pool_usd": "1900.00", "paid_out_usd": "1900.00", "dust_usd": "0.00" }
```

Expect `already_settled:false`, `trades_settled > 0`,
`paid_out_usd <= final_pool_usd`, `dust_usd >= 0`.

**Run it twice more — it must be a TRUE no-op.** The 2nd and 3rd calls
return:

```json
{ "settled": true, "already_settled": true, "reason": "pro_rata",
  "winning_outcome": 1, "final_pool_usd": "1900.00",
  "original_paid_out_usd": "1900.00", "original_trades_settled": 3,
  "trades_settled": 0, "paid_out_usd": 0,
  "settlement_meta": { "reason": "pro_rata", ... } }
```

Read the schema carefully — the two groups mean different things:

| Field | Meaning |
|---|---|
| `trades_settled`, `paid_out_usd` | what **THIS** invocation moved — always `0` on a repeat |
| `reason`, `winning_outcome`, `final_pool_usd`, `original_paid_out_usd`, `original_trades_settled`, `settlement_meta` | the **ORIGINAL** settlement, read from persisted state |

A repeat call reports the original `reason` (`pro_rata` here) — **not** a
recomputed one. Verify with SQL that the market state did not move:

```sql
select version, updated_at, settlement_meta->>'reason' as reason,
       settlement_meta->>'paid_out_usd' as original_paid_out
  from public.play_market_states
 where market_address = '<MARKET_ADDRESS>';
-- version and updated_at MUST be identical before and after the repeat
-- calls; settlement_meta MUST still describe the first settlement.

select count(*) from public.play_ledger;   -- unchanged across repeats
```

**No-winning-positions path** — finalize on an outcome nobody bought:

```sql
update public.markets
   set resolution_status='finalized', winning_outcome=<UNBACKED_OUTCOME>, resolved=true
 where market_address='<MARKET_ADDRESS>';
```

Expect `reason:"no_winning_positions"`, `refunded_all:true`,
`total_winning_shares:0`, every trade `refunded` at `payout = stake` with
`realized_pnl_usd = 0`, and `market_state.virtual_pool_usd = "0.00"`.

**Cancellation:**

```sql
update public.markets set resolution_status='cancelled'
 where market_address='<MARKET_ADDRESS>';
```

Expect `reason:"cancelled"`, all trades `refunded`, pool drained to 0.

**Season rollover:**

```bash
# inspect
curl -sS http://localhost:3000/api/play/season/rollover \
  -H 'Cookie: admin_session=<ADMIN_SESSION_COOKIE>' | jq

# no-op while the season is still live (this is the safety property)
curl -sS -X POST http://localhost:3000/api/play/season/rollover \
  -H 'Cookie: admin_session=<ADMIN_SESSION_COOKIE>' | jq
# expect: {"rolled": false, "reason": "current season has not ended yet"}
```

To exercise a real rollover on Dev, expire the season first:

```sql
update public.play_seasons set ends_at = now() - interval '1 second'
 where status = 'open';
```

Then POST again. Expect `rolled:true`, a new `season_id`, balances zeroed,
`season_reset` ledger rows written, and — critically — **open trades still
open with their original `season_id`, and market odds unchanged**:

```sql
select id, status, season_id from public.play_trades where status='open';
select market_address, virtual_pool_usd, outcome_supplies
  from public.play_market_states;
```

### 9.3 Post-API reconciliation

```sql
-- every balance must equal the sum of its ledger
select a.id, a.wallet_address, a.balance_usd,
       coalesce(sum(l.amount_usd),0) as ledger_sum
  from public.play_accounts a
  left join public.play_ledger l on l.account_id = a.id
 group by a.id, a.wallet_address, a.balance_usd
having a.balance_usd <> coalesce(sum(l.amount_usd),0);
-- expect: 0 rows
```

---

## 10. Rollback

### 10.1 During the dry run (section 2)

Nothing to do — the transaction rolled back.

### 10.2 After applying, before any data you care about

The migration is additive, so a full teardown is safe and touches no Real
table:

```sql
BEGIN;

drop function if exists public.play_rollover_season();
drop function if exists public.play_settle_market(text);
drop function if exists public.play_execute_trade(text, text, integer, numeric, text);
drop function if exists public.play_quote(text, text, integer, numeric);
drop function if exists public.play_assert_market_tradable(text);
drop function if exists public.play_ensure_market_state(text);
drop function if exists public.play_market_outcome_count(text);
drop function if exists public.play_consume_nonce(text, text);
drop function if exists public.play_issue_nonce(text, text, integer);
drop function if exists public.play_ensure_daily_grant(uuid);
drop function if exists public.play_ensure_account(text);
drop function if exists public.play_current_season();
drop function if exists public.play_week_start(timestamptz);
drop function if exists public.play_normalize_wallet(text);
drop function if exists public.play_implied_probs(numeric[]);
drop function if exists public.play_shares_for_stake(numeric, numeric, numeric, numeric);
drop function if exists public.play_cost_for_shares(numeric, numeric, numeric, numeric);

drop table if exists public.play_ledger        cascade;
drop table if exists public.play_trades        cascade;
drop table if exists public.play_market_states cascade;
drop table if exists public.play_auth_nonces   cascade;
drop table if exists public.play_accounts      cascade;
drop table if exists public.play_seasons       cascade;
drop table if exists public.play_settings      cascade;

-- Confirm nothing Real was touched, THEN commit.
select count(*) as remaining_play_tables
  from information_schema.tables
 where table_schema='public' and table_name like 'play\_%';

COMMIT;   -- or ROLLBACK if the count above is not 0
```

Order matters: `play_ledger` → `play_trades` → the rest, because of the
foreign keys. `cascade` handles it regardless.

### 10.3 Partial failure mid-migration

`psql -v ON_ERROR_STOP=1` without `--single-transaction` may leave some
objects created. Run the teardown in 10.2, then re-apply from the top. The
migration is idempotent (`if not exists` / `create or replace`), so
re-running over a partial state is also safe.

### 10.4 Git rollback of the integration

```bash
cd /Users/gaetleo/pumpmarket.fun
git reset --hard 7ac492dd     # feat/play-real-mvp back to its pre-Play state
```

Nothing was pushed, so this is purely local. The work also remains on
`claude/session-ea219e`.

---

## 11. Sign-off checklist

- [ ] Confirmed Dev project ref (§1.1) and row counts (§1.3)
- [ ] Tripwire passed (§1.4)
- [ ] Dry run committed nothing (§2)
- [ ] Migration applied (§3)
- [ ] 7 tables, 17 functions, RLS on all, policies only on settings/seasons (§4)
- [ ] Anon has no access to money tables (§4.4)
- [ ] Settings = approved constants; one open season starting Monday UTC (§4.5)
- [ ] Real schema fingerprint + row counts identical before/after (§5)
- [ ] SQL suite: all PASS, left no residue (§6)
- [ ] Concurrency: exactly one all-in wins (§7)
- [ ] `PLAY_SESSION_SECRET` set on Dev (§8)
- [ ] API smoke test: all PASS (§9.1)
- [ ] Settlement idempotent ×3; no-winner refunds; cancellation refunds (§9.2)
- [ ] Rollover no-ops while live; preserves open trades and odds (§9.2)
- [ ] Ledger reconciles (§9.3)
- [ ] `markets` economic sums unchanged after all testing (§5)
