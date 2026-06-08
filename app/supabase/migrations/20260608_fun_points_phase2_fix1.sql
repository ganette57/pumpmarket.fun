-- Phase 2 hotfix #1
-- The first version of fp_award_trade declared a local variable named
-- `referrer_wallet`, which collides with the referrals.referrer_wallet
-- column inside the SELECT INTO. Postgres returns:
--   42702: column reference "referrer_wallet" is ambiguous
-- This recreates the function with a renamed variable and explicit
-- table aliases. No data change, idempotent.

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
  referrer_w      text;
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

  perform public.fp_apply_event(
    wallet_in,
    'trade_volume',
    trader_points,
    coalesce(metadata_in, '{}'::jsonb) || jsonb_build_object('sol', cost_sol_in, 'usd', usd_value)
  );

  select r.referrer_wallet into referrer_w
    from public.referrals r where r.referred_wallet = wallet_in;

  if referrer_w is not null then
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

revoke all on function public.fp_award_trade(text, numeric, jsonb) from public;
grant execute on function public.fp_award_trade(text, numeric, jsonb) to service_role;
