-- =====================================================================
-- Admin Play Contest (Phase 10) — schema constraint test suite
-- =====================================================================
-- Repeatable, self-contained, NON-DESTRUCTIVE.
--
-- The whole script runs inside a single transaction and ends with
-- ROLLBACK, so it leaves the database exactly as it found it.
--
-- Run against a DEVELOPMENT database only, AFTER applying
-- supabase/migrations/20260727_play_contests.sql:
--   psql "$DEV_DATABASE_URL" -f supabase/tests/20260727_play_contests_test.sql
--
-- SCOPE: the storage-layer guarantees only — the rules that must hold
-- even if the application is bypassed. The ranking semantics, freeze
-- idempotency, verify and payment tracking live in src/lib/playContests.ts
-- and are exercised through /api/admin/play-contests/*.
--
-- Every check uses plpgsql ASSERT. The script aborts on the first
-- failure with the offending values in the message.
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $suite$
DECLARE
  c_id   uuid;
  c2_id  uuid;
  r_id   uuid;
  failed boolean;
  -- Obviously-fake base58-shaped wallets.
  w1 text := 'TestContestWalletAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  w2 text := 'TestContestWalletBBBBBBBBBBBBBBBBBBBBBBBBBBB';
BEGIN

  -- -------------------------------------------------------------------
  -- 1. A valid contest is accepted
  -- -------------------------------------------------------------------
  insert into public.play_contests
    (name, starts_at, ends_at, prize_pool_usd,
     first_prize_usd, second_prize_usd, third_prize_usd, created_by)
  values
    ('TEST Weekly Play Contest',
     timestamptz '2999-01-04 00:00:00+00',
     timestamptz '2999-01-11 00:00:00+00',
     50.00, 25.00, 15.00, 10.00, w1)
  returning id into c_id;

  assert c_id is not null, 'valid contest was not created';

  -- -------------------------------------------------------------------
  -- 2. end must be after start
  -- -------------------------------------------------------------------
  failed := false;
  BEGIN
    insert into public.play_contests
      (name, starts_at, ends_at, prize_pool_usd,
       first_prize_usd, second_prize_usd, third_prize_usd)
    values ('TEST bad dates',
            timestamptz '2999-02-11 00:00:00+00',
            timestamptz '2999-02-04 00:00:00+00',
            50.00, 25.00, 15.00, 10.00);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  assert failed, 'ends_at <= starts_at was accepted';

  -- -------------------------------------------------------------------
  -- 3. prizes must sum to the pool
  -- -------------------------------------------------------------------
  failed := false;
  BEGIN
    insert into public.play_contests
      (name, starts_at, ends_at, prize_pool_usd,
       first_prize_usd, second_prize_usd, third_prize_usd)
    values ('TEST prize mismatch',
            timestamptz '2999-03-04 00:00:00+00',
            timestamptz '2999-03-11 00:00:00+00',
            50.00, 25.00, 15.00, 5.00);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  assert failed, 'a prize split that does not sum to the pool was accepted';

  -- -------------------------------------------------------------------
  -- 4. negative prize amounts are rejected
  -- -------------------------------------------------------------------
  failed := false;
  BEGIN
    insert into public.play_contests
      (name, starts_at, ends_at, prize_pool_usd,
       first_prize_usd, second_prize_usd, third_prize_usd)
    values ('TEST negative prize',
            timestamptz '2999-04-04 00:00:00+00',
            timestamptz '2999-04-11 00:00:00+00',
            50.00, 60.00, -5.00, -5.00);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  assert failed, 'a negative prize amount was accepted';

  -- -------------------------------------------------------------------
  -- 5. an overlapping ACTIVE contest is rejected
  --    (skipped with a notice when btree_gist was unavailable and the
  --     exclusion constraint could not be created — the API still checks)
  -- -------------------------------------------------------------------
  IF exists (select 1 from pg_constraint where conname = 'play_contests_no_overlap') THEN
    failed := false;
    BEGIN
      insert into public.play_contests
        (name, starts_at, ends_at, prize_pool_usd,
         first_prize_usd, second_prize_usd, third_prize_usd)
      values ('TEST overlapping',
              timestamptz '2999-01-07 00:00:00+00',
              timestamptz '2999-01-14 00:00:00+00',
              50.00, 25.00, 15.00, 10.00);
    EXCEPTION WHEN exclusion_violation THEN failed := true;
    END;
    assert failed, 'an overlapping active contest was accepted';

    -- ...but a CANCELLED contest must not block its replacement.
    insert into public.play_contests
      (name, starts_at, ends_at, status, prize_pool_usd,
       first_prize_usd, second_prize_usd, third_prize_usd)
    values ('TEST cancelled predecessor',
            timestamptz '2999-06-04 00:00:00+00',
            timestamptz '2999-06-11 00:00:00+00',
            'cancelled', 50.00, 25.00, 15.00, 10.00);

    insert into public.play_contests
      (name, starts_at, ends_at, prize_pool_usd,
       first_prize_usd, second_prize_usd, third_prize_usd)
    values ('TEST replacement',
            timestamptz '2999-06-04 00:00:00+00',
            timestamptz '2999-06-11 00:00:00+00',
            50.00, 25.00, 15.00, 10.00)
    returning id into c2_id;

    assert c2_id is not null, 'a cancelled contest blocked its replacement';
  ELSE
    raise notice 'SKIP overlap checks: play_contests_no_overlap does not exist';
  END IF;

  -- -------------------------------------------------------------------
  -- 5b. `closed` is an accepted terminal status
  --     (requires 20260728_play_contests_closed_status.sql)
  -- -------------------------------------------------------------------
  update public.play_contests set status = 'closed' where id = c_id;
  assert (select status from public.play_contests where id = c_id) = 'closed',
    'the closed status was rejected — apply 20260728_play_contests_closed_status.sql';

  -- ...and an unknown status is still rejected.
  failed := false;
  BEGIN
    update public.play_contests set status = 'archived' where id = c_id;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  assert failed, 'an unknown contest status was accepted';

  update public.play_contests set status = 'ended' where id = c_id;

  -- -------------------------------------------------------------------
  -- 6. verified_at cannot exist without frozen_at
  -- -------------------------------------------------------------------
  failed := false;
  BEGIN
    update public.play_contests set verified_at = now() where id = c_id;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  assert failed, 'a contest was verified without being frozen';

  update public.play_contests
     set frozen_at = now(), status = 'under_review'
   where id = c_id;

  -- -------------------------------------------------------------------
  -- 7. a valid frozen result row is accepted
  -- -------------------------------------------------------------------
  insert into public.play_contest_results
    (contest_id, rank, wallet_address, realized_pnl_usd, settled_picks,
     wins, losses, win_rate, total_settled_stake_usd, prize_amount_usd)
  values
    (c_id, 1, w1, 1234.56, 10, 7, 3, 0.7000, 5000.00, 25.00)
  returning id into r_id;

  assert r_id is not null, 'a valid frozen result was not created';

  -- -------------------------------------------------------------------
  -- 8. a duplicate RANK in the same contest is rejected
  --    (this is what makes a repeated freeze provably idempotent)
  -- -------------------------------------------------------------------
  failed := false;
  BEGIN
    insert into public.play_contest_results
      (contest_id, rank, wallet_address, realized_pnl_usd, settled_picks,
       wins, losses, win_rate, total_settled_stake_usd)
    values (c_id, 1, w2, 900.00, 5, 4, 1, 0.8000, 2000.00);
  EXCEPTION WHEN unique_violation THEN failed := true;
  END;
  assert failed, 'a duplicate rank was accepted for the same contest';

  -- -------------------------------------------------------------------
  -- 9. a duplicate WALLET in the same contest is rejected
  -- -------------------------------------------------------------------
  failed := false;
  BEGIN
    insert into public.play_contest_results
      (contest_id, rank, wallet_address, realized_pnl_usd, settled_picks,
       wins, losses, win_rate, total_settled_stake_usd)
    values (c_id, 2, w1, 900.00, 5, 4, 1, 0.8000, 2000.00);
  EXCEPTION WHEN unique_violation THEN failed := true;
  END;
  assert failed, 'the same wallet was accepted twice in one contest';

  -- -------------------------------------------------------------------
  -- 10. wins + losses may never exceed settled picks
  --     (a refunded position is a pick but neither a win nor a loss)
  -- -------------------------------------------------------------------
  failed := false;
  BEGIN
    insert into public.play_contest_results
      (contest_id, rank, wallet_address, realized_pnl_usd, settled_picks,
       wins, losses, win_rate, total_settled_stake_usd)
    values (c_id, 3, w2, 100.00, 2, 2, 1, 0.6667, 500.00);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  assert failed, 'wins + losses exceeding settled_picks was accepted';

  -- -------------------------------------------------------------------
  -- 11. win_rate must be a ratio in [0, 1]
  -- -------------------------------------------------------------------
  failed := false;
  BEGIN
    insert into public.play_contest_results
      (contest_id, rank, wallet_address, realized_pnl_usd, settled_picks,
       wins, losses, win_rate, total_settled_stake_usd)
    values (c_id, 4, w2, 100.00, 2, 1, 1, 70.0000, 500.00);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  assert failed, 'a win_rate outside [0,1] was accepted';

  -- -------------------------------------------------------------------
  -- 12. an invalid prize status is rejected
  -- -------------------------------------------------------------------
  failed := false;
  BEGIN
    update public.play_contest_results
       set prize_status = 'withdrawn'
     where id = r_id;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  assert failed, 'an unknown prize status was accepted';

  -- -------------------------------------------------------------------
  -- 13. 'paid' must carry its timestamp — the record is never implicit
  -- -------------------------------------------------------------------
  failed := false;
  BEGIN
    update public.play_contest_results
       set prize_status = 'paid'
     where id = r_id;
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  assert failed, 'paid was accepted without paid_at';

  update public.play_contest_results
     set prize_status = 'paid',
         paid_at = now(),
         payment_reference = 'TEST-REF-0001',
         admin_note = 'TEST note'
   where id = r_id;

  assert (select prize_status from public.play_contest_results where id = r_id) = 'paid',
    'the payment record did not save';

  -- -------------------------------------------------------------------
  -- 14. deleting a contest removes its frozen rows (no orphans)
  -- -------------------------------------------------------------------
  delete from public.play_contests where id = c_id;
  assert not exists (select 1 from public.play_contest_results where contest_id = c_id),
    'frozen results outlived their contest';

  raise notice 'ALL PLAY CONTEST SCHEMA CHECKS PASSED';
END
$suite$;

ROLLBACK;
