-- =====================================================================
-- Play Mode — season lifecycle test suite
-- =====================================================================
-- Covers 20260729_play_season_lifecycle.sql: the expired-season deadlock
-- that blocked every Play buy and every Play settlement, and the removal
-- of settlement's dependency on a season covering now().
--
-- Repeatable, self-contained, NON-DESTRUCTIVE. The whole script runs in
-- one transaction and ends with ROLLBACK, so it leaves the database
-- exactly as it found it — including the synthetic public.markets rows.
--
-- Run against a DEVELOPMENT database only:
--   psql "$DEV_DATABASE_URL" -f supabase/tests/20260729_play_season_lifecycle_test.sql
--
-- Every check uses plpgsql ASSERT: the script aborts on the first failure
-- with the offending values in the message.
--
-- Numbering matches the validation list in the season-lifecycle brief:
--   1  no current season
--   2  first Play buy auto-rolls
--   3  second buy reuses the season
--   4  no duplicate / overlapping seasons
--   5  old trade keeps its old season across the boundary
--   6  old trade settles after its season expired
--   7  refund settles after its season expired
--   8  settlement is idempotent — no duplicate ledger rows
--   9  the automatic path never resets a bankroll
--   10 the admin rollover still does
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
DO $fixtures$
DECLARE
  fixture_creator constant text := 'PLAYTESTCreator111111111111111111111111111';
BEGIN
  INSERT INTO public.markets (
    market_address, creator, question, market_type, outcome_names,
    resolution_status, resolved, end_date
  ) VALUES (
    'PLAYSEASONMarketWin1111111111111111111111', fixture_creator,
    '[TEST] Season lifecycle — finalized', 0, '["YES","NO"]'::jsonb,
    'open', false, now() + interval '7 days'
  );

  INSERT INTO public.markets (
    market_address, creator, question, market_type, outcome_names,
    resolution_status, resolved, end_date
  ) VALUES (
    'PLAYSEASONMarketCancel22222222222222222222', fixture_creator,
    '[TEST] Season lifecycle — cancelled', 0, '["YES","NO"]'::jsonb,
    'open', false, now() + interval '7 days'
  );
END $fixtures$;


-- =====================================================================
-- 1 + 2 + 3 + 4. THE DEADLOCK — an expired season that is still 'open'
-- =====================================================================
-- This is the exact production state: play_seasons_single_open_idx allows
-- one 'open' row, that row's window has passed, and every insert of a
-- covering season is therefore rejected. Before the fix play_execute_trade
-- raised "no open season covers now(); run play_rollover_season()" and
-- stayed broken until a human ran SQL.
-- =====================================================================
DO $t1$
DECLARE
  mkt   text := 'PLAYSEASONMarketWin1111111111111111111111';
  hana  text := 'PLAYSEASONWalletHana11111111111111111111';
  acc   public.play_accounts;
  stale_season integer;
  new_season   integer;
  t1_season    integer;
  t2_season    integer;
  n_open       integer;
  n_covering   integer;
BEGIN
  -- Establish a season, then force it into the expired-but-open state.
  --
  -- Expiry is always expressed by SHRINKING ends_at down to starts_at, never
  -- by moving starts_at back: the new range is a subset of the old one, so it
  -- can never collide with a season this dev database already has, and the
  -- season the rollover opens next starts exactly where this one now ends.
  stale_season := (public.play_current_season()).id;
  UPDATE public.play_seasons
     SET ends_at = starts_at + interval '1 microsecond'
   WHERE id = stale_season;

  -- 1. Precondition: nothing covers now(), and the stale row still blocks
  --    the single-open index.
  SELECT count(*) INTO n_covering FROM public.play_seasons
   WHERE status = 'open' AND starts_at <= now() AND ends_at > now();
  ASSERT n_covering = 0, 'precondition: no season may cover now()';
  ASSERT (SELECT status FROM public.play_seasons WHERE id = stale_season) = 'open',
    'precondition: the expired season must still be open';

  -- 2. The first buy heals it. No operator, no SQL, no admin action.
  acc := public.play_ensure_account(hana);
  PERFORM public.play_execute_trade(hana, mkt, 0, 1000, 'hana-first');

  SELECT season_id INTO t1_season FROM public.play_trades
   WHERE client_trade_id = 'hana-first';

  new_season := (public.play_current_season()).id;
  ASSERT new_season <> stale_season, 'the buy must open a NEW season';
  ASSERT t1_season = new_season, 'the buy must be stamped with the new season';
  ASSERT (SELECT status FROM public.play_seasons WHERE id = stale_season) = 'closed',
    'the expired season must be closed by the automatic roll';
  ASSERT (SELECT ends_at FROM public.play_seasons WHERE id = new_season) > now()
     AND (SELECT starts_at FROM public.play_seasons WHERE id = new_season) <= now(),
    'the new season must actually cover now()';

  -- 3. The second buy REUSES it — the roll happens once, not per trade.
  PERFORM public.play_execute_trade(hana, mkt, 1, 1000, 'hana-second');
  SELECT season_id INTO t2_season FROM public.play_trades
   WHERE client_trade_id = 'hana-second';
  ASSERT t2_season = new_season, 'the second buy must reuse the same season';

  -- 4. Exactly one open season, and exactly one covering now().
  SELECT count(*) INTO n_open FROM public.play_seasons WHERE status = 'open';
  ASSERT n_open = 1, format('exactly one open season expected, found %s', n_open);

  SELECT count(*) INTO n_covering FROM public.play_seasons
   WHERE starts_at <= now() AND ends_at > now();
  ASSERT n_covering = 1,
    format('exactly one season may cover now(), found %s', n_covering);

  RAISE NOTICE 'PASS 1-4 — an expired season self-heals on the first buy, once';
END $t1$;


-- =====================================================================
-- 5 + 6 + 8. HISTORICAL SETTLEMENT — a trade outlives its season
-- =====================================================================
-- Settlement must not need a season covering now(). It stamps the ledger
-- with the TRADE's season, so a position placed weeks ago settles normally
-- and stays attributed to the season it was placed in.
-- =====================================================================
DO $t5$
DECLARE
  mkt        text := 'PLAYSEASONMarketWin1111111111111111111111';
  hana       text := 'PLAYSEASONWalletHana11111111111111111111';
  trade      public.play_trades;
  old_season integer;
  r          jsonb;
  n_ledger   integer;
  bal_before numeric(18,2);
  bal_after  numeric(18,2);
BEGIN
  SELECT * INTO trade FROM public.play_trades WHERE client_trade_id = 'hana-first';
  old_season := trade.season_id;

  -- Expire the season the positions were placed in, and leave NOTHING
  -- covering now() — the state settlement used to refuse in.
  UPDATE public.play_seasons
     SET ends_at = starts_at + interval '1 microsecond'
   WHERE id = old_season;

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.play_seasons
     WHERE status = 'open' AND starts_at <= now() AND ends_at > now()
  ), 'precondition: no season may cover now() at settlement time';

  SELECT balance_usd INTO bal_before FROM public.play_accounts
   WHERE wallet_address = hana;

  UPDATE public.markets
     SET resolution_status = 'finalized', winning_outcome = 0, resolved = true
   WHERE market_address = mkt;

  -- 6. Settles normally, with no season covering now().
  r := public.play_settle_market(mkt);
  ASSERT (r->>'settled')::boolean = true,
    format('historical settlement must succeed: %s', r::text);
  ASSERT (r->>'already_settled')::boolean = false, 'this call must move the money';
  ASSERT (r->>'trades_settled')::integer = 2,
    format('both positions must settle, got %s', r->>'trades_settled');

  SELECT * INTO trade FROM public.play_trades WHERE client_trade_id = 'hana-first';
  ASSERT trade.status = 'won', 'the winning position must settle to won';

  -- 5. The trade did NOT move seasons.
  ASSERT trade.season_id = old_season,
    'a settled trade must keep the season it was placed in';

  -- The payout ledger row carries the POSITION's season.
  ASSERT (SELECT season_id FROM public.play_ledger
           WHERE trade_id = trade.id AND kind = 'trade_payout') = old_season,
    'the payout ledger row must carry the trade season, not a current one';

  SELECT balance_usd INTO bal_after FROM public.play_accounts
   WHERE wallet_address = hana;
  ASSERT bal_after > bal_before, 'the payout must land in the current balance';

  -- 8. Repeat settlement is a true no-op — no second credit, no second row.
  r := public.play_settle_market(mkt);
  ASSERT (r->>'already_settled')::boolean = true, 'the repeat must report already_settled';
  ASSERT (r->>'trades_settled')::integer = 0, 'the repeat must settle nothing';

  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE wallet_address = hana)
         = bal_after,
    'a repeated settlement must not move one cent';

  SELECT count(*) INTO n_ledger FROM public.play_ledger
   WHERE trade_id = trade.id AND kind = 'trade_payout';
  ASSERT n_ledger = 1,
    format('exactly one payout ledger row expected, found %s', n_ledger);

  RAISE NOTICE 'PASS 5,6,8 — historical settlement needs no current season, and repeats cleanly';
END $t5$;


-- =====================================================================
-- 7. REFUND AFTER THE SEASON EXPIRED
-- =====================================================================
DO $t7$
DECLARE
  mkt   text := 'PLAYSEASONMarketCancel22222222222222222222';
  ivo   text := 'PLAYSEASONWalletIvo222222222222222222222';
  acc   public.play_accounts;
  trade public.play_trades;
  old_season integer;
  r     jsonb;
  n_ledger integer;
BEGIN
  acc := public.play_ensure_account(ivo);
  PERFORM public.play_execute_trade(ivo, mkt, 0, 500, 'ivo-refund');

  SELECT * INTO trade FROM public.play_trades WHERE client_trade_id = 'ivo-refund';
  old_season := trade.season_id;

  -- Expire the season, leaving nothing covering now().
  UPDATE public.play_seasons
     SET ends_at = starts_at + interval '1 microsecond'
   WHERE id = old_season;

  UPDATE public.markets
     SET resolution_status = 'cancelled', cancelled = true, resolved = false
   WHERE market_address = mkt;

  r := public.play_settle_market(mkt);
  ASSERT (r->>'settled')::boolean = true,
    format('a cancelled market must refund after its season expired: %s', r::text);

  SELECT * INTO trade FROM public.play_trades WHERE client_trade_id = 'ivo-refund';
  ASSERT trade.status = 'refunded', 'the position must be refunded';
  ASSERT trade.payout_usd = 500, 'a refund returns the stake exactly';
  ASSERT trade.realized_pnl_usd = 0, 'a refund realizes no P&L';
  ASSERT trade.season_id = old_season, 'a refunded trade keeps its original season';

  ASSERT (SELECT season_id FROM public.play_ledger
           WHERE trade_id = trade.id AND kind = 'trade_refund') = old_season,
    'the refund ledger row must carry the trade season';

  PERFORM public.play_settle_market(mkt);
  SELECT count(*) INTO n_ledger FROM public.play_ledger
   WHERE trade_id = trade.id AND kind = 'trade_refund';
  ASSERT n_ledger = 1, 'a repeated refund must not double-credit';

  RAISE NOTICE 'PASS 7 — refunds settle after their season expired, exactly once';
END $t7$;


-- =====================================================================
-- 9 + 10. BANKROLL — automatic never resets, admin still does
-- =====================================================================
-- The whole point of the reset switch: recovering the season inside a
-- user's buy must not zero anybody's money, while the weekly admin
-- rollover must keep zeroing it exactly as before.
-- =====================================================================
DO $t9$
DECLARE
  mkt    text := 'PLAYSEASONMarketWin1111111111111111111111';
  jules  text := 'PLAYSEASONWalletJules3333333333333333333';
  acc    public.play_accounts;
  bal_before numeric(18,2);
  bal_after  numeric(18,2);
  season_id_before integer;
  r      jsonb;
  n_reset integer;
BEGIN
  -- Fund an account, then strand the season in the expired-open state.
  acc := public.play_ensure_account(jules);
  PERFORM public.play_ensure_daily_grant(acc.id);
  SELECT balance_usd INTO bal_before FROM public.play_accounts WHERE id = acc.id;
  ASSERT bal_before > 0, 'precondition: the account must hold a bankroll';

  season_id_before := (public.play_current_season()).id;
  UPDATE public.play_seasons
     SET ends_at = starts_at + interval '1 microsecond'
   WHERE id = season_id_before;

  -- 9. The automatic path (reset off) rolls the season and leaves money alone.
  r := public.play_rollover_season(false);
  ASSERT (r->>'rolled')::boolean = true, format('the season must roll: %s', r::text);
  ASSERT (r->>'reset_bankrolls')::boolean = false, 'the automatic path must not reset';
  ASSERT (r->>'accounts_reset')::integer = 0, 'the automatic path must reset no account';

  SELECT balance_usd INTO bal_after FROM public.play_accounts WHERE id = acc.id;
  ASSERT bal_after = bal_before,
    format('an automatic roll must not touch a balance (%s -> %s)', bal_before, bal_after);

  SELECT count(*) INTO n_reset FROM public.play_ledger
   WHERE account_id = acc.id AND kind = 'season_reset';
  ASSERT n_reset = 0, 'an automatic roll must write no season_reset ledger row';

  -- 10. The admin rollover still resets the competition bankroll.
  UPDATE public.play_seasons
     SET ends_at = starts_at + interval '1 microsecond'
   WHERE status = 'open';

  r := public.play_rollover_season();
  ASSERT (r->>'rolled')::boolean = true, format('the admin roll must run: %s', r::text);
  ASSERT (r->>'reset_bankrolls')::boolean = true, 'the no-argument roll must reset';
  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE id = acc.id) = 0,
    'the weekly admin rollover must still zero the bankroll';

  SELECT count(*) INTO n_reset FROM public.play_ledger
   WHERE account_id = acc.id AND kind = 'season_reset';
  ASSERT n_reset = 1, 'the admin roll must write exactly one season_reset row';

  RAISE NOTICE 'PASS 9,10 — automatic rolls never reset a bankroll; the admin roll still does';
END $t9$;


-- =====================================================================
-- SUMMARY
-- =====================================================================
DO $summary$
DECLARE
  n_open integer; n_seasons integer;
BEGIN
  SELECT count(*) INTO n_open    FROM public.play_seasons WHERE status = 'open';
  SELECT count(*) INTO n_seasons FROM public.play_seasons;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'ALL PLAY SEASON LIFECYCLE TESTS PASSED';
  RAISE NOTICE '  seasons=% open=%', n_seasons, n_open;
  RAISE NOTICE 'Rolling back — the database is left untouched.';
  RAISE NOTICE '=====================================================';
END $summary$;

ROLLBACK;


-- =====================================================================
-- MANUAL: concurrent first buys (cannot be expressed in one session)
-- =====================================================================
-- Two psql sessions against a dev database, with the single open season
-- forced into the expired state first:
--
--   UPDATE play_seasons SET ends_at = now() - interval '1 day'
--    WHERE status = 'open';
--
--   Session A                              Session B
--   ---------                              ---------
--   BEGIN;
--   SELECT play_execute_trade(
--     'WA...', 'MKT...', 0, 100, 'a1');
--                                          BEGIN;
--                                          SELECT play_execute_trade(
--                                            'WB...','MKT...',0,100,'b1');
--                                          -- blocks on
--                                          -- pg_advisory_xact_lock
--   COMMIT;
--                                          -- unblocks, sees A's season,
--                                          -- rolls nothing
--                                          COMMIT;
--
-- Expected afterwards:
--   SELECT count(*) FROM play_seasons WHERE status = 'open';        -- 1
--   SELECT count(*) FROM play_seasons
--    WHERE starts_at <= now() AND ends_at > now();                  -- 1
--   SELECT DISTINCT season_id FROM play_trades
--    WHERE client_trade_id IN ('a1','b1');                          -- one row
-- =====================================================================
