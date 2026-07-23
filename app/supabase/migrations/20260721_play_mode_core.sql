-- =====================================================================
-- Play Mode — Phase 1: isolated virtual economy (core schema + engine)
-- =====================================================================
-- Creates a completely separate virtual-USD economy that lives alongside
-- Real Mode. Play reads shared market CONTENT (outcome count, status,
-- winning outcome, trading deadline) and never writes a single Real
-- economic field.
--
-- Apply via Supabase SQL Editor or:
--   psql "$DATABASE_URL" -f supabase/migrations/20260721_play_mode_core.sql
--
-- Additive and idempotent: safe to re-run. Drops nothing, alters no
-- existing table, touches no Fun Points / markets / transactions data.
--
-- ---------------------------------------------------------------------
-- REAL-MODE ISOLATION CONTRACT (enforced by convention + review)
-- ---------------------------------------------------------------------
-- Every function below reads public.markets with plain SELECT only.
-- No function in this file issues UPDATE/INSERT/DELETE against:
--   public.markets, public.transactions, public.profiles,
--   public.fun_points_*, public.referrals, public.live_sessions
-- Play money never leaves the play_* tables.
-- =====================================================================


-- =====================================================================
-- 0. SETTINGS — the single source of truth for every Play constant
-- =====================================================================
-- Changing these affects FUTURE pricing only. Existing play_market_states
-- keep the supplies they already accumulated; constants are not baked into
-- stored rows. See docs/play-mode-engine.md for the sensitivity table.
--
--   initial_supply_per_outcome
--     Virtual seed supply given to EVERY outcome when a market's Play
--     state is first created. Equal seeds => an even opening book
--     (2 outcomes ~50/50, 3 ~33/33/33, 4 ~25/25/25/25, ...).
--     HIGHER  => market is less sensitive, trades move the odds less.
--     LOWER   => market is more sensitive, the first trader dominates.
--
--   base_price_usd / slope_usd_per_share
--     price(supply) = base_price_usd + slope_usd_per_share * supply
--     Mirrors the Real linear curve's SHAPE in virtual dollars.
--     HIGHER slope => steeper curve => faster odds movement + worse fills.
--
--   With the defaults (seed 5000, base 1.00, slope 0.0002) on a fresh
--   2-outcome market: a $500 buy moves the book ~1.2 points, a $10,000
--   all-in moves it ~15 points.
-- =====================================================================

create table if not exists public.play_settings (
  id                          integer primary key default 1,
  initial_supply_per_outcome  numeric(28,8) not null default 5000,
  base_price_usd              numeric(18,8) not null default 1.00,
  slope_usd_per_share         numeric(18,8) not null default 0.0002,
  daily_grant_usd             numeric(18,2) not null default 10000.00,
  max_outcomes                integer       not null default 10,
  updated_at                  timestamptz   not null default now(),

  constraint play_settings_singleton check (id = 1),
  constraint play_settings_seed_pos  check (initial_supply_per_outcome > 0),
  constraint play_settings_base_pos  check (base_price_usd > 0),
  constraint play_settings_slope_nn  check (slope_usd_per_share >= 0),
  constraint play_settings_grant_pos check (daily_grant_usd > 0),
  -- Matches MAX_OUTCOMES in programs/funmarket-pump/src/lib.rs
  constraint play_settings_outcomes  check (max_outcomes between 2 and 10)
);

insert into public.play_settings (id) values (1) on conflict (id) do nothing;


-- =====================================================================
-- 1. SEASONS — weekly competition windows, Monday 00:00 UTC boundary
-- =====================================================================

create table if not exists public.play_seasons (
  id          integer generated always as identity primary key,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      text        not null default 'open',
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,

  constraint play_seasons_status_check check (status in ('open','closed')),
  constraint play_seasons_range_check  check (ends_at > starts_at)
);

-- No two seasons may cover the same instant. Enforced by the database,
-- not by application discipline.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'play_seasons_no_overlap'
  ) then
    execute $ddl$
      alter table public.play_seasons
        add constraint play_seasons_no_overlap
        exclude using gist (tstzrange(starts_at, ends_at) with &&)
    $ddl$;
  end if;
exception
  when undefined_object or feature_not_supported then
    -- btree_gist unavailable: fall back to a partial unique index that at
    -- least guarantees a single open season at any time.
    raise notice 'btree_gist unavailable; using single-open-season index instead';
end $$;

create unique index if not exists play_seasons_single_open_idx
  on public.play_seasons ((status)) where status = 'open';

create index if not exists play_seasons_window_idx
  on public.play_seasons (starts_at, ends_at);


-- =====================================================================
-- 2. ACCOUNTS — Play identity + authoritative available balance
-- =====================================================================
-- id is a UUID SURROGATE key on purpose. wallet_address is a secondary
-- unique identifier and privy_user_id is reserved for the future
-- migration. Because play_trades/play_ledger FK this uuid rather than a
-- wallet string, adopting Privy later is a column update, not a rewrite
-- of every child row.
-- =====================================================================

create table if not exists public.play_accounts (
  id              uuid primary key default gen_random_uuid(),
  wallet_address  text not null,
  privy_user_id   text,
  balance_usd     numeric(18,2) not null default 0,
  last_grant_date date,
  is_internal     boolean not null default false,
  is_eligible     boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint play_accounts_balance_nonneg check (balance_usd >= 0),
  -- Wallets are stored exactly as normalized by play_normalize_wallet():
  -- trimmed, case preserved (base58 is case-sensitive on Solana).
  constraint play_accounts_wallet_len check (
    char_length(wallet_address) between 32 and 64
  )
);

create unique index if not exists play_accounts_wallet_idx
  on public.play_accounts (wallet_address);

create unique index if not exists play_accounts_privy_idx
  on public.play_accounts (privy_user_id) where privy_user_id is not null;


-- =====================================================================
-- 3. MARKET STATES — the independent Play economy, one row per market
-- =====================================================================
-- SCOPE DECISION: GLOBAL PER MARKET, not per season.
--
-- Justification: a Play market state is the order book for a live
-- question. Resetting it at a Monday 00:00 season boundary would jump the
-- displayed odds of an in-flight market for reasons that have nothing to
-- do with the market — confusing for traders and unfair to positions
-- opened the previous week (which stay open until the market resolves).
-- Seasons scope the LEADERBOARD and the BANKROLL; they do not scope
-- market prices.
--
-- created_in_season_id is retained for audit only. It is never used to
-- filter or key this table.
-- =====================================================================

create table if not exists public.play_market_states (
  id                    uuid primary key default gen_random_uuid(),
  market_address        text not null,
  created_in_season_id  integer references public.play_seasons(id),
  outcome_count         integer not null,
  outcome_supplies      numeric(28,8)[] not null,
  virtual_pool_usd      numeric(18,2) not null default 0,
  status                text not null default 'open',
  version               bigint not null default 0,
  -- Why this market settled the way it did. Empty while open; on
  -- settlement it records at minimum {"reason": ...} so an operator can
  -- tell a normal pro-rata payout apart from a whole-market refund
  -- without re-deriving it from the trade rows.
  settlement_meta       jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  settled_at            timestamptz,

  constraint play_market_states_status_check
    check (status in ('open','finalized','cancelled')),
  constraint play_market_states_outcome_count_check
    check (outcome_count between 2 and 10),
  constraint play_market_states_pool_nonneg
    check (virtual_pool_usd >= 0),
  -- Supply array length must always match the declared outcome count.
  constraint play_market_states_supplies_len
    check (array_length(outcome_supplies, 1) = outcome_count)

  -- NOTE: "every supply >= 0" is deliberately NOT a CHECK constraint.
  -- Postgres forbids subqueries in CHECK, and there is no subquery-free
  -- way to test every element of an array. The invariant holds
  -- structurally instead: supplies are seeded positive and Play has no
  -- sell / partial close / transfer, so play_execute_trade only ever
  -- ADDS to a supply. If a sell is ever introduced, add a BEFORE
  -- INSERT/UPDATE trigger here at the same time.
);

create unique index if not exists play_market_states_market_idx
  on public.play_market_states (market_address);

create index if not exists play_market_states_open_idx
  on public.play_market_states (status) where status = 'open';


-- =====================================================================
-- 4. TRADES — immutable record of every virtual buy
-- =====================================================================
-- Also serves as the position ledger. Play has no sell / partial close /
-- cash-out, so a trade never changes size and a separate play_positions
-- table would add a denormalized copy with nothing to gain: settlement
-- aggregates via the partial index play_trades_settlement_idx below.
--
-- season_id and trade_date are stamped AT TRADE TIME and never change.
-- A trade that resolves after a season boundary keeps its original
-- season for P&L attribution; its payout is credited to the account's
-- CURRENT balance. See docs/play-mode-engine.md.
-- =====================================================================

create table if not exists public.play_trades (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.play_accounts(id),
  season_id        integer not null references public.play_seasons(id),
  trade_date       date not null,
  market_address   text not null,
  outcome_index    smallint not null,
  outcome_name     text,
  stake_usd        numeric(18,2) not null,
  shares           numeric(28,8) not null,
  entry_supply     numeric(28,8) not null,
  quoted_cost_usd  numeric(18,2) not null,
  status           text not null default 'open',
  payout_usd       numeric(18,2),
  realized_pnl_usd numeric(18,2),
  client_trade_id  text not null,
  created_at       timestamptz not null default now(),
  settled_at       timestamptz,

  constraint play_trades_status_check
    check (status in ('open','won','lost','refunded')),
  constraint play_trades_stake_pos   check (stake_usd > 0),
  constraint play_trades_shares_pos  check (shares > 0),
  constraint play_trades_outcome_idx check (outcome_index between 0 and 9),
  constraint play_trades_entry_nonneg check (entry_supply >= 0),
  -- Settled rows must carry both money fields; open rows must carry neither.
  constraint play_trades_settled_shape check (
    (status = 'open'  and payout_usd is null and realized_pnl_usd is null
                      and settled_at is null)
    or
    (status <> 'open' and payout_usd is not null and realized_pnl_usd is not null
                      and settled_at is not null)
  )
);

-- Idempotency: a replayed submit can never create a second trade.
create unique index if not exists play_trades_client_id_idx
  on public.play_trades (account_id, client_trade_id);

-- Account history (dashboard, /api/play/history)
create index if not exists play_trades_account_idx
  on public.play_trades (account_id, created_at desc);

-- Settlement sweep + open-position reads (partial: only live rows)
create index if not exists play_trades_settlement_idx
  on public.play_trades (market_address, status) where status = 'open';

-- Weekly leaderboard (partial: only settled rows carry P&L)
create index if not exists play_trades_season_pnl_idx
  on public.play_trades (season_id, account_id) where status <> 'open';

-- Daily leaderboard, by the UTC day the trade was PLACED
create index if not exists play_trades_daily_idx
  on public.play_trades (trade_date, account_id) where status <> 'open';


-- =====================================================================
-- 5. LEDGER — append-only audit trail for every balance mutation
-- =====================================================================
-- Invariant: for any account,
--   play_accounts.balance_usd = SUM(play_ledger.amount_usd)
-- Reconciliation query lives in supabase/tests/20260721_play_mode_core_test.sql
-- =====================================================================

create table if not exists public.play_ledger (
  id              bigserial primary key,
  account_id      uuid not null references public.play_accounts(id),
  season_id       integer references public.play_seasons(id),
  trade_id        uuid references public.play_trades(id),
  kind            text not null,
  amount_usd      numeric(18,2) not null,
  balance_before  numeric(18,2) not null,
  balance_after   numeric(18,2) not null,
  idempotency_key text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),

  constraint play_ledger_kind_check check (kind in (
    'daily_grant','trade_stake','trade_payout','trade_refund',
    'season_reset','manual_adjustment'
  )),
  constraint play_ledger_balance_nonneg check (
    balance_before >= 0 and balance_after >= 0
  ),
  constraint play_ledger_arithmetic check (
    balance_after = balance_before + amount_usd
  )
);

-- The single most important constraint in this migration. It is what makes
-- duplicate daily grants, double-submitted trades and repeated settlement
-- physically impossible rather than merely unlikely.
create unique index if not exists play_ledger_idempotency_idx
  on public.play_ledger (account_id, idempotency_key);

create index if not exists play_ledger_account_idx
  on public.play_ledger (account_id, created_at desc);

create index if not exists play_ledger_season_idx
  on public.play_ledger (season_id, kind);


-- =====================================================================
-- 6. ROW LEVEL SECURITY
-- =====================================================================
-- Phase 1: RLS enabled with ZERO policies on every table.
--
-- Effect: anon and authenticated roles can neither read nor write any
-- Play row through PostgREST. service_role bypasses RLS, so the Next.js
-- API routes (which use SUPABASE_SERVICE_ROLE_KEY) are the only path in.
--
-- play_seasons and play_settings get a public SELECT policy because the
-- UI will need "season ends in 3d" and the price constants are not
-- secret. Everything money-shaped stays closed.
-- =====================================================================

alter table public.play_settings      enable row level security;
alter table public.play_seasons       enable row level security;
alter table public.play_accounts      enable row level security;
alter table public.play_market_states enable row level security;
alter table public.play_trades        enable row level security;
alter table public.play_ledger        enable row level security;

drop policy if exists play_settings_read on public.play_settings;
create policy play_settings_read on public.play_settings for select using (true);

drop policy if exists play_seasons_read on public.play_seasons;
create policy play_seasons_read on public.play_seasons for select using (true);

-- play_accounts / play_market_states / play_trades / play_ledger:
-- intentionally NO policies. Server-side only.

revoke all on public.play_accounts      from anon, authenticated;
revoke all on public.play_market_states from anon, authenticated;
revoke all on public.play_trades        from anon, authenticated;
revoke all on public.play_ledger        from anon, authenticated;

grant select on public.play_settings to anon, authenticated;
grant select on public.play_seasons  to anon, authenticated;


-- =====================================================================
-- 7. PRICING PRIMITIVES
-- =====================================================================
-- THE authoritative Play pricing lives here and nowhere else. TypeScript
-- must never recreate these formulas — it may only format their output.
--
-- Relationship to the Real on-chain model
-- ---------------------------------------
-- Real (programs/funmarket-pump/src/lib.rs::linear_cost_lamports) prices a
-- whole number of shares as a discrete arithmetic series:
--     cost(q0, n) = n*BASE + SLOPE * n*(2*q0 + n - 1)/2
--
-- Play takes a DOLLAR amount and issues FRACTIONAL shares, so the correct
-- analogue is the continuous integral of the same linear price curve:
--     cost(q0, n) = INTEGRAL[q0 .. q0+n] (BASE + SLOPE*x) dx
--                 = n*BASE + SLOPE * n*(2*q0 + n)/2
--
-- The two differ only by the `-1` term, which exists purely because Real
-- sums over integer share indices. Same curve, same economics; the
-- discrete correction is meaningless when n is fractional. This is an
-- intentional, documented divergence — Real is NOT changed.
-- =====================================================================

-- Cost in virtual USD of buying `n_shares` starting from supply `q0`.
create or replace function public.play_cost_for_shares(
  q0_in       numeric,
  n_shares_in numeric,
  base_in     numeric,
  slope_in    numeric
)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when n_shares_in is null or n_shares_in <= 0 then 0::numeric
    else n_shares_in * base_in
       + slope_in * n_shares_in * (2 * q0_in + n_shares_in) / 2
  end;
$$;

-- Inverse: how many shares does `stake` buy starting from supply `q0`?
--
-- Solve for n:   (K/2)n^2 + (B + K*q0)n - S = 0
--   n = ( -(B + K*q0) + sqrt( (B + K*q0)^2 + 2*K*S ) ) / K
-- Degenerates to n = S/B when the slope is zero (flat price).
--
-- Truncated (not rounded) to 8 dp so the shares issued can never cost
-- more than the stake paid. The sub-cent remainder stays in the pool.
create or replace function public.play_shares_for_stake(
  q0_in    numeric,
  stake_in numeric,
  base_in  numeric,
  slope_in numeric
)
returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  b_eff numeric;
  disc  numeric;
  n_raw numeric;
begin
  if stake_in is null or stake_in <= 0 then
    return 0::numeric;
  end if;

  if slope_in = 0 then
    return trunc(stake_in / base_in, 8);
  end if;

  b_eff := base_in + slope_in * q0_in;
  disc  := b_eff * b_eff + 2 * slope_in * stake_in;

  if disc <= 0 then
    return 0::numeric;
  end if;

  n_raw := (sqrt(disc) - b_eff) / slope_in;

  if n_raw <= 0 then
    return 0::numeric;
  end if;

  return trunc(n_raw, 8);
end $$;

-- Implied probability of each outcome = supply_i / SUM(supply).
-- This is the same "share of supply" rule the Real UI already renders
-- as cents, so Play odds read identically even though the books differ.
-- WITH ORDINALITY + ORDER BY is required: bare unnest() in a subquery has
-- no guaranteed output order, and here the array position IS the outcome
-- index. Getting this wrong would silently mislabel odds.
create or replace function public.play_implied_probs(supplies_in numeric[])
returns numeric[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce((select sum(s) from unnest(supplies_in) as s), 0) <= 0
      then array(select round(1::numeric / greatest(array_length(supplies_in, 1), 1), 6)
                 from generate_series(1, array_length(supplies_in, 1)))
    else array(
      select round(u.s / (select sum(s2) from unnest(supplies_in) as s2), 6)
        from unnest(supplies_in) with ordinality as u(s, ord)
       order by u.ord
    )
  end;
$$;

-- Wallet normalization. Base58 is case-sensitive on Solana, so we trim
-- only — we never lowercase. Used by every entry point so a wallet can
-- never produce two accounts.
create or replace function public.play_normalize_wallet(wallet_in text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(coalesce(wallet_in, '')), '');
$$;


-- =====================================================================
-- 8. SEASON HELPERS
-- =====================================================================
-- Weekly boundary: MONDAY 00:00:00 UTC.
-- date_trunc('week', ...) in Postgres uses the ISO week, which starts on
-- Monday — so this is exact, not approximate.
-- =====================================================================

create or replace function public.play_week_start(at_in timestamptz)
returns timestamptz
language sql
immutable
set search_path = public, pg_temp
as $$
  select date_trunc('week', (at_in at time zone 'UTC')) at time zone 'UTC';
$$;

-- Returns the open season covering now(), creating it if absent.
create or replace function public.play_current_season()
returns public.play_seasons
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  s      public.play_seasons;
  w_start timestamptz;
begin
  select * into s
    from public.play_seasons
   where status = 'open' and starts_at <= now() and ends_at > now()
   limit 1;

  if s.id is not null then
    return s;
  end if;

  w_start := public.play_week_start(now());

  insert into public.play_seasons (starts_at, ends_at, status)
  values (w_start, w_start + interval '7 days', 'open')
  on conflict do nothing
  returning * into s;

  if s.id is null then
    -- Lost the race to a concurrent caller; read theirs. Re-query by
    -- coverage rather than by starts_at, so we can never hand back a
    -- CLOSED season just because its window happens to match.
    select * into s
      from public.play_seasons
     where status = 'open' and starts_at <= now() and ends_at > now()
     limit 1;
  end if;

  if s.id is null then
    -- Neither inserted nor found: a closed season overlaps now() and no
    -- open one exists. Refuse loudly rather than trading into a closed
    -- season and mis-attributing everyone's P&L.
    raise exception 'play: no open season covers now(); run play_rollover_season()'
      using errcode = '22023';
  end if;

  return s;
end $$;


-- =====================================================================
-- 9. ACCOUNT + GRANT
-- =====================================================================

create or replace function public.play_ensure_account(wallet_in text)
returns public.play_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w   text;
  acc public.play_accounts;
begin
  w := public.play_normalize_wallet(wallet_in);
  if w is null then
    raise exception 'play: wallet_address is required'
      using errcode = '22023';
  end if;
  if char_length(w) not between 32 and 64 then
    raise exception 'play: wallet_address is not a plausible base58 address'
      using errcode = '22023';
  end if;

  insert into public.play_accounts (wallet_address)
  values (w)
  on conflict (wallet_address) do update set updated_at = now()
  returning * into acc;

  return acc;
end $$;


-- Grants exactly one $10,000 bankroll per UTC calendar day, on first
-- touch. No retroactive grants: a user who does not play on Tuesday
-- never receives Tuesday's money.
--
-- Idempotency key `daily_grant:<YYYY-MM-DD>` is unique per account, so a
-- duplicate grant cannot be inserted even under concurrent calls.
create or replace function public.play_ensure_daily_grant(account_id_in uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  cfg       public.play_settings;
  season    public.play_seasons;
  today     date;
  idem      text;
  bal_before numeric(18,2);
  bal_after  numeric(18,2);
  -- integer, not boolean: GET DIAGNOSTICS ... = ROW_COUNT yields an
  -- integer and Postgres has no integer->boolean assignment cast.
  n_inserted integer := 0;
begin
  select * into cfg from public.play_settings where id = 1;
  today := (now() at time zone 'UTC')::date;
  idem  := 'daily_grant:' || to_char(today, 'YYYY-MM-DD');

  -- Lock this account's row so two concurrent first-touches serialize.
  select balance_usd into bal_before
    from public.play_accounts where id = account_id_in for update;

  if bal_before is null then
    raise exception 'play: account % not found', account_id_in
      using errcode = '23503';
  end if;

  bal_after := bal_before + cfg.daily_grant_usd;
  season    := public.play_current_season();

  insert into public.play_ledger (
    account_id, season_id, kind, amount_usd,
    balance_before, balance_after, idempotency_key, metadata
  )
  values (
    account_id_in, season.id, 'daily_grant', cfg.daily_grant_usd,
    bal_before, bal_after, idem,
    jsonb_build_object('grant_date', today)
  )
  on conflict (account_id, idempotency_key) do nothing;

  get diagnostics n_inserted = row_count;

  if n_inserted > 0 then
    update public.play_accounts
       set balance_usd     = bal_after,
           last_grant_date = today,
           updated_at      = now()
     where id = account_id_in;
    return bal_after;
  end if;

  -- Already granted today.
  return bal_before;
end $$;


-- =====================================================================
-- 9B. SIGN-IN NONCES — one wallet signature per session, not per action
-- =====================================================================
-- The Play API is session-based: a wallet signs ONE challenge, the server
-- verifies it and issues an httpOnly session cookie. Every subsequent
-- Play call resolves its identity from that cookie.
--
-- This table is the challenge store. It exists to make the sign-in
-- signature single-use and short-lived:
--
--   * nonce is the primary key      -> a nonce can never be issued twice
--   * consumed_at is set atomically -> a nonce can never be spent twice
--   * expires_at is checked in SQL  -> a captured challenge dies quickly
--   * wallet_address is bound       -> a nonce issued for wallet A cannot
--                                      be redeemed by wallet B
--
-- The nonce VALUE is generated in the API route with crypto.randomBytes,
-- not here, so this migration needs no pgcrypto dependency.
-- =====================================================================

create table if not exists public.play_auth_nonces (
  nonce          text primary key,
  wallet_address text not null,
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,

  constraint play_auth_nonces_window check (expires_at > issued_at),
  constraint play_auth_nonces_len    check (char_length(nonce) between 32 and 128)
);

create index if not exists play_auth_nonces_wallet_idx
  on public.play_auth_nonces (wallet_address, issued_at desc);

-- Supports both the purge sweep and the per-wallet outstanding-nonce cap.
create index if not exists play_auth_nonces_live_idx
  on public.play_auth_nonces (expires_at) where consumed_at is null;

alter table public.play_auth_nonces enable row level security;
revoke all on public.play_auth_nonces from anon, authenticated;

-- Max simultaneously outstanding (unconsumed, unexpired) challenges per
-- wallet. Stops a caller from farming an unbounded pool of valid nonces.
create or replace function public.play_issue_nonce(
  wallet_in      text,
  nonce_in       text,
  ttl_seconds_in integer default 300
)
returns public.play_auth_nonces
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  w         text;
  n_live    integer;
  row_out   public.play_auth_nonces;
  ttl       integer;
begin
  w := public.play_normalize_wallet(wallet_in);
  if w is null or char_length(w) not between 32 and 64 then
    raise exception 'play: wallet_address is required' using errcode = '22023';
  end if;

  if nonce_in is null or char_length(nonce_in) not between 32 and 128 then
    raise exception 'play: malformed nonce' using errcode = '22023';
  end if;

  ttl := least(greatest(coalesce(ttl_seconds_in, 300), 30), 900);

  -- Opportunistic housekeeping: this table is write-heavy and read-once,
  -- so clearing dead rows on issue keeps it from growing without bound
  -- and removes the need for a separate cron.
  delete from public.play_auth_nonces
   where expires_at < now() - interval '1 hour';

  select count(*) into n_live
    from public.play_auth_nonces
   where wallet_address = w
     and consumed_at is null
     and expires_at > now();

  if n_live >= 5 then
    raise exception 'play: too many pending sign-in challenges; try again shortly'
      using errcode = '22023';
  end if;

  insert into public.play_auth_nonces (nonce, wallet_address, expires_at)
  values (nonce_in, w, now() + make_interval(secs => ttl))
  returning * into row_out;

  return row_out;
end $$;


-- Atomically spends a challenge. Returns the row on success, NULL on any
-- failure (unknown / wrong wallet / already consumed / expired).
--
-- The conditional UPDATE is the entire replay defence: two concurrent
-- redemptions of the same nonce race on the same row, and exactly one
-- can match `consumed_at is null`.
create or replace function public.play_consume_nonce(
  nonce_in  text,
  wallet_in text
)
returns public.play_auth_nonces
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  w       text;
  row_out public.play_auth_nonces;
begin
  w := public.play_normalize_wallet(wallet_in);
  if w is null or nonce_in is null then
    return null;
  end if;

  update public.play_auth_nonces
     set consumed_at = now()
   where nonce          = nonce_in
     and wallet_address = w
     and consumed_at is null
     and expires_at   > now()
  returning * into row_out;

  if row_out.nonce is null then
    return null;
  end if;

  return row_out;
end $$;


-- =====================================================================
-- 10. MARKET STATE
-- =====================================================================

-- Reads the shared market row to determine how many outcomes exist.
-- Handles outcome_names stored as either jsonb or text[] (to_jsonb
-- normalizes both), falling back to market_type (0 = binary => 2).
-- READ ONLY — never writes public.markets.
create or replace function public.play_market_outcome_count(market_address_in text)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cfg   public.play_settings;
  names jsonb;
  mtype integer;
  n     integer;
begin
  select * into cfg from public.play_settings where id = 1;

  select to_jsonb(m.outcome_names), m.market_type
    into names, mtype
    from public.markets m
   where m.market_address = market_address_in;

  if not found then
    raise exception 'play: market % not found', market_address_in
      using errcode = 'P0002';
  end if;

  if names is not null and jsonb_typeof(names) = 'array' then
    n := jsonb_array_length(names);
  else
    n := null;
  end if;

  if n is null or n < 2 then
    -- market_type 0 = binary, anything else without names is unusable.
    if coalesce(mtype, 0) = 0 then
      n := 2;
    else
      raise exception 'play: market % has no usable outcome list', market_address_in
        using errcode = '22023';
    end if;
  end if;

  if n > cfg.max_outcomes then
    raise exception 'play: market % declares % outcomes, max is %',
      market_address_in, n, cfg.max_outcomes
      using errcode = '22023';
  end if;

  return n;
end $$;


-- Creates the Play economy for a market on first interaction.
-- Every outcome starts with the SAME seed supply, so a fresh market opens
-- evenly (2 => 50/50, 3 => 33/33/33, 4 => 25/25/25/25, ...).
-- Concurrency-safe: ON CONFLICT means two simultaneous first trades can
-- never create two states.
create or replace function public.play_ensure_market_state(market_address_in text)
returns public.play_market_states
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg    public.play_settings;
  season public.play_seasons;
  st     public.play_market_states;
  n      integer;
  addr   text;
begin
  addr := nullif(btrim(coalesce(market_address_in, '')), '');
  if addr is null then
    raise exception 'play: market_address is required' using errcode = '22023';
  end if;

  select * into st from public.play_market_states where market_address = addr;
  if st.id is not null then
    return st;
  end if;

  select * into cfg from public.play_settings where id = 1;
  n      := public.play_market_outcome_count(addr);
  season := public.play_current_season();

  insert into public.play_market_states (
    market_address, created_in_season_id, outcome_count,
    outcome_supplies, virtual_pool_usd, status
  )
  values (
    addr, season.id, n,
    array(select cfg.initial_supply_per_outcome from generate_series(1, n)),
    0, 'open'
  )
  on conflict (market_address) do nothing
  returning * into st;

  if st.id is null then
    select * into st from public.play_market_states where market_address = addr;
  end if;

  return st;
end $$;


-- =====================================================================
-- 11. TRADABILITY GATE
-- =====================================================================
-- Single place that decides whether a market accepts Play trades right
-- now. Reads the shared market row only. Raises on refusal so callers
-- cannot forget to check the return value.
--
-- Authoritative fields (written by the admin commit routes AFTER the
-- on-chain tx confirms):
--   resolution_status  'open' | 'proposed' | 'finalized' | 'cancelled'
--   winning_outcome    set with 'finalized'
--   resolved           boolean mirror
--   is_blocked         moderation kill switch
--   end_date           trading deadline
create or replace function public.play_assert_market_tradable(market_address_in text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  m record;
begin
  select market_address, resolution_status, resolved, is_blocked, end_date
    into m
    from public.markets
   where market_address = market_address_in;

  if not found then
    raise exception 'play: market % not found', market_address_in
      using errcode = 'P0002';
  end if;

  if coalesce(m.is_blocked, false) then
    raise exception 'play: market is blocked' using errcode = '22023';
  end if;

  if coalesce(m.resolved, false) then
    raise exception 'play: market already resolved' using errcode = '22023';
  end if;

  if lower(coalesce(m.resolution_status, 'open')) <> 'open' then
    raise exception 'play: market is not open (status=%)',
      lower(coalesce(m.resolution_status, 'open'))
      using errcode = '22023';
  end if;

  -- end_date may be `timestamp` or `timestamptz` depending on when the
  -- column was created. The function-level TimeZone=UTC setting makes the
  -- implicit cast deterministic in both cases.
  if m.end_date is not null and (m.end_date)::timestamptz <= now() then
    raise exception 'play: market trading deadline has passed'
      using errcode = '22023';
  end if;
end $$;


-- =====================================================================
-- 12. QUOTE (informational)
-- =====================================================================
-- Never mutates anything. Execution recomputes everything under a row
-- lock, so a stale quote can only produce a slightly different fill —
-- never a corrupted one.
create or replace function public.play_quote(
  wallet_in         text,
  market_address_in text,
  outcome_index_in  integer,
  stake_usd_in      numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  cfg           public.play_settings;
  acc           public.play_accounts;
  st            public.play_market_states;
  stake         numeric(18,2);
  q0            numeric;
  n_shares      numeric;
  supplies_after numeric[];
  pool_after    numeric;
  user_shares_after numeric;
  total_shares_after numeric;
  est_payout    numeric;
begin
  select * into cfg from public.play_settings where id = 1;

  stake := trunc(coalesce(stake_usd_in, 0), 2);
  if stake <= 0 then
    raise exception 'play: stake must be greater than zero' using errcode = '22023';
  end if;

  perform public.play_assert_market_tradable(market_address_in);
  st := public.play_ensure_market_state(market_address_in);

  if outcome_index_in < 0 or outcome_index_in >= st.outcome_count then
    raise exception 'play: outcome_index % out of range (0..%)',
      outcome_index_in, st.outcome_count - 1
      using errcode = '22023';
  end if;

  acc := public.play_ensure_account(wallet_in);

  q0       := st.outcome_supplies[outcome_index_in + 1];
  n_shares := public.play_shares_for_stake(
                q0, stake, cfg.base_price_usd, cfg.slope_usd_per_share);

  supplies_after := st.outcome_supplies;
  supplies_after[outcome_index_in + 1] := q0 + n_shares;
  pool_after := st.virtual_pool_usd + stake;

  -- "If this market resolved right now" — pro-rata of the pool against
  -- USER-held winning shares (seed supply is a pricing device only and is
  -- deliberately excluded from the payout denominator).
  select coalesce(sum(t.shares), 0) into total_shares_after
    from public.play_trades t
   where t.market_address = market_address_in
     and t.outcome_index  = outcome_index_in
     and t.status         = 'open';

  select coalesce(sum(t.shares), 0) into user_shares_after
    from public.play_trades t
   where t.market_address = market_address_in
     and t.outcome_index  = outcome_index_in
     and t.status         = 'open'
     and t.account_id     = acc.id;

  total_shares_after := total_shares_after + n_shares;
  user_shares_after  := user_shares_after + n_shares;

  if total_shares_after > 0 then
    est_payout := trunc(user_shares_after / total_shares_after * pool_after, 2);
  else
    est_payout := 0;
  end if;

  return jsonb_build_object(
    'market_address',        market_address_in,
    'outcome_index',         outcome_index_in,
    'outcome_count',         st.outcome_count,
    'supplies',              to_jsonb(st.outcome_supplies),
    'supplies_after',        to_jsonb(supplies_after),
    'implied_probs',         to_jsonb(public.play_implied_probs(st.outcome_supplies)),
    'implied_probs_after',   to_jsonb(public.play_implied_probs(supplies_after)),
    'virtual_pool_usd',      st.virtual_pool_usd,
    'virtual_pool_usd_after', pool_after,
    'stake_usd',             stake,
    'shares',                n_shares,
    'avg_price_usd',         case when n_shares > 0
                                  then round(stake / n_shares, 8) else null end,
    'estimated_payout_usd',  est_payout,
    'estimated_multiple',    case when stake > 0
                                  then round(est_payout / stake, 4) else null end,
    'balance_usd',           acc.balance_usd,
    'state_version',         st.version,
    'quoted_at',             now()
  );
end $$;


-- =====================================================================
-- 13. EXECUTE TRADE — one atomic transaction
-- =====================================================================
create or replace function public.play_execute_trade(
  wallet_in          text,
  market_address_in  text,
  outcome_index_in   integer,
  stake_usd_in       numeric,
  client_trade_id_in text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  cfg        public.play_settings;
  acc        public.play_accounts;
  season     public.play_seasons;
  st         public.play_market_states;
  existing   public.play_trades;
  trade      public.play_trades;
  stake      numeric(18,2);
  cid        text;
  q0         numeric;
  n_shares   numeric;
  new_supplies numeric[];
  bal_before numeric(18,2);
  bal_after  numeric(18,2);
  o_name     text;
  names      jsonb;
begin
  select * into cfg from public.play_settings where id = 1;

  cid := nullif(btrim(coalesce(client_trade_id_in, '')), '');
  if cid is null then
    raise exception 'play: client_trade_id is required' using errcode = '22023';
  end if;
  if char_length(cid) > 128 then
    raise exception 'play: client_trade_id too long' using errcode = '22023';
  end if;

  stake := trunc(coalesce(stake_usd_in, 0), 2);
  if stake <= 0 then
    raise exception 'play: stake must be greater than zero' using errcode = '22023';
  end if;

  -- 1. account
  acc := public.play_ensure_account(wallet_in);

  -- Idempotent replay: a double-submitted request returns the ORIGINAL
  -- trade and moves no money.
  select * into existing
    from public.play_trades
   where account_id = acc.id and client_trade_id = cid;

  if existing.id is not null then
    select * into st from public.play_market_states
      where market_address = existing.market_address;
    select balance_usd into bal_after from public.play_accounts where id = acc.id;
    return jsonb_build_object(
      'replayed',         true,
      'trade',            to_jsonb(existing),
      'balance_usd',      bal_after,
      'market_state',     to_jsonb(st)
    );
  end if;

  -- 2. daily grant (first Play interaction of the UTC day)
  perform public.play_ensure_daily_grant(acc.id);

  -- 3. active season
  season := public.play_current_season();
  if season.id is null then
    raise exception 'play: no active season' using errcode = '22023';
  end if;

  -- 4 + 5. market open, not blocked / finalized / cancelled / expired
  perform public.play_assert_market_tradable(market_address_in);

  -- 6. Play economy exists
  st := public.play_ensure_market_state(market_address_in);

  if outcome_index_in < 0 or outcome_index_in >= st.outcome_count then
    raise exception 'play: outcome_index % out of range (0..%)',
      outcome_index_in, st.outcome_count - 1
      using errcode = '22023';
  end if;

  -- 7. LOCK the market state. Everything below is serialized per market.
  select * into st
    from public.play_market_states
   where id = st.id
   for update;

  if st.status <> 'open' then
    raise exception 'play: play market state is % (not open)', st.status
      using errcode = '22023';
  end if;

  -- 8. authoritative recompute under the lock (client quote is ignored)
  q0       := st.outcome_supplies[outcome_index_in + 1];
  n_shares := public.play_shares_for_stake(
                q0, stake, cfg.base_price_usd, cfg.slope_usd_per_share);

  if n_shares <= 0 then
    raise exception 'play: stake too small to buy any shares' using errcode = '22023';
  end if;

  -- 9 + 10. Atomic conditional debit. If two requests race, exactly one
  -- can satisfy `balance_usd >= stake`; the other matches zero rows.
  -- This single statement is the whole overspend/two-tab race defence.
  update public.play_accounts
     set balance_usd = balance_usd - stake,
         updated_at  = now()
   where id = acc.id
     and balance_usd >= stake
  returning balance_usd + stake, balance_usd into bal_before, bal_after;

  if bal_before is null then
    select balance_usd into bal_before from public.play_accounts where id = acc.id;
    raise exception 'play: insufficient balance (have %, need %)', bal_before, stake
      using errcode = '22023';
  end if;

  -- 11 + 12. virtual supply and pool
  new_supplies := st.outcome_supplies;
  new_supplies[outcome_index_in + 1] := q0 + n_shares;

  update public.play_market_states
     set outcome_supplies = new_supplies,
         virtual_pool_usd = virtual_pool_usd + stake,
         version          = version + 1,
         updated_at       = now()
   where id = st.id
  returning * into st;

  -- Denormalized outcome label, best effort (display only).
  select to_jsonb(m.outcome_names) into names
    from public.markets m where m.market_address = market_address_in;
  if names is not null and jsonb_typeof(names) = 'array'
     and jsonb_array_length(names) > outcome_index_in then
    o_name := names ->> outcome_index_in;
  end if;

  -- 13. immutable trade record
  insert into public.play_trades (
    account_id, season_id, trade_date, market_address, outcome_index,
    outcome_name, stake_usd, shares, entry_supply, quoted_cost_usd,
    status, client_trade_id
  )
  values (
    acc.id, season.id, (now() at time zone 'UTC')::date,
    market_address_in, outcome_index_in, o_name,
    stake, n_shares, q0, stake,
    'open', cid
  )
  returning * into trade;

  -- 14. ledger debit
  insert into public.play_ledger (
    account_id, season_id, trade_id, kind, amount_usd,
    balance_before, balance_after, idempotency_key, metadata
  )
  values (
    acc.id, season.id, trade.id, 'trade_stake', -stake,
    bal_before, bal_after, 'trade_stake:' || cid,
    jsonb_build_object(
      'market_address', market_address_in,
      'outcome_index',  outcome_index_in,
      'shares',         n_shares,
      'entry_supply',   q0
    )
  );

  -- 15.
  return jsonb_build_object(
    'replayed',      false,
    'trade',         to_jsonb(trade),
    'balance_usd',   bal_after,
    'market_state',  to_jsonb(st),
    'implied_probs', to_jsonb(public.play_implied_probs(st.outcome_supplies))
  );
end $$;


-- =====================================================================
-- 14. SETTLE MARKET
-- =====================================================================
-- Idempotent by construction: every write is gated on `status = 'open'`
-- and every credit is derived from the rows this call actually updated.
-- A second invocation matches zero rows and credits exactly zero.
--
-- Payout model
-- ------------
--   finalized: payout_trade = floor_cents(
--                trade.shares / SUM(all open winning shares) * final_pool )
--   cancelled: payout_trade = trade.stake_usd
--
-- The denominator is USER-held winning shares, NOT the state's supply
-- array. The seed supply nobody paid for is a pricing device; including
-- it would permanently strand part of the pool.
--
-- Rounding: payouts truncate to the cent, so SUM(payouts) <= pool always.
-- The remainder ("dust") stays in virtual_pool_usd. Play never mints
-- virtual value.
--
-- NO-WINNING-POSITIONS RULE
-- -------------------------
-- If the market finalizes on a valid outcome but NO user holds any Play
-- shares on it (everybody backed a loser), there is no one to pay
-- pro-rata. Rather than strand the pool and mark every trade lost, the
-- whole market is refunded:
--
--   * every open trade -> 'refunded', payout = stake, realized P&L = 0
--   * one idempotent 'trade_refund' ledger row per trade
--   * pool drains to 0 (SUM(refunds) == SUM(stakes) == pool)
--   * state -> 'finalized' (NOT 'cancelled' — the Real market did
--     resolve) with settlement_meta.reason = 'no_winning_positions'
--
-- Seed supply is never treated as a user-owned winning share: the
-- denominator and this zero test both come from play_trades, never from
-- play_market_states.outcome_supplies.
--
-- This is Play-only. Real settlement, claims and refunds are untouched;
-- on-chain, claim_winnings still simply requires user_shares > 0.
-- =====================================================================

create or replace function public.play_settle_market(market_address_in text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  m             record;
  st            public.play_market_states;
  season        public.play_seasons;
  t             record;
  final_status  text;
  winning       integer;
  final_pool    numeric(18,2);
  total_winning numeric(28,8);
  payout        numeric(18,2);
  pnl           numeric(18,2);
  new_status    text;
  bal_before    numeric(18,2);
  bal_after     numeric(18,2);
  settled_count integer := 0;
  paid_total    numeric(18,2) := 0;
  -- True when the whole market refunds instead of paying pro-rata:
  -- either the market was cancelled, or it finalized with no user-owned
  -- shares on the winning outcome.
  refund_all    boolean := false;
  no_winners    boolean := false;
  settle_reason text;
begin
  select market_address, resolution_status, resolved, winning_outcome
    into m
    from public.markets
   where market_address = market_address_in;

  if not found then
    raise exception 'play: market % not found', market_address_in
      using errcode = 'P0002';
  end if;

  final_status := lower(coalesce(m.resolution_status, 'open'));

  -- 2. Terminal states only. 'proposed' is NOT terminal — a dispute can
  --    still change the outcome, so Play waits.
  if final_status = 'cancelled' then
    winning := null;
  elsif final_status = 'finalized' and m.winning_outcome is not null then
    winning := m.winning_outcome;
  else
    return jsonb_build_object(
      'settled', false,
      'reason', 'market not in a terminal state',
      'resolution_status', final_status,
      'trades_settled', 0
    );
  end if;

  -- No Play economy for this market: nothing to do.
  select * into st from public.play_market_states
    where market_address = market_address_in;
  if st.id is null then
    return jsonb_build_object(
      'settled', true, 'reason', 'no play state', 'trades_settled', 0
    );
  end if;

  -- 3. lock
  select * into st from public.play_market_states where id = st.id for update;

  -- 3b. IDEMPOTENCY GUARD — true no-op if already settled.
  --
  -- If this market's Play state is already terminal, a prior call settled
  -- it. Return WITHOUT touching a single row: no version bump, no
  -- updated_at, no settled_at, no settlement_meta rewrite, no ledger, no
  -- balance change, no trade change.
  --
  -- Critically, we must NOT fall through to the recompute below. After the
  -- first settlement there are zero OPEN trades and the pool has drained,
  -- so recomputing would evaluate `no_winners := (winning is not null and
  -- total_winning = 0)` as true and mislabel a finalized pro-rata market
  -- as 'no_winning_positions' with zeroed totals. Instead we report the
  -- ORIGINAL settlement straight from the persisted settlement_meta, and
  -- flag the current invocation as having moved nothing.
  if st.status <> 'open' then
    return jsonb_build_object(
      'settled',                true,
      'already_settled',        true,
      'market_address',         market_address_in,
      'resolution_status',      final_status,
      -- The ORIGINAL settlement (persisted). settlement_meta is set on the
      -- first settlement; the status fallback covers only a terminal state
      -- with empty meta, which the normal path never produces.
      'reason',                 coalesce(st.settlement_meta->>'reason', st.status),
      'winning_outcome',        nullif(st.settlement_meta->>'winning_outcome','')::integer,
      'final_pool_usd',         nullif(st.settlement_meta->>'final_pool_usd','')::numeric,
      'original_paid_out_usd',  nullif(st.settlement_meta->>'paid_out_usd','')::numeric,
      'original_trades_settled',nullif(st.settlement_meta->>'trades_settled','')::integer,
      'settlement_meta',        st.settlement_meta,
      -- THIS invocation moved nothing:
      'trades_settled',         0,
      'paid_out_usd',           0,
      'market_state',           to_jsonb(st)
    );
  end if;

  season     := public.play_current_season();
  final_pool := st.virtual_pool_usd;

  -- 4. Aggregate open winning shares. Sourced from play_trades, so the
  --    seeded supply in play_market_states can never be mistaken for a
  --    user-owned winning share.
  if winning is not null then
    select coalesce(sum(shares), 0) into total_winning
      from public.play_trades
     where market_address = market_address_in
       and status         = 'open'
       and outcome_index  = winning;
  else
    total_winning := 0;
  end if;

  -- Decide the settlement mode once, before touching any row.
  no_winners := (winning is not null and total_winning = 0);
  refund_all := (winning is null) or no_winners;

  settle_reason := case
    when winning is null then 'cancelled'
    when no_winners      then 'no_winning_positions'
    else 'pro_rata'
  end;

  -- 5..9. Walk every open trade in deterministic order.
  for t in
    select * from public.play_trades
     where market_address = market_address_in
       and status = 'open'
     order by created_at, id
    for update
  loop
    if refund_all then
      -- Cancelled market, or finalized with nobody on the winner.
      new_status := 'refunded';
      payout     := t.stake_usd;
      pnl        := 0;
    elsif t.outcome_index = winning then
      -- total_winning > 0 is guaranteed here: refund_all covers the zero
      -- case above, so this division is always safe.
      new_status := 'won';
      payout     := trunc(t.shares / total_winning * final_pool, 2);
      pnl        := payout - t.stake_usd;
    else
      new_status := 'lost';
      payout     := 0;
      pnl        := -t.stake_usd;
    end if;

    update public.play_trades
       set status           = new_status,
           payout_usd       = payout,
           realized_pnl_usd = pnl,
           settled_at       = now()
     where id = t.id;

    if payout > 0 then
      -- 7. Credit exactly once. The PRIMARY idempotency guard is the
      --    `status = 'open'` filter on the loop above: a second call
      --    selects no rows and credits nothing. The ledger key below is a
      --    backstop — if it ever conflicts, the whole settlement aborts,
      --    which is the correct response to that kind of inconsistency.
      update public.play_accounts
         set balance_usd = balance_usd + payout,
             updated_at  = now()
       where id = t.account_id
      returning balance_usd - payout, balance_usd into bal_before, bal_after;

      -- 8. one ledger row per settled trade
      insert into public.play_ledger (
        account_id, season_id, trade_id, kind, amount_usd,
        balance_before, balance_after, idempotency_key, metadata
      )
      values (
        t.account_id, season.id, t.id,
        case when refund_all then 'trade_refund' else 'trade_payout' end,
        payout, bal_before, bal_after,
        (case when refund_all then 'trade_refund:' else 'trade_payout:' end)
          || t.id::text,
        jsonb_build_object(
          'market_address', market_address_in,
          'outcome_index',  t.outcome_index,
          'winning_outcome', winning,
          'shares',         t.shares,
          'final_pool_usd', final_pool,
          'trade_season_id', t.season_id,
          'reason',         settle_reason
        )
      );

      paid_total := paid_total + payout;
    end if;

    settled_count := settled_count + 1;
  end loop;

  -- 10. Pool retains only the rounding dust; state becomes terminal.
  --     On a refund_all settlement SUM(refunds) == SUM(stakes) == pool
  --     exactly, so the pool drains to 0 and nothing is orphaned.
  --     Status is 'finalized' whenever the Real market finalized — the
  --     no-winning-positions case is a payout rule, not a cancellation.
  update public.play_market_states
     set virtual_pool_usd = greatest(final_pool - paid_total, 0),
         status           = case when winning is null then 'cancelled'
                                 else 'finalized' end,
         version          = version + 1,
         -- Record the FIRST settlement only. A repeat call settles zero
         -- trades and must not overwrite the audit trail of the run that
         -- actually moved the money.
         settlement_meta  = case
                              when settlement_meta = '{}'::jsonb then
                                jsonb_build_object(
                                  'reason',               settle_reason,
                                  'winning_outcome',      winning,
                                  'total_winning_shares', total_winning,
                                  'final_pool_usd',       final_pool,
                                  'paid_out_usd',         paid_total,
                                  'trades_settled',       settled_count,
                                  'settled_at',           now()
                                )
                              else settlement_meta
                            end,
         settled_at       = coalesce(settled_at, now()),
         updated_at       = now()
   where id = st.id
  returning * into st;

  -- 11. First settlement — THIS invocation moved the money, so the
  --     current-invocation totals and the original settlement totals are
  --     one and the same. already_settled is false to disambiguate from
  --     the repeat-call response shape.
  return jsonb_build_object(
    'settled',          true,
    'already_settled',  false,
    'market_address',   market_address_in,
    'resolution_status', final_status,
    'winning_outcome',  winning,
    'reason',           settle_reason,
    'no_winning_positions', no_winners,
    'refunded_all',     refund_all,
    'trades_settled',   settled_count,
    'final_pool_usd',   final_pool,
    'paid_out_usd',     paid_total,
    'dust_usd',         final_pool - paid_total,
    'total_winning_shares', total_winning,
    'market_state',     to_jsonb(st)
  );
end $$;


-- =====================================================================
-- 15. WEEKLY ROLLOVER
-- =====================================================================
-- Manual / admin-triggered for Phase 1. No Vercel cron is registered.
--
-- Boundary: Monday 00:00:00 UTC.
--
-- What resets: the competition BANKROLL (play_accounts.balance_usd -> 0).
-- What does NOT reset: play_market_states (odds stay coherent for live
-- markets), play_trades, play_ledger. Open trades keep their original
-- season_id and remain fully settleable — their P&L still counts toward
-- the season in which they were PLACED, while their payout lands in the
-- account's then-current balance.
-- =====================================================================

create or replace function public.play_rollover_season()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  cur        public.play_seasons;
  nxt        public.play_seasons;
  a          record;
  w_start    timestamptz;
  reset_count integer := 0;
  reset_total numeric(18,2) := 0;
begin
  select * into cur
    from public.play_seasons
   where status = 'open'
   order by starts_at desc
   limit 1;

  if cur.id is null then
    nxt := public.play_current_season();
    return jsonb_build_object(
      'rolled', false, 'reason', 'no open season; created current',
      'season_id', nxt.id
    );
  end if;

  if cur.ends_at > now() then
    return jsonb_build_object(
      'rolled', false,
      'reason', 'current season has not ended yet',
      'season_id', cur.id,
      'ends_at', cur.ends_at
    );
  end if;

  -- Close the expired season.
  update public.play_seasons
     set status = 'closed', closed_at = now()
   where id = cur.id;

  -- Open the next window. It must start exactly where the closed season
  -- ended, otherwise the two ranges overlap and the exclusion constraint
  -- silently rejects the insert. GREATEST also keeps an early/forced
  -- rollover from creating a season that starts in the past.
  --
  -- The END is always snapped back to the Monday 00:00 UTC grid, so an
  -- off-cycle rollover produces one short season and then re-aligns
  -- rather than drifting the boundary forever.
  w_start := greatest(cur.ends_at, public.play_week_start(now()));

  insert into public.play_seasons (starts_at, ends_at, status)
  values (
    w_start,
    public.play_week_start(w_start) + interval '7 days',
    'open'
  )
  on conflict do nothing
  returning * into nxt;

  if nxt.id is null then
    select * into nxt
      from public.play_seasons
     where status = 'open' and ends_at > now()
     order by starts_at desc
     limit 1;
  end if;

  if nxt.id is null then
    raise exception 'play: rollover could not open a new season'
      using errcode = '22023';
  end if;

  -- Zero every non-zero bankroll, with a ledger row for each.
  for a in
    select id, balance_usd from public.play_accounts
     where balance_usd > 0
     order by id
    for update
  loop
    insert into public.play_ledger (
      account_id, season_id, kind, amount_usd,
      balance_before, balance_after, idempotency_key, metadata
    )
    values (
      a.id, nxt.id, 'season_reset', -a.balance_usd,
      a.balance_usd, 0, 'season_reset:' || cur.id::text,
      jsonb_build_object('closed_season_id', cur.id, 'new_season_id', nxt.id)
    )
    on conflict (account_id, idempotency_key) do nothing;

    if found then
      update public.play_accounts
         set balance_usd = 0, updated_at = now()
       where id = a.id;
      reset_count := reset_count + 1;
      reset_total := reset_total + a.balance_usd;
    end if;
  end loop;

  return jsonb_build_object(
    'rolled',            true,
    'closed_season_id',  cur.id,
    'new_season_id',     nxt.id,
    'new_starts_at',     nxt.starts_at,
    'new_ends_at',       nxt.ends_at,
    'accounts_reset',    reset_count,
    'balance_cleared_usd', reset_total
  );
end $$;


-- =====================================================================
-- 16. GRANTS — service_role only for every mutating function
-- =====================================================================

revoke all on function public.play_ensure_account(text)                     from public;
revoke all on function public.play_issue_nonce(text, text, integer)         from public;
revoke all on function public.play_consume_nonce(text, text)                from public;
revoke all on function public.play_ensure_daily_grant(uuid)                 from public;
revoke all on function public.play_ensure_market_state(text)                from public;
revoke all on function public.play_current_season()                         from public;
revoke all on function public.play_quote(text, text, integer, numeric)      from public;
revoke all on function public.play_execute_trade(text, text, integer, numeric, text) from public;
revoke all on function public.play_settle_market(text)                      from public;
revoke all on function public.play_rollover_season()                        from public;
revoke all on function public.play_market_outcome_count(text)               from public;
revoke all on function public.play_assert_market_tradable(text)             from public;

grant execute on function public.play_ensure_account(text)                     to service_role;
grant execute on function public.play_issue_nonce(text, text, integer)         to service_role;
grant execute on function public.play_consume_nonce(text, text)                to service_role;
grant execute on function public.play_ensure_daily_grant(uuid)                 to service_role;
grant execute on function public.play_ensure_market_state(text)                to service_role;
grant execute on function public.play_current_season()                         to service_role;
grant execute on function public.play_quote(text, text, integer, numeric)      to service_role;
grant execute on function public.play_execute_trade(text, text, integer, numeric, text) to service_role;
grant execute on function public.play_settle_market(text)                      to service_role;
grant execute on function public.play_rollover_season()                        to service_role;
grant execute on function public.play_market_outcome_count(text)               to service_role;
grant execute on function public.play_assert_market_tradable(text)             to service_role;

-- Pure math helpers are safe for anyone to call (no data access).
grant execute on function public.play_cost_for_shares(numeric, numeric, numeric, numeric)
  to anon, authenticated, service_role;
grant execute on function public.play_shares_for_stake(numeric, numeric, numeric, numeric)
  to anon, authenticated, service_role;
grant execute on function public.play_implied_probs(numeric[])
  to anon, authenticated, service_role;
grant execute on function public.play_normalize_wallet(text)
  to anon, authenticated, service_role;
grant execute on function public.play_week_start(timestamptz)
  to anon, authenticated, service_role;


-- =====================================================================
-- 17. SEED — one active season
-- =====================================================================

select public.play_current_season();
