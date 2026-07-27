-- =====================================================================
-- Play Mode — Admin Play Contest (Phase 10): contests + frozen results
-- =====================================================================
-- Adds a MINIMAL contest model on top of the existing Play economy so an
-- operator can define a prize period, freeze the ranking that period
-- produced, verify it, and TRACK prize payment.
--
-- WHAT THIS IS NOT
-- ----------------
-- Nothing in this file moves money, virtual or real. There is no bonus
-- balance, no trading credit, no vault, no withdrawal and no treasury.
-- `prize_amount_usd` / `prize_status` / `payment_reference` are an
-- OPERATOR RECORD of an out-of-band payment decision that has not been
-- designed yet. Marking a row 'paid' records a fact; it sends nothing.
--
-- REAL-MODE ISOLATION
-- -------------------
-- Play-only. Creates two new play_* tables and one index on play_trades.
-- Reads nothing, writes nothing and alters nothing in public.markets,
-- public.transactions, public.profiles, public.fun_points_*,
-- public.live_sessions or any Real economic field.
--
-- Additive and idempotent: safe to re-run. Drops nothing, alters no
-- existing table, backfills no existing row.
--
-- NOT APPLIED. Run it yourself, against DEV only:
--   psql "$DATABASE_URL" -f supabase/migrations/20260727_play_contests.sql
-- =====================================================================


-- =====================================================================
-- 1. CONTESTS — one manually configured prize period
-- =====================================================================
-- The period is authoritative in UTC. `timezone` is a DISPLAY hint for
-- the admin UI only; every comparison in the ranking is done on the
-- timestamptz columns, never on a local-time reinterpretation.
--
-- STATUS LIFECYCLE (advanced by the admin API, never by a job)
--   draft        -> configured, not yet the active period
--   live         -> the period is running
--   ended        -> the period is over, nothing frozen yet
--   under_review -> results frozen, awaiting verification
--   verified     -> the frozen ranking has been reviewed and confirmed
--   paid         -> every prize-bearing frozen row is marked paid
--   cancelled    -> abandoned; excluded from the overlap constraint
-- =====================================================================

create table if not exists public.play_contests (
  id                uuid primary key default gen_random_uuid(),
  name              text        not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  -- Display hint only. Ranking eligibility is always UTC timestamptz.
  timezone          text        not null default 'UTC',
  status            text        not null default 'draft',
  prize_pool_usd    numeric(18,2) not null default 0,
  first_prize_usd   numeric(18,2) not null default 0,
  second_prize_usd  numeric(18,2) not null default 0,
  third_prize_usd   numeric(18,2) not null default 0,
  frozen_at         timestamptz,
  verified_at       timestamptz,
  -- Admin wallet, from the verified admin session cookie. Audit trail:
  -- who defined the period, who froze the ranking, who confirmed it.
  created_by        text,
  frozen_by         text,
  verified_by       text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint play_contests_status_check check (
    status in ('draft','live','ended','under_review','verified','paid','cancelled')
  ),
  constraint play_contests_range_check check (ends_at > starts_at),
  constraint play_contests_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint play_contests_prizes_nonneg check (
    prize_pool_usd   >= 0 and first_prize_usd  >= 0 and
    second_prize_usd >= 0 and third_prize_usd  >= 0
  ),
  -- The three ranked prizes must account for the whole advertised pool.
  -- Enforced by the database so a mis-typed form can never create a
  -- contest whose public prize copy does not add up.
  constraint play_contests_prizes_sum check (
    first_prize_usd + second_prize_usd + third_prize_usd = prize_pool_usd
  ),
  -- Freeze is a precondition of verify, at the row level too.
  constraint play_contests_verify_needs_freeze check (
    verified_at is null or frozen_at is not null
  )
);

-- No two ACTIVE contests may cover the same instant. Cancelled contests
-- are excluded so an abandoned period never blocks its replacement.
-- Enforced by the database, not by application discipline — same pattern
-- as play_seasons_no_overlap.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'play_contests_no_overlap'
  ) then
    execute $ddl$
      alter table public.play_contests
        add constraint play_contests_no_overlap
        exclude using gist (tstzrange(starts_at, ends_at) with &&)
        where (status <> 'cancelled')
    $ddl$;
  end if;
exception
  when undefined_object or feature_not_supported then
    -- btree_gist unavailable: the admin API still rejects an overlapping
    -- create, but the database cannot back it up here.
    raise notice 'btree_gist unavailable; play_contests overlap is API-enforced only';
end $$;

create index if not exists play_contests_window_idx
  on public.play_contests (starts_at, ends_at);

create index if not exists play_contests_status_idx
  on public.play_contests (status);


-- =====================================================================
-- 2. FROZEN RESULTS — the immutable snapshot a prize is paid against
-- =====================================================================
-- Written ONCE by the freeze action and never recalculated. A settlement
-- that lands after frozen_at changes the live preview and changes the
-- all-time leaderboard; it does not change one value in this table.
--
-- Money-shaped columns are NUMERIC, never float: the ranking is summed
-- in exact integer cents server-side and stored as a decimal here, so a
-- prize can never drift by a rounding step.
--
-- No balance is stored. No play_accounts UUID is stored — a winner is
-- identified by wallet, the same public identity the leaderboard shows.
-- =====================================================================

create table if not exists public.play_contest_results (
  id                      uuid primary key default gen_random_uuid(),
  contest_id              uuid not null
                            references public.play_contests(id) on delete cascade,
  rank                    integer not null,
  wallet_address          text    not null,

  -- Frozen ranking values. Immutable after freeze.
  realized_pnl_usd        numeric(18,2) not null,
  settled_picks           integer       not null,
  wins                    integer       not null,
  losses                  integer       not null,
  win_rate                numeric(9,4)  not null,
  total_settled_stake_usd numeric(18,2) not null,

  -- Prize tracking. RECORD ONLY — no transfer is implied by any value.
  prize_amount_usd        numeric(18,2) not null default 0,
  prize_status            text          not null default 'pending',
  payment_reference       text,
  admin_note              text,

  frozen_at               timestamptz not null default now(),
  verified_at             timestamptz,
  paid_at                 timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint play_contest_results_prize_status_check check (
    prize_status in ('pending','verified','paid','disputed','cancelled')
  ),
  constraint play_contest_results_rank_pos check (rank >= 1),
  constraint play_contest_results_counts_nonneg check (
    settled_picks >= 0 and wins >= 0 and losses >= 0
  ),
  -- Wins + losses can never exceed the settled positions they are drawn
  -- from. Refunded positions are picks but neither a win nor a loss.
  constraint play_contest_results_counts_shape check (wins + losses <= settled_picks),
  constraint play_contest_results_win_rate_range check (win_rate between 0 and 1),
  constraint play_contest_results_stake_nonneg check (total_settled_stake_usd >= 0),
  constraint play_contest_results_prize_nonneg check (prize_amount_usd >= 0),
  constraint play_contest_results_wallet_len check (
    char_length(wallet_address) between 32 and 64
  ),
  -- 'paid' is a recorded fact and must carry its timestamp.
  constraint play_contest_results_paid_shape check (
    prize_status <> 'paid' or paid_at is not null
  )
);

-- One row per rank and one row per wallet, per contest. Together these
-- make a duplicate winner and a duplicate rank impossible at the storage
-- layer, which is what makes a repeated freeze provably idempotent.
create unique index if not exists play_contest_results_rank_idx
  on public.play_contest_results (contest_id, rank);

create unique index if not exists play_contest_results_wallet_idx
  on public.play_contest_results (contest_id, wallet_address);


-- =====================================================================
-- 3. READ INDEX — period ranking over settled trades
-- =====================================================================
-- The contest ranking reads SETTLED play_trades rows whose settled_at
-- falls inside the contest window. Every existing play_trades index
-- leads with account_id, market_address, season_id or trade_date, so a
-- period scan on settled_at has nothing to seek on and degrades to a
-- sequential scan of the whole ledger.
--
-- Partial over settled rows only (an open row carries settled_at null by
-- CHECK constraint and can never satisfy the range predicate anyway).
--
-- NOT REQUIRED FOR CORRECTNESS — the ranking aggregates in Node over a
-- bounded read and is correct without it. Pure read-path optimisation.
-- =====================================================================

create index if not exists play_trades_settled_period_idx
  on public.play_trades (settled_at)
  where status <> 'open';


-- =====================================================================
-- 4. RLS — service-role only, matching every other play_* table
-- =====================================================================
-- RLS is enabled with NO policies and no anon/authenticated grants, so
-- the tables are unreachable from the browser. The only path in is the
-- server-side service-role client behind the admin session cookie.
-- =====================================================================

alter table public.play_contests        enable row level security;
alter table public.play_contest_results enable row level security;

grant select, insert, update, delete on public.play_contests        to service_role;
grant select, insert, update, delete on public.play_contest_results to service_role;
