-- =====================================================================
-- Admin Play Contest — terminal `closed` status (lifecycle fix)
-- =====================================================================
-- Follow-up to 20260727_play_contests.sql.
--
-- THE DEAD END THIS CLOSES
-- ------------------------
-- A contest that ran normally but produced ZERO eligible settled players
-- had no terminal state it could legitimately reach:
--
--   * freeze correctly refuses — there is no ranking to snapshot;
--   * `paid` is a lie: nothing was won and nothing was paid;
--   * `cancelled` is a lie too: the period ran exactly as intended, it
--     just had no decided results;
--
-- so the row stayed `ended` forever, kept being returned as the current
-- manageable contest, and the operator could never start the next one.
--
-- `closed` is the missing state: the period ended, no ranking will
-- change, no admin action remains, no prize is pending, and the row is
-- history rather than a live obligation.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- Alters no existing row, deletes no contest, touches no frozen result,
-- and changes no overlap semantics (see the note at the bottom).
--
-- Additive and idempotent: safe to re-run, and safe to run whether or not
-- 20260727 has already been applied to this database.
--
-- NOT APPLIED. Run it yourself, against DEV only, AFTER 20260727:
--   psql "$DATABASE_URL" -f supabase/migrations/20260728_play_contests_closed_status.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- Widen the status enum with the new terminal value.
-- ---------------------------------------------------------------------
-- DROP-then-ADD is the only way to widen a CHECK, and it is safe here:
-- the new set is a strict SUPERSET of the old one, so no existing row can
-- fail revalidation and no row is rewritten.
--
-- Guarded on to_regclass so the file is a clean no-op on a database where
-- 20260727 has not been applied yet.

do $$
begin
  if to_regclass('public.play_contests') is null then
    raise notice 'play_contests does not exist; apply 20260727_play_contests.sql first';
    return;
  end if;

  alter table public.play_contests
    drop constraint if exists play_contests_status_check;

  alter table public.play_contests
    add constraint play_contests_status_check check (
      status in (
        'draft',
        'live',
        'ended',
        'under_review',
        'verified',
        'paid',
        -- Ran normally, produced no payable ranking, needs nothing further.
        'closed',
        'cancelled'
      )
    );
end $$;


-- ---------------------------------------------------------------------
-- OVERLAP CONSTRAINT — deliberately left alone
-- ---------------------------------------------------------------------
-- play_contests_no_overlap excludes only `cancelled`, and that stays
-- correct. A cancelled contest never counted, so its window is free to be
-- claimed again. A `closed` contest DID run: real Play results were
-- settled inside its window and it is the historical record of them.
-- Letting a second contest claim the same instants would let two contests
-- claim the same settled results, which is exactly the integrity this
-- constraint exists to protect.
--
-- The dead end was never an overlap problem. A NEW contest is scheduled
-- for a LATER window, which never overlapped anything; the operator was
-- blocked because the old contest was still being returned as current,
-- so the create form never appeared. That is fixed in the current-contest
-- query, not by weakening this constraint.
-- ---------------------------------------------------------------------
