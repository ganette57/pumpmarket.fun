-- =====================================================================
-- Play Mode Phase 1 — engine test suite
-- =====================================================================
-- Repeatable, self-contained, NON-DESTRUCTIVE.
--
-- The whole script runs inside a single transaction and ends with
-- ROLLBACK, so it leaves the database exactly as it found it — including
-- the three synthetic rows it writes into public.markets.
--
-- Run against a DEVELOPMENT database only:
--   psql "$DEV_DATABASE_URL" -f supabase/tests/20260721_play_mode_core_test.sql
--
-- Every check uses plpgsql ASSERT. The script aborts on the first
-- failure with the offending values in the message. Success prints a
-- summary and rolls back.
--
-- NOTE: the synthetic market INSERTs below cover every NOT NULL column
-- without a default observed on public.markets in Supabase Dev:
--   market_address text                        NOT NULL
--   end_date       timestamp without time zone NOT NULL
--   creator        text                        NOT NULL
-- If your database has further NOT NULL columns without defaults, add
-- them to all three INSERTs.
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------
-- Deterministic, obviously-fake base58-shaped addresses and wallets.
--
-- `creator` is NOT NULL on public.markets. Play never reads it — no Play
-- function references the column — so a single shared placeholder is
-- enough for all three fixtures and keeps them obviously synthetic.

DO $fixtures$
DECLARE
  fixture_creator constant text := 'PLAYTESTCreator111111111111111111111111111';
BEGIN
  INSERT INTO public.markets (
    market_address, creator, question, market_type, outcome_names,
    resolution_status, resolved, end_date
  ) VALUES (
    'PLAYTESTMarket2Outcomes1111111111111111111', fixture_creator,
    '[TEST] Two outcome market', 0, '["YES","NO"]'::jsonb,
    'open', false, now() + interval '7 days'
  );

  INSERT INTO public.markets (
    market_address, creator, question, market_type, outcome_names,
    resolution_status, resolved, end_date
  ) VALUES (
    'PLAYTESTMarket3Outcomes2222222222222222222', fixture_creator,
    '[TEST] Three outcome market', 1, '["A","B","C"]'::jsonb,
    'open', false, now() + interval '7 days'
  );

  -- Dedicated market for the no-winning-positions rule (test 8B).
  INSERT INTO public.markets (
    market_address, creator, question, market_type, outcome_names,
    resolution_status, resolved, end_date
  ) VALUES (
    'PLAYTESTMarketNoWinner3333333333333333333', fixture_creator,
    '[TEST] Nobody backs the winner', 0, '["YES","NO"]'::jsonb,
    'open', false, now() + interval '7 days'
  );
END $fixtures$;


-- =====================================================================
-- 1. PRICING PRIMITIVES — the inverse must round-trip
-- =====================================================================
DO $t1$
DECLARE
  cfg   public.play_settings;
  n     numeric;
  cost  numeric;
  stake numeric;
BEGIN
  SELECT * INTO cfg FROM public.play_settings WHERE id = 1;

  -- For a range of stakes and starting supplies, shares_for_stake and
  -- cost_for_shares must be exact inverses (within truncation error).
  FOREACH stake IN ARRAY ARRAY[1, 100, 500, 1000, 10000, 50000]::numeric[]
  LOOP
    n := public.play_shares_for_stake(
           5000, stake, cfg.base_price_usd, cfg.slope_usd_per_share);
    cost := public.play_cost_for_shares(
           5000, n, cfg.base_price_usd, cfg.slope_usd_per_share);

    ASSERT n > 0, format('shares_for_stake returned %s for stake %s', n, stake);
    ASSERT cost <= stake + 0.000001,
      format('round-trip cost %s exceeds stake %s', cost, stake);
    ASSERT cost >= stake - 0.01,
      format('round-trip cost %s undershoots stake %s', cost, stake);
  END LOOP;

  -- Monotonic: more stake buys more shares.
  ASSERT public.play_shares_for_stake(5000, 1000, cfg.base_price_usd, cfg.slope_usd_per_share)
       > public.play_shares_for_stake(5000,  500, cfg.base_price_usd, cfg.slope_usd_per_share),
    'shares must increase with stake';

  -- Convex: a higher starting supply buys FEWER shares for the same money.
  ASSERT public.play_shares_for_stake(9000, 500, cfg.base_price_usd, cfg.slope_usd_per_share)
       < public.play_shares_for_stake(5000, 500, cfg.base_price_usd, cfg.slope_usd_per_share),
    'price must rise with supply';

  -- Zero / negative stake buys nothing.
  ASSERT public.play_shares_for_stake(5000, 0, cfg.base_price_usd, cfg.slope_usd_per_share) = 0,
    'zero stake must buy zero shares';

  RAISE NOTICE 'PASS 1 — pricing primitives round-trip and are monotonic/convex';
END $t1$;


-- =====================================================================
-- 2. FRESH MARKET OPENS EVEN (2 outcomes ~50/50, 3 outcomes ~33/33/33)
-- =====================================================================
DO $t2$
DECLARE
  st2   public.play_market_states;
  st3   public.play_market_states;
  p2    numeric[];
  p3    numeric[];
BEGIN
  st2 := public.play_ensure_market_state('PLAYTESTMarket2Outcomes1111111111111111111');
  st3 := public.play_ensure_market_state('PLAYTESTMarket3Outcomes2222222222222222222');

  ASSERT st2.outcome_count = 2, format('expected 2 outcomes, got %s', st2.outcome_count);
  ASSERT st3.outcome_count = 3, format('expected 3 outcomes, got %s', st3.outcome_count);
  ASSERT st2.virtual_pool_usd = 0, 'fresh pool must be zero';
  ASSERT st2.status = 'open', 'fresh state must be open';
  ASSERT st2.version = 0, 'fresh state version must be 0';

  p2 := public.play_implied_probs(st2.outcome_supplies);
  p3 := public.play_implied_probs(st3.outcome_supplies);

  ASSERT p2[1] = 0.500000 AND p2[2] = 0.500000,
    format('2-outcome fresh book must be 50/50, got %s', p2::text);
  ASSERT p3[1] = 0.333333 AND p3[2] = 0.333333 AND p3[3] = 0.333333,
    format('3-outcome fresh book must be 33/33/33, got %s', p3::text);

  -- Idempotent: calling again must not create a second state.
  PERFORM public.play_ensure_market_state('PLAYTESTMarket2Outcomes1111111111111111111');
  ASSERT (SELECT count(*) FROM public.play_market_states
           WHERE market_address = 'PLAYTESTMarket2Outcomes1111111111111111111') = 1,
    'ensure_market_state must be idempotent';

  RAISE NOTICE 'PASS 2 — fresh markets open evenly and state creation is idempotent';
END $t2$;


-- =====================================================================
-- 3. ACCOUNT CREATION + DAILY GRANT IDEMPOTENCY
-- =====================================================================
DO $t3$
DECLARE
  cfg  public.play_settings;
  a1   public.play_accounts;
  a1b  public.play_accounts;
  bal  numeric;
  n_grants integer;
BEGIN
  SELECT * INTO cfg FROM public.play_settings WHERE id = 1;

  a1 := public.play_ensure_account('PLAYTESTWalletAlice111111111111111111111');
  ASSERT a1.id IS NOT NULL, 'account must be created';
  ASSERT a1.balance_usd = 0, 'new account starts at zero';

  -- Same wallet must resolve to the same UUID, never a duplicate.
  a1b := public.play_ensure_account('  PLAYTESTWalletAlice111111111111111111111  ');
  ASSERT a1b.id = a1.id, 'whitespace-padded wallet must resolve to the same account';
  ASSERT (SELECT count(*) FROM public.play_accounts
           WHERE wallet_address = 'PLAYTESTWalletAlice111111111111111111111') = 1,
    'ensure_account must never duplicate a wallet';

  -- First grant credits exactly the configured amount.
  bal := public.play_ensure_daily_grant(a1.id);
  ASSERT bal = cfg.daily_grant_usd,
    format('first grant should be %s, balance is %s', cfg.daily_grant_usd, bal);

  -- Repeated calls on the same UTC day are no-ops.
  PERFORM public.play_ensure_daily_grant(a1.id);
  PERFORM public.play_ensure_daily_grant(a1.id);
  bal := public.play_ensure_daily_grant(a1.id);
  ASSERT bal = cfg.daily_grant_usd,
    format('grant must not stack, balance is %s', bal);

  SELECT count(*) INTO n_grants FROM public.play_ledger
    WHERE account_id = a1.id AND kind = 'daily_grant';
  ASSERT n_grants = 1, format('expected exactly 1 grant ledger row, got %s', n_grants);

  RAISE NOTICE 'PASS 3 — account creation dedupes and the daily grant is idempotent';
END $t3$;


-- =====================================================================
-- 3B. SIGN-IN NONCES — single use, wallet-bound, TTL, outstanding cap
-- =====================================================================
DO $t3b$
DECLARE
  alice text := 'PLAYTESTWalletAlice111111111111111111111';
  mallory text := 'PLAYTESTWalletMallory888888888888888888';
  n1    public.play_auth_nonces;
  got   public.play_auth_nonces;
  failed boolean := false;
  i     integer;
BEGIN
  n1 := public.play_issue_nonce(alice, repeat('a', 64), 300);
  ASSERT n1.nonce IS NOT NULL, 'nonce must be issued';
  ASSERT n1.consumed_at IS NULL, 'fresh nonce must be unconsumed';
  ASSERT n1.expires_at > now(), 'fresh nonce must be in the future';
  ASSERT n1.wallet_address = alice, 'nonce must be bound to the wallet';

  -- Wrong wallet cannot redeem it.
  got := public.play_consume_nonce(n1.nonce, mallory);
  ASSERT got.nonce IS NULL, 'a nonce must not be redeemable by another wallet';

  -- Correct wallet redeems it once.
  got := public.play_consume_nonce(n1.nonce, alice);
  ASSERT got.nonce IS NOT NULL, 'the bound wallet must be able to redeem';
  ASSERT got.consumed_at IS NOT NULL, 'redemption must stamp consumed_at';

  -- REPLAY: the same nonce must never work twice.
  got := public.play_consume_nonce(n1.nonce, alice);
  ASSERT got.nonce IS NULL, 'a consumed nonce must never be redeemable again';

  -- Unknown nonce.
  got := public.play_consume_nonce(repeat('z', 64), alice);
  ASSERT got.nonce IS NULL, 'an unknown nonce must not redeem';

  -- Expired nonce (TTL is clamped to >= 30s, so expire it by hand).
  PERFORM public.play_issue_nonce(alice, repeat('b', 64), 300);
  UPDATE public.play_auth_nonces
     SET expires_at = now() - interval '1 second'
   WHERE nonce = repeat('b', 64);
  got := public.play_consume_nonce(repeat('b', 64), alice);
  ASSERT got.nonce IS NULL, 'an expired nonce must not redeem';

  -- Outstanding-challenge cap: the 6th live nonce must be refused.
  FOR i IN 1..5 LOOP
    PERFORM public.play_issue_nonce(mallory, repeat(i::text, 64), 300);
  END LOOP;
  BEGIN
    PERFORM public.play_issue_nonce(mallory, repeat('c', 64), 300);
  EXCEPTION WHEN others THEN
    failed := true;
  END;
  ASSERT failed, 'issuing unbounded live nonces for one wallet must be refused';

  -- Malformed nonce is rejected.
  failed := false;
  BEGIN
    PERFORM public.play_issue_nonce(alice, 'short', 300);
  EXCEPTION WHEN others THEN failed := true; END;
  ASSERT failed, 'a malformed nonce must be rejected';

  RAISE NOTICE 'PASS 3B — nonces are single-use, wallet-bound, TTL-checked and capped';
END $t3b$;


-- =====================================================================
-- 4. FIRST TRADE, CONSECUTIVE TRADES, OPPOSING TRADES
-- =====================================================================
DO $t4$
DECLARE
  mkt   text := 'PLAYTESTMarket2Outcomes1111111111111111111';
  alice text := 'PLAYTESTWalletAlice111111111111111111111';
  r     jsonb;
  st    public.play_market_states;
  s0_a  numeric; s1_a numeric;
  s0_b  numeric; s1_b numeric;
  bal   numeric;
BEGIN
  SELECT * INTO st FROM public.play_market_states WHERE market_address = mkt;
  s0_a := st.outcome_supplies[1];
  s1_a := st.outcome_supplies[2];

  -- First trade: $500 on outcome 0
  r := public.play_execute_trade(alice, mkt, 0, 500, 'test-trade-1');
  ASSERT (r->>'replayed')::boolean = false, 'first trade must not be a replay';

  SELECT * INTO st FROM public.play_market_states WHERE market_address = mkt;
  s0_b := st.outcome_supplies[1];
  s1_b := st.outcome_supplies[2];

  ASSERT s0_b > s0_a, 'traded outcome supply must increase';
  ASSERT s1_b = s1_a, 'untraded outcome supply must NOT change';
  ASSERT st.virtual_pool_usd = 500, format('pool should be 500, is %s', st.virtual_pool_usd);
  ASSERT st.version = 1, format('version should be 1, is %s', st.version);

  -- Odds moved toward the bought outcome.
  ASSERT (public.play_implied_probs(st.outcome_supplies))[1] > 0.5,
    'bought outcome must gain implied probability';

  bal := (r->>'balance_usd')::numeric;
  ASSERT bal = 9500, format('balance after $500 stake should be 9500, is %s', bal);

  -- Consecutive trade on the SAME outcome gets a worse fill.
  DECLARE
    shares_1 numeric := ((r->'trade')->>'shares')::numeric;
    r2       jsonb;
    shares_2 numeric;
  BEGIN
    r2 := public.play_execute_trade(alice, mkt, 0, 500, 'test-trade-2');
    shares_2 := ((r2->'trade')->>'shares')::numeric;
    ASSERT shares_2 < shares_1,
      format('second $500 on the same outcome must buy fewer shares (%s vs %s)',
             shares_2, shares_1);
  END;

  -- Opposing trade moves the book back.
  DECLARE
    prob_before numeric;
    prob_after  numeric;
  BEGIN
    SELECT (public.play_implied_probs(outcome_supplies))[1] INTO prob_before
      FROM public.play_market_states WHERE market_address = mkt;

    PERFORM public.play_execute_trade(alice, mkt, 1, 1000, 'test-trade-3');

    SELECT (public.play_implied_probs(outcome_supplies))[1] INTO prob_after
      FROM public.play_market_states WHERE market_address = mkt;

    ASSERT prob_after < prob_before,
      format('buying outcome 1 must lower outcome 0 probability (%s -> %s)',
             prob_before, prob_after);
  END;

  -- Pool equals the sum of every stake placed.
  SELECT * INTO st FROM public.play_market_states WHERE market_address = mkt;
  ASSERT st.virtual_pool_usd = 2000,
    format('pool should be 2000 after 500+500+1000, is %s', st.virtual_pool_usd);

  RAISE NOTICE 'PASS 4 — supplies, pool, odds and fills behave correctly';
END $t4$;


-- =====================================================================
-- 5. DUPLICATE SUBMIT (idempotency)
-- =====================================================================
DO $t5$
DECLARE
  mkt   text := 'PLAYTESTMarket2Outcomes1111111111111111111';
  alice text := 'PLAYTESTWalletAlice111111111111111111111';
  bal_before numeric;
  bal_after  numeric;
  n_before   integer;
  n_after    integer;
  r          jsonb;
BEGIN
  SELECT balance_usd INTO bal_before FROM public.play_accounts
    WHERE wallet_address = alice;
  SELECT count(*) INTO n_before FROM public.play_trades;

  -- Replay an already-used client_trade_id.
  r := public.play_execute_trade(alice, mkt, 0, 500, 'test-trade-1');

  SELECT balance_usd INTO bal_after FROM public.play_accounts
    WHERE wallet_address = alice;
  SELECT count(*) INTO n_after FROM public.play_trades;

  ASSERT (r->>'replayed')::boolean = true, 'duplicate submit must report replayed';
  ASSERT bal_after = bal_before,
    format('duplicate submit must not move money (%s -> %s)', bal_before, bal_after);
  ASSERT n_after = n_before, 'duplicate submit must not create a second trade';

  RAISE NOTICE 'PASS 5 — duplicate submit returns the original trade and moves no money';
END $t5$;


-- =====================================================================
-- 6. INSUFFICIENT BALANCE + ALL-IN
-- =====================================================================
DO $t6$
DECLARE
  mkt  text := 'PLAYTESTMarket3Outcomes2222222222222222222';
  bob  text := 'PLAYTESTWalletBob22222222222222222222222';
  acc  public.play_accounts;
  bal  numeric;
  st   public.play_market_states;
  failed boolean := false;
BEGIN
  acc := public.play_ensure_account(bob);
  PERFORM public.play_ensure_daily_grant(acc.id);

  -- Overspend is rejected.
  BEGIN
    PERFORM public.play_execute_trade(bob, mkt, 0, 10000.01, 'bob-overspend');
  EXCEPTION WHEN others THEN
    failed := true;
  END;
  ASSERT failed, 'spending more than the balance must fail';

  SELECT balance_usd INTO bal FROM public.play_accounts WHERE id = acc.id;
  ASSERT bal = 10000, format('failed trade must not move money, balance is %s', bal);
  ASSERT NOT EXISTS (SELECT 1 FROM public.play_trades WHERE client_trade_id = 'bob-overspend'),
    'failed trade must leave no row';

  -- All-in for exactly the balance succeeds.
  PERFORM public.play_execute_trade(bob, mkt, 0, 10000, 'bob-all-in');
  SELECT balance_usd INTO bal FROM public.play_accounts WHERE id = acc.id;
  ASSERT bal = 0, format('all-in must zero the balance, is %s', bal);

  -- A further trade with a zero balance fails.
  failed := false;
  BEGIN
    PERFORM public.play_execute_trade(bob, mkt, 1, 1, 'bob-broke');
  EXCEPTION WHEN others THEN
    failed := true;
  END;
  ASSERT failed, 'trading with a zero balance must fail';

  SELECT * INTO st FROM public.play_market_states WHERE market_address = mkt;
  ASSERT st.virtual_pool_usd = 10000,
    format('pool should hold the all-in, is %s', st.virtual_pool_usd);

  RAISE NOTICE 'PASS 6 — all-in works, overspend is rejected atomically';
END $t6$;


-- =====================================================================
-- 7. MARKET GATE — closed / blocked / expired markets reject trades
-- =====================================================================
DO $t7$
DECLARE
  mkt    text := 'PLAYTESTMarket2Outcomes1111111111111111111';
  carol  text := 'PLAYTESTWalletCarol33333333333333333333';
  failed boolean;
BEGIN
  PERFORM public.play_ensure_account(carol);

  -- Expired deadline
  UPDATE public.markets SET end_date = now() - interval '1 hour'
    WHERE market_address = mkt;
  failed := false;
  BEGIN
    PERFORM public.play_execute_trade(carol, mkt, 0, 100, 'carol-expired');
  EXCEPTION WHEN others THEN failed := true; END;
  ASSERT failed, 'trading past the deadline must fail';
  UPDATE public.markets SET end_date = now() + interval '7 days'
    WHERE market_address = mkt;

  -- Blocked
  UPDATE public.markets SET is_blocked = true WHERE market_address = mkt;
  failed := false;
  BEGIN
    PERFORM public.play_execute_trade(carol, mkt, 0, 100, 'carol-blocked');
  EXCEPTION WHEN others THEN failed := true; END;
  ASSERT failed, 'trading a blocked market must fail';
  UPDATE public.markets SET is_blocked = false WHERE market_address = mkt;

  -- Proposed is NOT tradable and NOT settleable
  UPDATE public.markets SET resolution_status = 'proposed' WHERE market_address = mkt;
  failed := false;
  BEGIN
    PERFORM public.play_execute_trade(carol, mkt, 0, 100, 'carol-proposed');
  EXCEPTION WHEN others THEN failed := true; END;
  ASSERT failed, 'trading a proposed market must fail';

  ASSERT (public.play_settle_market(mkt)->>'settled')::boolean = false,
    'a proposed market must not settle (dispute may still change the outcome)';

  UPDATE public.markets SET resolution_status = 'open' WHERE market_address = mkt;

  -- Bad outcome index
  failed := false;
  BEGIN
    PERFORM public.play_execute_trade(carol, mkt, 5, 100, 'carol-badoutcome');
  EXCEPTION WHEN others THEN failed := true; END;
  ASSERT failed, 'out-of-range outcome index must fail';

  RAISE NOTICE 'PASS 7 — expired / blocked / proposed / bad-index all rejected';
END $t7$;


-- =====================================================================
-- 8. SETTLEMENT — finalized market, multiple winners, repeated calls
-- =====================================================================
DO $t8$
DECLARE
  mkt  text := 'PLAYTESTMarket2Outcomes1111111111111111111';
  dave text := 'PLAYTESTWalletDave44444444444444444444444';
  erin text := 'PLAYTESTWalletErin55555555555555555555555';
  r        jsonb;
  r2       jsonb;
  st       public.play_market_states;
  pool     numeric;
  paid     numeric;
  dust     numeric;
  d_bal_1  numeric; d_bal_2 numeric;
  n_won integer; n_lost integer;
BEGIN
  PERFORM public.play_ensure_account(dave);
  PERFORM public.play_ensure_account(erin);

  -- Two winners on outcome 0, one loser on outcome 1.
  PERFORM public.play_execute_trade(dave, mkt, 0, 1000, 'dave-w1');
  PERFORM public.play_execute_trade(erin, mkt, 0, 2000, 'erin-w1');
  PERFORM public.play_execute_trade(erin, mkt, 1, 1500, 'erin-l1');

  SELECT * INTO st FROM public.play_market_states WHERE market_address = mkt;
  pool := st.virtual_pool_usd;

  SELECT balance_usd INTO d_bal_1 FROM public.play_accounts WHERE wallet_address = dave;

  -- Finalize outcome 0.
  UPDATE public.markets
     SET resolution_status = 'finalized', winning_outcome = 0, resolved = true
   WHERE market_address = mkt;

  r := public.play_settle_market(mkt);

  ASSERT (r->>'settled')::boolean = true, 'settlement must run';
  ASSERT (r->>'winning_outcome')::integer = 0, 'winning outcome must be 0';

  paid := (r->>'paid_out_usd')::numeric;
  dust := (r->>'dust_usd')::numeric;

  -- NEVER mint virtual value.
  ASSERT paid <= pool, format('paid %s must not exceed pool %s', paid, pool);
  ASSERT dust >= 0, format('dust must be non-negative, is %s', dust);
  ASSERT dust < 1, format('dust should be sub-dollar rounding only, is %s', dust);

  -- No trade left open.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.play_trades WHERE market_address = mkt AND status = 'open'
  ), 'no trade may remain open after settlement';

  SELECT count(*) FILTER (WHERE status = 'won'),
         count(*) FILTER (WHERE status = 'lost')
    INTO n_won, n_lost
    FROM public.play_trades WHERE market_address = mkt;
  ASSERT n_won >= 2, format('expected at least 2 winners, got %s', n_won);
  ASSERT n_lost >= 1, format('expected at least 1 loser, got %s', n_lost);

  -- Losers get exactly zero and a P&L of -stake.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.play_trades
     WHERE market_address = mkt AND status = 'lost'
       AND (payout_usd <> 0 OR realized_pnl_usd <> -stake_usd)
  ), 'losing trades must pay 0 and realize -stake';

  -- Winners realize payout - stake.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.play_trades
     WHERE market_address = mkt AND status = 'won'
       AND realized_pnl_usd <> payout_usd - stake_usd
  ), 'winning P&L must equal payout - stake';

  -- Erin staked 2x Dave on the same outcome at a worse price, so she must
  -- receive more than Dave but less than double.
  DECLARE
    dave_payout numeric;
    erin_payout numeric;
  BEGIN
    SELECT payout_usd INTO dave_payout FROM public.play_trades WHERE client_trade_id = 'dave-w1';
    SELECT payout_usd INTO erin_payout FROM public.play_trades WHERE client_trade_id = 'erin-w1';
    ASSERT erin_payout > dave_payout,
      format('bigger winning stake must pay more (%s vs %s)', erin_payout, dave_payout);
    ASSERT erin_payout < dave_payout * 2,
      format('later buyer paid a worse price so must earn less than 2x (%s vs %s)',
             erin_payout, dave_payout);
  END;

  SELECT balance_usd INTO d_bal_2 FROM public.play_accounts WHERE wallet_address = dave;
  ASSERT d_bal_2 > d_bal_1, 'winner balance must increase';

  -- ---- DOUBLE SETTLEMENT ----
  r2 := public.play_settle_market(mkt);
  ASSERT (r2->>'trades_settled')::integer = 0,
    format('second settlement must settle 0 trades, settled %s',
           (r2->>'trades_settled')::integer);
  ASSERT (r2->>'paid_out_usd')::numeric = 0,
    'second settlement must pay out exactly zero';

  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE wallet_address = dave) = d_bal_2,
    'second settlement must not change any balance';

  -- Third call for good measure.
  PERFORM public.play_settle_market(mkt);
  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE wallet_address = dave) = d_bal_2,
    'third settlement must still not change any balance';

  RAISE NOTICE 'PASS 8 — settlement pays pro-rata, never mints value, and is idempotent';
END $t8$;


-- =====================================================================
-- 8B. NO WINNING POSITIONS — finalized, but nobody backed the winner
-- =====================================================================
-- Locked rule: refund the whole market rather than strand the pool.
DO $t8b$
DECLARE
  mkt   text := 'PLAYTESTMarketNoWinner3333333333333333333';
  hank  text := 'PLAYTESTWalletHank999999999999999999999';
  ivy   text := 'PLAYTESTWalletIvy1010101010101010101010';
  h_acc public.play_accounts;
  i_acc public.play_accounts;
  r     jsonb;
  r2    jsonb;
  r3    jsonb;
  st    public.play_market_states;
  h_before numeric; i_before numeric;
  h_after  numeric; i_after  numeric;
  pool_before numeric;
  seed_supply numeric;
BEGIN
  h_acc := public.play_ensure_account(hank);
  i_acc := public.play_ensure_account(ivy);

  -- BOTH users back outcome 1. Nobody touches outcome 0.
  PERFORM public.play_execute_trade(hank, mkt, 1, 1200, 'hank-nowin');
  PERFORM public.play_execute_trade(ivy,  mkt, 1,  800, 'ivy-nowin');

  SELECT * INTO st FROM public.play_market_states WHERE market_address = mkt;
  pool_before := st.virtual_pool_usd;
  seed_supply := st.outcome_supplies[1];   -- outcome 0 seed, user-owned = 0

  ASSERT pool_before = 2000,
    format('pool should be 2000 after 1200+800, is %s', pool_before);
  ASSERT seed_supply > 0,
    'outcome 0 must still carry its seed supply (pricing device)';

  SELECT balance_usd INTO h_before FROM public.play_accounts WHERE id = h_acc.id;
  SELECT balance_usd INTO i_before FROM public.play_accounts WHERE id = i_acc.id;

  -- Finalize on outcome 0 — the outcome NO user holds.
  UPDATE public.markets
     SET resolution_status = 'finalized', winning_outcome = 0, resolved = true
   WHERE market_address = mkt;

  r := public.play_settle_market(mkt);

  -- (1) the rule fired
  ASSERT (r->>'settled')::boolean = true, 'settlement must run';
  ASSERT (r->>'reason') = 'no_winning_positions',
    format('reason should be no_winning_positions, is %s', r->>'reason');
  ASSERT (r->>'no_winning_positions')::boolean = true, 'flag must be set';
  ASSERT (r->>'refunded_all')::boolean = true, 'whole market must refund';
  ASSERT (r->>'total_winning_shares')::numeric = 0,
    'seed supply must NOT count as user-owned winning shares';
  ASSERT (r->>'winning_outcome')::integer = 0, 'winning outcome must be preserved';

  -- (2) every stake refunded exactly, (3) realized P&L is zero
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.play_trades
     WHERE market_address = mkt
       AND (status <> 'refunded'
            OR payout_usd <> stake_usd
            OR realized_pnl_usd <> 0)
  ), 'every trade must be refunded at exactly its stake with zero P&L';

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.play_trades WHERE market_address = mkt AND status = 'open'
  ), 'no trade may remain open';

  SELECT balance_usd INTO h_after FROM public.play_accounts WHERE id = h_acc.id;
  SELECT balance_usd INTO i_after FROM public.play_accounts WHERE id = i_acc.id;
  ASSERT h_after = h_before + 1200,
    format('hank must get exactly 1200 back (%s -> %s)', h_before, h_after);
  ASSERT i_after = i_before + 800,
    format('ivy must get exactly 800 back (%s -> %s)', i_before, i_after);

  -- Pool fully drained — nothing orphaned.
  SELECT * INTO st FROM public.play_market_states WHERE market_address = mkt;
  ASSERT (r->>'paid_out_usd')::numeric = pool_before,
    format('refunds (%s) must equal the pool (%s)',
           r->>'paid_out_usd', pool_before);
  ASSERT st.virtual_pool_usd = 0,
    format('pool must drain to zero, is %s', st.virtual_pool_usd);

  -- Finalized, not cancelled — the Real market DID resolve.
  ASSERT st.status = 'finalized',
    format('state must be finalized, is %s', st.status);
  ASSERT st.settlement_meta->>'reason' = 'no_winning_positions',
    format('settlement_meta must explain the reason, is %s', st.settlement_meta::text);

  -- Ledger rows are refunds, not payouts.
  ASSERT (SELECT count(*) FROM public.play_ledger l
           JOIN public.play_trades t ON t.id = l.trade_id
          WHERE t.market_address = mkt AND l.kind = 'trade_refund') = 2,
    'expected exactly two trade_refund ledger rows';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.play_ledger l
      JOIN public.play_trades t ON t.id = l.trade_id
     WHERE t.market_address = mkt AND l.kind = 'trade_payout'
  ), 'no trade_payout rows may exist for a no-winner settlement';

  -- (5) second and third calls credit nothing
  r2 := public.play_settle_market(mkt);
  ASSERT (r2->>'trades_settled')::integer = 0, 'second call must settle 0 trades';
  ASSERT (r2->>'paid_out_usd')::numeric = 0, 'second call must pay 0';
  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE id = h_acc.id) = h_after
     AND (SELECT balance_usd FROM public.play_accounts WHERE id = i_acc.id) = i_after,
    'second settlement must not change any balance';

  r3 := public.play_settle_market(mkt);
  ASSERT (r3->>'paid_out_usd')::numeric = 0, 'third call must pay 0';
  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE id = h_acc.id) = h_after
     AND (SELECT balance_usd FROM public.play_accounts WHERE id = i_acc.id) = i_after,
    'third settlement must not change any balance';

  -- The original settlement audit trail survives the repeat calls.
  SELECT * INTO st FROM public.play_market_states WHERE market_address = mkt;
  ASSERT (st.settlement_meta->>'trades_settled')::integer = 2,
    'settlement_meta must still describe the run that moved the money';
  ASSERT (st.settlement_meta->>'paid_out_usd')::numeric = 2000,
    'settlement_meta must retain the original paid_out total';

  -- (4) ledger reconciliation for both accounts
  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE id = h_acc.id)
       = (SELECT coalesce(sum(amount_usd), 0) FROM public.play_ledger
           WHERE account_id = h_acc.id),
    'hank balance must reconcile against the ledger';
  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE id = i_acc.id)
       = (SELECT coalesce(sum(amount_usd), 0) FROM public.play_ledger
           WHERE account_id = i_acc.id),
    'ivy balance must reconcile against the ledger';

  RAISE NOTICE 'PASS 8B — no-winner markets refund in full, drain the pool, stay idempotent';
END $t8b$;


-- =====================================================================
-- 9. CANCELLED MARKET — full refund, zero P&L
-- =====================================================================
DO $t9$
DECLARE
  mkt   text := 'PLAYTESTMarket3Outcomes2222222222222222222';
  frank text := 'PLAYTESTWalletFrank6666666666666666666666';
  acc   public.play_accounts;
  r     jsonb;
  bal_before numeric;
  bal_after  numeric;
BEGIN
  acc := public.play_ensure_account(frank);
  PERFORM public.play_ensure_daily_grant(acc.id);

  PERFORM public.play_execute_trade(frank, mkt, 1, 750, 'frank-c1');
  PERFORM public.play_execute_trade(frank, mkt, 2, 250, 'frank-c2');

  SELECT balance_usd INTO bal_before FROM public.play_accounts WHERE id = acc.id;
  ASSERT bal_before = 9000, format('expected 9000 after 1000 staked, got %s', bal_before);

  UPDATE public.markets SET resolution_status = 'cancelled' WHERE market_address = mkt;

  r := public.play_settle_market(mkt);
  ASSERT (r->>'settled')::boolean = true, 'cancelled market must settle';

  SELECT balance_usd INTO bal_after FROM public.play_accounts WHERE id = acc.id;
  ASSERT bal_after = bal_before + 1000,
    format('refund must return the full stake (%s -> %s)', bal_before, bal_after);

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.play_trades
     WHERE market_address = mkt
       AND (status <> 'refunded' OR realized_pnl_usd <> 0 OR payout_usd <> stake_usd)
  ), 'every trade on a cancelled market must refund the stake at zero P&L';

  -- Repeat: refunds must not double-credit.
  PERFORM public.play_settle_market(mkt);
  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE id = acc.id) = bal_after,
    'repeated cancellation settlement must not double-refund';

  RAISE NOTICE 'PASS 9 — cancellation refunds exactly once at zero P&L';
END $t9$;


-- =====================================================================
-- 10. LEDGER RECONCILIATION — balance must equal SUM(ledger)
-- =====================================================================
DO $t10$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad
    FROM public.play_accounts a
    LEFT JOIN (
      SELECT account_id, sum(amount_usd) AS total
        FROM public.play_ledger GROUP BY account_id
    ) l ON l.account_id = a.id
   WHERE a.balance_usd <> coalesce(l.total, 0);

  ASSERT bad = 0,
    format('%s account(s) whose balance does not equal SUM(ledger)', bad);

  -- Ledger arithmetic is enforced by a CHECK, but verify the chain too.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.play_ledger WHERE balance_after <> balance_before + amount_usd
  ), 'ledger arithmetic broken';

  RAISE NOTICE 'PASS 10 — every balance reconciles against the ledger';
END $t10$;


-- =====================================================================
-- 11. WEEKLY ROLLOVER WITH OPEN POSITIONS
-- =====================================================================
DO $t11$
DECLARE
  mkt   text := 'PLAYTESTMarket2Outcomes1111111111111111111';
  gina  text := 'PLAYTESTWalletGina77777777777777777777777';
  acc   public.play_accounts;
  old_season integer;
  new_season integer;
  r     jsonb;
  open_trade public.play_trades;
BEGIN
  -- Reopen the 2-outcome market for a fresh position, and give it a
  -- fresh Play state (the previous one is finalized).
  UPDATE public.markets
     SET resolution_status = 'open', winning_outcome = NULL, resolved = false
   WHERE market_address = mkt;
  UPDATE public.play_market_states
     SET status = 'open', settled_at = NULL, settlement_meta = '{}'::jsonb
   WHERE market_address = mkt;

  acc := public.play_ensure_account(gina);
  PERFORM public.play_ensure_daily_grant(acc.id);
  PERFORM public.play_execute_trade(gina, mkt, 0, 3000, 'gina-open');

  SELECT * INTO open_trade FROM public.play_trades WHERE client_trade_id = 'gina-open';
  old_season := open_trade.season_id;
  ASSERT open_trade.status = 'open', 'position must be open before rollover';

  -- Force the current season to look expired, then roll over.
  UPDATE public.play_seasons SET ends_at = now() - interval '1 second'
   WHERE id = old_season;

  r := public.play_rollover_season();
  ASSERT (r->>'rolled')::boolean = true, format('rollover must run: %s', r::text);

  new_season := (r->>'new_season_id')::integer;
  ASSERT new_season <> old_season, 'rollover must open a NEW season';
  ASSERT (SELECT status FROM public.play_seasons WHERE id = old_season) = 'closed',
    'old season must be closed';

  -- Bankroll reset.
  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE id = acc.id) = 0,
    'rollover must zero the competition bankroll';

  -- Open position survives, keeps its ORIGINAL season.
  SELECT * INTO open_trade FROM public.play_trades WHERE client_trade_id = 'gina-open';
  ASSERT open_trade.status = 'open', 'open position must survive the season boundary';
  ASSERT open_trade.season_id = old_season,
    'open position must keep its original season for P&L attribution';

  -- Market state (odds) NOT reset — a live market must not jump.
  ASSERT (SELECT virtual_pool_usd FROM public.play_market_states WHERE market_address = mkt) > 0,
    'rollover must not reset live market odds or pool';

  -- Settle after the boundary: P&L stays in the old season, payout lands
  -- in the CURRENT balance.
  UPDATE public.markets
     SET resolution_status = 'finalized', winning_outcome = 0, resolved = true
   WHERE market_address = mkt;
  PERFORM public.play_settle_market(mkt);

  SELECT * INTO open_trade FROM public.play_trades WHERE client_trade_id = 'gina-open';
  ASSERT open_trade.status = 'won', 'position must settle after the boundary';
  ASSERT open_trade.season_id = old_season,
    'settled P&L must remain attributed to the season the trade was placed in';
  ASSERT (SELECT balance_usd FROM public.play_accounts WHERE id = acc.id) > 0,
    'payout must land in the current (post-reset) balance';
  ASSERT (SELECT season_id FROM public.play_ledger
           WHERE trade_id = open_trade.id AND kind = 'trade_payout') = new_season,
    'the payout ledger row belongs to the season in which the money moved';

  RAISE NOTICE 'PASS 11 — rollover resets bankroll, preserves odds and open positions';
END $t11$;


-- =====================================================================
-- 12. REAL-MODE ISOLATION — Play never wrote a Real economic field
-- =====================================================================
DO $t12$
DECLARE
  n_tx integer;
BEGIN
  -- The engine must never have inserted into the Real transactions table.
  SELECT count(*) INTO n_tx FROM public.transactions
   WHERE market_address IN (
     'PLAYTESTMarket2Outcomes1111111111111111111',
     'PLAYTESTMarket3Outcomes2222222222222222222',
     'PLAYTESTMarketNoWinner3333333333333333333'
   );
  ASSERT n_tx = 0,
    format('Play wrote %s row(s) into the Real transactions table', n_tx);

  -- Real supply/volume fields on the synthetic markets are untouched.
  -- (The only markets writes in this script are the test harness's own
  -- resolution_status flips above, never a Play function.)
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.markets
     WHERE market_address IN (
       'PLAYTESTMarket2Outcomes1111111111111111111',
       'PLAYTESTMarket3Outcomes2222222222222222222',
       'PLAYTESTMarketNoWinner3333333333333333333'
     )
     AND (coalesce(total_volume, 0) <> 0
          OR coalesce(yes_supply, 0) <> 0
          OR coalesce(no_supply, 0)  <> 0)
  ), 'Play must never touch Real supplies or volume';

  RAISE NOTICE 'PASS 12 — no Play write reached any Real economic field';
END $t12$;


-- =====================================================================
-- SUMMARY
-- =====================================================================
DO $summary$
DECLARE
  n_acc integer; n_trade integer; n_ledger integer; n_state integer;
BEGIN
  SELECT count(*) INTO n_acc    FROM public.play_accounts;
  SELECT count(*) INTO n_trade  FROM public.play_trades;
  SELECT count(*) INTO n_ledger FROM public.play_ledger;
  SELECT count(*) INTO n_state  FROM public.play_market_states;

  RAISE NOTICE '=====================================================';
  RAISE NOTICE 'ALL PLAY ENGINE TESTS PASSED';
  RAISE NOTICE '  accounts=% trades=% ledger=% market_states=%',
    n_acc, n_trade, n_ledger, n_state;
  RAISE NOTICE 'Rolling back — the database is left untouched.';
  RAISE NOTICE '=====================================================';
END $summary$;

ROLLBACK;


-- =====================================================================
-- MANUAL: concurrency check (cannot be expressed in one session)
-- =====================================================================
-- Two psql sessions against a dev database:
--
--   Session A                              Session B
--   ---------                              ---------
--   BEGIN;
--   SELECT play_execute_trade(
--     'W...', 'MKT...', 0, 10000, 'a1');
--                                          BEGIN;
--                                          SELECT play_execute_trade(
--                                            'W...','MKT...',0,10000,'b1');
--                                          -- blocks on the market-state
--                                          -- row lock held by A
--   COMMIT;
--                                          -- unblocks, then FAILS with
--                                          -- "insufficient balance"
--                                          ROLLBACK;
--
-- Expected: exactly one $10,000 all-in succeeds. The conditional
-- `UPDATE ... WHERE balance_usd >= stake` matches zero rows for the
-- loser, so it can never overspend regardless of interleaving.
-- =====================================================================
