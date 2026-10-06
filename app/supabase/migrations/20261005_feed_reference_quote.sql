-- Read-only $100 NEW-position quote inputs. Reuses the exact pricing function
-- called by play_quote; never creates accounts, books, or trades.
create or replace function public.play_feed_quote_inputs(addresses text[])
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp set "TimeZone" = 'UTC'
as $$
declare
  cfg public.play_settings;
  st public.play_market_states;
  addr text;
  n integer;
  i integer;
  q numeric;
  bought numeric;
  held numeric;
  items jsonb;
  result jsonb := '{}'::jsonb;
begin
  if cardinality(addresses) > 100 then return result; end if;
  select * into cfg from public.play_settings where id = 1;
  if not found then return result; end if;
  foreach addr in array addresses loop
    begin
      perform public.play_assert_market_tradable(addr);
      select * into st from public.play_market_states where market_address = addr;
      if found then
        if st.status <> 'open' then continue; end if;
        n := st.outcome_count;
      else
        select case when jsonb_array_length(to_jsonb(outcome_names)) >= 2
          then jsonb_array_length(to_jsonb(outcome_names))
          when coalesce(market_type, 0) = 0 then 2 else 0 end into n
          from public.markets where market_address = addr;
      end if;
      if n is null or n < 2 or n > cfg.max_outcomes then continue; end if;
      items := '[]'::jsonb;
      for i in 0..n-1 loop
        q := case when st.market_address is null then cfg.initial_supply_per_outcome
          else st.outcome_supplies[i+1] end;
        if q is null or q < 0 then
          raise exception 'invalid book' using errcode = '22023';
        end if;
        bought := public.play_shares_for_stake(q, 100, cfg.base_price_usd, cfg.slope_usd_per_share);
        select coalesce(sum(shares), 0) into held from public.play_trades
          where market_address = addr and outcome_index = i and status = 'open';
        items := items || jsonb_build_array(jsonb_build_object(
          'shares', bought::text, 'totalWinningShares', (held + bought)::text,
          'finalPoolUsd', (coalesce(st.virtual_pool_usd, 0) + 100)::text));
      end loop;
      result := result || jsonb_build_object(addr, items);
    exception when sqlstate '22023' or sqlstate 'P0002' then
      continue; -- A closed/unavailable market must not hide other estimates.
    end;
  end loop;
  return result;
end $$;
revoke all on function public.play_feed_quote_inputs(text[]) from public, anon, authenticated;
grant execute on function public.play_feed_quote_inputs(text[]) to service_role;
