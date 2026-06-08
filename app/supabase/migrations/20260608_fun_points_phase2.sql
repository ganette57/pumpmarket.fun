-- =====================================================================
-- Fun Points / Rewards — Phase 2 schema
-- =====================================================================
-- This migration creates the ledger-driven Fun Points system.
--
-- Apply via Supabase SQL Editor or:
--   psql "$DATABASE_URL" -f supabase/migrations/20260608_fun_points_phase2.sql
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Accounts — running balance per wallet
-- ---------------------------------------------------------------------
create table if not exists public.fun_points_accounts (
  wallet           text primary key,
  total_points     bigint not null default 0,
  lifetime_points  bigint not null default 0,
  referral_code    text unique,
  current_streak   integer not null default 0,
  last_checkin_date date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists fun_points_accounts_lifetime_idx
  on public.fun_points_accounts (lifetime_points desc);

-- ---------------------------------------------------------------------
-- 2. Ledger — source of truth, every event creates one row
-- ---------------------------------------------------------------------
create table if not exists public.fun_points_ledger (
  id          bigserial primary key,
  wallet      text not null,
  type        text not null,        -- trade_volume | daily_checkin | referral_signup | referral_first_trade | referral_trade_bonus | task_reward
  points      bigint not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists fun_points_ledger_wallet_idx
  on public.fun_points_ledger (wallet, created_at desc);

create index if not exists fun_points_ledger_type_idx
  on public.fun_points_ledger (type, created_at desc);

-- ---------------------------------------------------------------------
-- 3. Referrals — single referrer per wallet, immutable
-- ---------------------------------------------------------------------
create table if not exists public.referrals (
  referred_wallet text primary key,
  referrer_wallet text not null,
  created_at      timestamptz not null default now(),
  first_trade_at  timestamptz,
  check (referred_wallet <> referrer_wallet)
);

create index if not exists referrals_referrer_idx
  on public.referrals (referrer_wallet);

-- ---------------------------------------------------------------------
-- 4. Reward tasks — admin-defined
-- ---------------------------------------------------------------------
create table if not exists public.reward_tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  points      bigint not null,
  task_type   text not null,   -- 'social', 'trade', 'community', 'custom'
  url         text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists reward_tasks_active_idx
  on public.reward_tasks (active, created_at desc);

-- ---------------------------------------------------------------------
-- 5. Task completions — one wallet per task
-- ---------------------------------------------------------------------
create table if not exists public.task_completions (
  wallet       text not null,
  task_id      uuid not null references public.reward_tasks(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (wallet, task_id)
);

create index if not exists task_completions_wallet_idx
  on public.task_completions (wallet);

-- ---------------------------------------------------------------------
-- 6. Daily check-ins — one row per wallet per UTC day
-- ---------------------------------------------------------------------
create table if not exists public.daily_checkins (
  wallet      text not null,
  date        date not null,
  streak      integer not null default 1,
  created_at  timestamptz not null default now(),
  primary key (wallet, date)
);

-- ---------------------------------------------------------------------
-- Settings — single-row tunables (trade SOL→USD rate, referral bonus %, etc.)
-- ---------------------------------------------------------------------
create table if not exists public.fun_points_settings (
  id                       integer primary key default 1,
  sol_usd_rate             numeric not null default 150,    -- $ per 1 SOL
  referral_signup_points   bigint  not null default 25,     -- rebalanced Phase 2.1
  referral_first_trade_points bigint not null default 100,  -- rebalanced Phase 2.1
  referral_bonus_pct       numeric not null default 0.10,   -- 10% of trader points
  daily_checkin_points     bigint  not null default 10,
  updated_at               timestamptz not null default now(),
  check (id = 1)
);

insert into public.fun_points_settings (id) values (1)
on conflict (id) do nothing;

-- =====================================================================
-- RPCs — atomic ledger-driven mutations
-- =====================================================================

-- Generate a deterministic short referral code from a wallet address.
create or replace function public.fp_referral_code_for(wallet_in text)
returns text
language plpgsql
immutable
as $$
declare
  digest_hex text;
begin
  -- 6 char base36-ish code from sha-like wallet slice
  digest_hex := upper(substring(md5(wallet_in), 1, 6));
  return 'FUN' || digest_hex;
end $$;

-- Ensure an account exists, return it.
create or replace function public.fp_ensure_account(wallet_in text)
returns public.fun_points_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  acc public.fun_points_accounts;
begin
  insert into public.fun_points_accounts (wallet, referral_code)
  values (wallet_in, public.fp_referral_code_for(wallet_in))
  on conflict (wallet) do update
    set updated_at = now()
  returning * into acc;
  return acc;
end $$;

-- Apply a points event: append ledger row and update balance atomically.
create or replace function public.fp_apply_event(
  wallet_in     text,
  type_in       text,
  points_in     bigint,
  metadata_in   jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  ledger_id bigint;
begin
  perform public.fp_ensure_account(wallet_in);

  insert into public.fun_points_ledger (wallet, type, points, metadata)
  values (wallet_in, type_in, points_in, coalesce(metadata_in, '{}'::jsonb))
  returning id into ledger_id;

  update public.fun_points_accounts
     set total_points    = total_points    + points_in,
         lifetime_points = lifetime_points + greatest(points_in, 0),
         updated_at      = now()
   where wallet = wallet_in;

  return ledger_id;
end $$;

-- Award trade points (1 USD volume = 1 point) and propagate referral bonus.
-- Returns total points awarded to the trader.
create or replace function public.fp_award_trade(
  wallet_in    text,
  cost_sol_in  numeric,
  metadata_in  jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  settings        public.fun_points_settings;
  usd_value       numeric;
  trader_points   bigint;
  referrer_w      text;           -- renamed to avoid collision with the
                                  -- referrals.referrer_wallet column
  referrer_bonus  bigint;
  is_first_trade  boolean;
begin
  if wallet_in is null or wallet_in = '' then
    return 0;
  end if;
  if cost_sol_in is null or cost_sol_in <= 0 then
    return 0;
  end if;

  select * into settings from public.fun_points_settings where id = 1;
  usd_value := cost_sol_in * settings.sol_usd_rate;
  trader_points := floor(usd_value)::bigint;
  if trader_points <= 0 then
    return 0;
  end if;

  -- 1) Award trader
  perform public.fp_apply_event(
    wallet_in,
    'trade_volume',
    trader_points,
    coalesce(metadata_in, '{}'::jsonb) || jsonb_build_object('sol', cost_sol_in, 'usd', usd_value)
  );

  -- 2) Referral propagation, if any
  select r.referrer_wallet into referrer_w
    from public.referrals r where r.referred_wallet = wallet_in;

  if referrer_w is not null then
    -- First trade flag — fires once
    select r.first_trade_at is null into is_first_trade
      from public.referrals r where r.referred_wallet = wallet_in;

    if is_first_trade then
      update public.referrals
         set first_trade_at = now()
       where referred_wallet = wallet_in;

      perform public.fp_apply_event(
        referrer_w,
        'referral_first_trade',
        settings.referral_first_trade_points,
        jsonb_build_object('referred', wallet_in)
      );
    end if;

    referrer_bonus := floor(trader_points * settings.referral_bonus_pct)::bigint;
    if referrer_bonus > 0 then
      perform public.fp_apply_event(
        referrer_w,
        'referral_trade_bonus',
        referrer_bonus,
        jsonb_build_object('referred', wallet_in, 'trader_points', trader_points)
      );
    end if;
  end if;

  return trader_points;
end $$;

-- Claim daily check-in. Idempotent per UTC day. Updates streak.
create or replace function public.fp_claim_daily_checkin(wallet_in text)
returns table (
  awarded boolean,
  points  bigint,
  streak  integer,
  balance bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  settings   public.fun_points_settings;
  today      date := (timezone('UTC', now()))::date;
  existing   public.daily_checkins;
  acc        public.fun_points_accounts;
  new_streak integer;
begin
  if wallet_in is null or wallet_in = '' then
    return query select false, 0::bigint, 0, 0::bigint;
    return;
  end if;

  select * into settings from public.fun_points_settings where id = 1;
  perform public.fp_ensure_account(wallet_in);
  select * into acc from public.fun_points_accounts where wallet = wallet_in;

  select * into existing from public.daily_checkins
    where wallet = wallet_in and date = today;

  if existing.wallet is not null then
    return query select false, 0::bigint, acc.current_streak, acc.total_points;
    return;
  end if;

  if acc.last_checkin_date = today - interval '1 day' then
    new_streak := acc.current_streak + 1;
  else
    new_streak := 1;
  end if;

  insert into public.daily_checkins (wallet, date, streak)
  values (wallet_in, today, new_streak);

  perform public.fp_apply_event(
    wallet_in,
    'daily_checkin',
    settings.daily_checkin_points,
    jsonb_build_object('date', today, 'streak', new_streak)
  );

  update public.fun_points_accounts
     set current_streak     = new_streak,
         last_checkin_date  = today,
         updated_at         = now()
   where wallet = wallet_in;

  select * into acc from public.fun_points_accounts where wallet = wallet_in;

  return query select true, settings.daily_checkin_points, acc.current_streak, acc.total_points;
end $$;

-- Record a referral relationship. No-op if already exists.
create or replace function public.fp_record_referral(
  referrer_in text,
  referred_in text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  settings public.fun_points_settings;
  inserted boolean := false;
begin
  if referrer_in is null or referred_in is null then return false; end if;
  if referrer_in = referred_in then return false; end if;
  if referrer_in = '' or referred_in = '' then return false; end if;

  select * into settings from public.fun_points_settings where id = 1;
  perform public.fp_ensure_account(referrer_in);
  perform public.fp_ensure_account(referred_in);

  insert into public.referrals (referred_wallet, referrer_wallet)
  values (referred_in, referrer_in)
  on conflict (referred_wallet) do nothing;

  get diagnostics inserted = ROW_COUNT;
  if inserted then
    perform public.fp_apply_event(
      referrer_in,
      'referral_signup',
      settings.referral_signup_points,
      jsonb_build_object('referred', referred_in)
    );
    return true;
  end if;

  return false;
end $$;

-- Complete a task. Idempotent.
create or replace function public.fp_complete_task(
  wallet_in text,
  task_id_in uuid
)
returns table (
  awarded boolean,
  points  bigint,
  balance bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  t        public.reward_tasks;
  acc      public.fun_points_accounts;
  inserted boolean := false;
begin
  if wallet_in is null or wallet_in = '' or task_id_in is null then
    return query select false, 0::bigint, 0::bigint;
    return;
  end if;

  select * into t from public.reward_tasks where id = task_id_in and active = true;
  if t.id is null then
    return query select false, 0::bigint, 0::bigint;
    return;
  end if;

  perform public.fp_ensure_account(wallet_in);

  insert into public.task_completions (wallet, task_id)
  values (wallet_in, task_id_in)
  on conflict do nothing;
  get diagnostics inserted = ROW_COUNT;

  if not inserted then
    select * into acc from public.fun_points_accounts where wallet = wallet_in;
    return query select false, 0::bigint, acc.total_points;
    return;
  end if;

  perform public.fp_apply_event(
    wallet_in,
    'task_reward',
    t.points,
    jsonb_build_object('task_id', t.id, 'title', t.title)
  );

  select * into acc from public.fun_points_accounts where wallet = wallet_in;
  return query select true, t.points, acc.total_points;
end $$;

-- =====================================================================
-- RLS policies — anon can read public account/ledger data, only service
-- role can write. All mutations go through SECURITY DEFINER RPCs called
-- by server routes using the service role key.
-- =====================================================================
alter table public.fun_points_accounts enable row level security;
alter table public.fun_points_ledger   enable row level security;
alter table public.referrals           enable row level security;
alter table public.reward_tasks        enable row level security;
alter table public.task_completions    enable row level security;
alter table public.daily_checkins      enable row level security;
alter table public.fun_points_settings enable row level security;

drop policy if exists fpa_read on public.fun_points_accounts;
create policy fpa_read on public.fun_points_accounts for select using (true);

drop policy if exists fpl_read on public.fun_points_ledger;
create policy fpl_read on public.fun_points_ledger for select using (true);

drop policy if exists ref_read on public.referrals;
create policy ref_read on public.referrals for select using (true);

drop policy if exists rt_read on public.reward_tasks;
create policy rt_read on public.reward_tasks for select using (active = true);

drop policy if exists tc_read on public.task_completions;
create policy tc_read on public.task_completions for select using (true);

drop policy if exists dc_read on public.daily_checkins;
create policy dc_read on public.daily_checkins for select using (true);

drop policy if exists fps_read on public.fun_points_settings;
create policy fps_read on public.fun_points_settings for select using (true);

-- Grants.
--   - All mutation RPCs are SECURITY DEFINER and only executable by the
--     service role. The Next.js API routes (which run server-side with
--     the service role key) are the only callers.
--   - The pure helper fp_referral_code_for is safe to expose to anon so
--     the UI can compute a placeholder code before an account exists.
revoke all on function public.fp_ensure_account(text)                   from public;
revoke all on function public.fp_apply_event(text, text, bigint, jsonb) from public;
revoke all on function public.fp_award_trade(text, numeric, jsonb)      from public;
revoke all on function public.fp_claim_daily_checkin(text)              from public;
revoke all on function public.fp_record_referral(text, text)            from public;
revoke all on function public.fp_complete_task(text, uuid)              from public;

grant execute on function public.fp_ensure_account(text)                   to service_role;
grant execute on function public.fp_apply_event(text, text, bigint, jsonb) to service_role;
grant execute on function public.fp_award_trade(text, numeric, jsonb)      to service_role;
grant execute on function public.fp_claim_daily_checkin(text)              to service_role;
grant execute on function public.fp_record_referral(text, text)            to service_role;
grant execute on function public.fp_complete_task(text, uuid)              to service_role;
grant execute on function public.fp_referral_code_for(text)                to anon, authenticated, service_role;
