-- Phase 2 hotfix #2 — rebalance reward defaults to current live values
--
-- This migration brings every column default in fun_points_settings, and
-- the single settings row (id = 1), up to the post-Phase-2.1 rebalance.
-- All five tunables are listed explicitly so this file is authoritative:
-- applying it (and the base schema) is enough to land at the correct
-- runtime state, no matter what previous state the DB was in.
--
-- Current live values:
--   sol_usd_rate                = 150
--   referral_signup_points      = 25     (rebalanced; was 100)
--   referral_first_trade_points = 100    (rebalanced; was 250)
--   referral_bonus_pct          = 0.10
--   daily_checkin_points        = 10
--
-- Idempotent: safe to re-run. Safe whether the settings row already
-- exists or not (fresh installs insert; existing installs update).
--
-- Prerequisite: the base schema (20260608_fun_points_phase2.sql) must
-- have created the public.fun_points_settings table.

-- ---------------------------------------------------------------------
-- 1. Column defaults
--    `alter column ... set default <X>` is naturally idempotent — each
--    statement just declares the desired default; replays are no-ops.
-- ---------------------------------------------------------------------
alter table public.fun_points_settings
  alter column sol_usd_rate                set default 150;

alter table public.fun_points_settings
  alter column referral_signup_points      set default 25;

alter table public.fun_points_settings
  alter column referral_first_trade_points set default 100;

alter table public.fun_points_settings
  alter column referral_bonus_pct          set default 0.10;

alter table public.fun_points_settings
  alter column daily_checkin_points        set default 10;

-- ---------------------------------------------------------------------
-- 2. Bring the singleton row up to the live values.
--    INSERT branch covers the fresh-install case (no row id=1 yet).
--    ON CONFLICT branch covers the row-already-exists case.
--    Either way we end at the same authoritative state.
-- ---------------------------------------------------------------------
insert into public.fun_points_settings (
  id,
  sol_usd_rate,
  referral_signup_points,
  referral_first_trade_points,
  referral_bonus_pct,
  daily_checkin_points
) values (
  1,
  150,
  25,
  100,
  0.10,
  10
)
on conflict (id) do update set
  sol_usd_rate                = excluded.sol_usd_rate,
  referral_signup_points      = excluded.referral_signup_points,
  referral_first_trade_points = excluded.referral_first_trade_points,
  referral_bonus_pct          = excluded.referral_bonus_pct,
  daily_checkin_points        = excluded.daily_checkin_points,
  updated_at                  = now();
