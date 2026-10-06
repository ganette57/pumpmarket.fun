-- Extracted from play_quote without changing pricing or payout arithmetic.
begin;

create or replace function public.play_quote_readonly(
  wallet_in         text,
  market_address_in text,
  outcome_index_in  integer,
  stake_usd_in      numeric
)
returns jsonb
language plpgsql
stable
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
  if not found then return null; end if;

  stake := trunc(coalesce(stake_usd_in, 0), 2);
  if stake <= 0 then
    raise exception 'play: stake must be greater than zero' using errcode = '22023';
  end if;

  perform public.play_assert_market_tradable(market_address_in);
  select * into st from public.play_market_states where market_address = market_address_in;
  if not found then return null; end if;

  if outcome_index_in < 0 or outcome_index_in >= st.outcome_count then
    raise exception 'play: outcome_index % out of range (0..%)',
      outcome_index_in, st.outcome_count - 1
      using errcode = '22023';
  end if;

  select * into acc from public.play_accounts
   where wallet_address = public.play_normalize_wallet(wallet_in);
  if not found then return null; end if;

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

-- Preserve the existing Trade initialization behavior.
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
  st public.play_market_states;
  stake numeric(18,2);
begin
  stake := trunc(coalesce(stake_usd_in, 0), 2);
  if stake <= 0 then
    raise exception 'play: stake must be greater than zero' using errcode = '22023';
  end if;
  perform public.play_assert_market_tradable(market_address_in);
  st := public.play_ensure_market_state(market_address_in);
  if outcome_index_in < 0 or outcome_index_in >= st.outcome_count then
    raise exception 'play: outcome_index % out of range (0..%)',
      outcome_index_in, st.outcome_count - 1 using errcode = '22023';
  end if;
  perform public.play_ensure_account(wallet_in);
  return public.play_quote_readonly(wallet_in, market_address_in, outcome_index_in, stake);
end $$;

-- One statement/snapshot for all feed outcomes. No initialization helpers.
create or replace function public.play_feed_quotes(wallet_in text, addresses text[])
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp set "TimeZone" = 'UTC'
as $$
declare
  addr text;
  n integer;
  i integer;
  q jsonb;
  items jsonb;
  result jsonb := '{}'::jsonb;
begin
  if addresses is null or cardinality(addresses) > 100 then return result; end if;
  if not exists (select 1 from public.play_accounts
    where wallet_address = public.play_normalize_wallet(wallet_in)) then return result; end if;
  foreach addr in array addresses loop
    begin
      select outcome_count into n from public.play_market_states
        where market_address = addr and status = 'open';
      if not found or n < 2 or n > 10 then continue; end if;
      items := '[]'::jsonb;
      for i in 0..n-1 loop
        q := public.play_quote_readonly(wallet_in, addr, i, 100);
        items := items || jsonb_build_array(q);
      end loop;
      result := result || jsonb_build_object(addr, items);
    exception when sqlstate '22023' or sqlstate 'P0002' then
      continue;
    end;
  end loop;
  return result;
end $$;
revoke all on function public.play_quote_readonly(text, text, integer, numeric) from public, anon, authenticated;
grant execute on function public.play_quote_readonly(text, text, integer, numeric) to service_role;
revoke all on function public.play_feed_quotes(text, text[]) from public, anon, authenticated;
grant execute on function public.play_feed_quotes(text, text[]) to service_role;

commit;
