-- =====================================================================
-- LIVE FLASH MARKETS — AUTHORITATIVE TRADE LOCK
-- =====================================================================
-- A live flash market now starts immediately and runs for its full
-- selected duration, but trading is only open for the FIRST slice of it:
--
--     started_at = T0
--     lock_at    = T0 + trade window   <- trading closes here
--     end_at     = T0 + duration       <- market ends here (unchanged)
--
-- The final stretch is watch-only. The result still concerns the whole
-- original market window, so `markets.end_date` is NOT moved — the lock is
-- a NEW, separate timestamp.
--
-- The duration -> trade-window mapping lives in exactly one place,
-- app/src/lib/liveFlashWindows.ts. This migration deliberately does not
-- restate it: it enforces whatever lock timestamp the creation path wrote,
-- it does not compute one.
--
-- WHY THIS FILE AND NOT AN EDIT TO 20260721
-- -----------------------------------------
-- 20260721_play_mode_core.sql has been superseded in places by
-- 20260722 and 20260729 (play_settle_market, play_current_season,
-- play_ensure_daily_grant, play_rollover_season). Editing and replaying
-- 20260721 would silently roll those four money functions back to their
-- original bodies. This migration therefore only touches the ONE function
-- it needs, and 20260721 stays exactly as it was.


-- =====================================================================
-- 1. THE LOCK COLUMN
-- =====================================================================
-- Null means "no trade lock", never "locked": every market that predates
-- this migration, and every non-flash market, keeps trading until
-- end_date exactly as before.
alter table public.markets
  add column if not exists trading_lock_at timestamptz;

comment on column public.markets.trading_lock_at is
  'Live flash markets: the instant trading closes, EARLIER than end_date. '
  'The market stays viewable and its result still covers the full end_date '
  'window. Null = no trade lock (all non-flash and all pre-2026-08 markets).';


-- =====================================================================
-- 2. TRADABILITY GATE — now also enforces the trade lock
-- =====================================================================
-- Unchanged from 20260721 except for the final block. Every existing
-- refusal (not found / blocked / resolved / status / end_date) keeps its
-- exact message and errcode, so nothing that parses these strings breaks.
--
-- This is the single shared Play tradability guard: play_quote and
-- play_execute_trade both `perform` it, so the lock applies to the
-- authoritative execution path and not merely to the quote. A caller that
-- bypasses the UI and POSTs straight to /api/play/trade hits it just the
-- same, and the comparison uses Postgres now() inside the trade
-- transaction — never a browser clock.
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
  select market_address, resolution_status, resolved, is_blocked, end_date,
         trading_lock_at
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

  -- NEW: the flash-market trade window. Checked LAST so a market that is
  -- both locked and, say, blocked still reports the more fundamental
  -- reason. The message is stable and safe to show a trader verbatim —
  -- playEngine forwards any 'play: ' prefixed refusal straight through.
  if m.trading_lock_at is not null and m.trading_lock_at <= now() then
    raise exception 'play: trading is locked for this market'
      using errcode = '22023';
  end if;
end $$;

-- NO GRANT/REVOKE STATEMENTS, DELIBERATELY.
--
-- `create or replace function` PRESERVES the existing ACL — only a fresh
-- `create` assigns defaults. So this migration cannot widen who may execute
-- the guard, and restating 20260721's grants would risk overwriting any
-- permission hardening production has applied since. Whatever the privileges
-- are today, they are exactly what they will be afterwards.
--
-- No index is added either: nothing queries BY trading_lock_at (every lookup
-- is by market_address, already indexed), so an index here would be write
-- cost for no read.
