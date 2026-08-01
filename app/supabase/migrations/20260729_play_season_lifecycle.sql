-- =====================================================================
-- Play Mode — season lifecycle fix (follow-up migration)
-- =====================================================================
-- Fixes the deadlock that blocks ALL Play trading and ALL Play settlement
-- once the single open season expires, and removes settlement's dependency
-- on a season covering now().
--
-- THE BUG
-- -------
-- play_seasons carries a partial unique index, play_seasons_single_open_idx
-- on ((status)) where status = 'open', so AT MOST ONE row may be 'open' at
-- any time. play_current_season() self-heals only by INSERTING. Once the
-- one open season's ends_at slips into the past while its status is still
-- 'open', that self-heal can never fire:
--
--   1. no open season COVERS now()          -> nothing selected
--   2. insert the current week              -> blocked by the single-open
--                                              unique index, swallowed by
--                                              `on conflict do nothing`
--   3. re-select by coverage                -> still nothing
--   4. raise 'no open season covers now(); run play_rollover_season()'
--
-- Only play_rollover_season() could close the stale row, and nothing calls
-- it automatically — so an operator had to run SQL by hand to unblock the
-- product. Every caller of play_current_season() broke at once:
-- play_execute_trade (buy), play_ensure_market_state (first quote on a new
-- market), play_ensure_daily_grant (bankroll) and play_settle_market
-- (admin resolution), which is why a Real finalization reported
-- "Real finalized, but PLAY SETTLEMENT NEEDS ATTENTION".
--
-- WHAT THIS MIGRATION CHANGES
-- ---------------------------
-- 1. play_rollover_season(boolean) — NEW overload carrying the existing
--    rollover body, with the bankroll reset made conditional and an
--    advisory lock added so concurrent rollovers serialize.
-- 2. play_rollover_season() — now a wrapper for play_rollover_season(true).
--    Byte-identical behaviour for the admin route and for manual SQL:
--    close the expired season, open the next, zero every bankroll.
-- 3. play_current_season() — self-heals through the EXISTING rollover
--    mechanism instead of duplicating season creation: when a stale open
--    season is what blocks it, it calls play_rollover_season(FALSE) and
--    re-reads. FALSE because this path runs inside a user's buy: it is an
--    accounting-period roll, not the weekly competition reset, and it must
--    never zero a bankroll out from under a trade in flight. The weekly
--    bankroll reset stays exactly where it was — the admin rollover.
-- 4. play_settle_market(text) — stamps the payout/refund ledger row with
--    the TRADE's season_id instead of the current season, so settling a
--    historical position no longer needs any season to cover now().
--
-- Additive. No table is altered, no Real object is touched, no balance is
-- reset, no trade is moved between seasons. `create or replace` throughout,
-- so re-running is safe.
-- =====================================================================


-- =====================================================================
-- 1. ROLLOVER — implementation, with an explicit bankroll-reset switch
-- =====================================================================
-- Boundary: Monday 00:00:00 UTC.
--
-- reset_bankrolls_in = true  -> the weekly competition rollover: close the
--   expired season, open the next, zero every play_accounts.balance_usd
--   with one 'season_reset' ledger row each. This is what the admin route
--   and any manual `select play_rollover_season()` still do.
--
-- reset_bankrolls_in = false -> season bookkeeping ONLY: close the expired
--   season and open the next. No balance is read, locked or written; no
--   ledger row is inserted. This is the automatic recovery path used by
--   play_current_season(), where zeroing bankrolls as a side effect of
--   someone's first buy of the week would be indefensible.
--
-- What never resets, in either mode: play_market_states (live odds must not
-- jump), play_trades, play_ledger. Open trades keep their original
-- season_id and stay fully settleable — their P&L remains attributed to the
-- season they were PLACED in, while any payout lands in the account's
-- then-current balance.
create or replace function public.play_rollover_season(reset_bankrolls_in boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  cur        public.play_seasons;
  nxt        public.play_seasons;
  a          record;
  w_start    timestamptz;
  reset_count integer := 0;
  reset_total numeric(18,2) := 0;
begin
  -- Serialize rollovers. Two concurrent first-buys-of-the-week would
  -- otherwise both read the same expired season, both close it and both
  -- try to open the next one; the unique index would reject the loser's
  -- insert, but only after it had already written a redundant close. The
  -- lock is transaction-scoped and re-entrant within a transaction, so
  -- play_current_season() -> play_rollover_season() -> play_current_season()
  -- cannot self-deadlock.
  perform pg_advisory_xact_lock(hashtext('play_season_rollover'));

  select * into cur
    from public.play_seasons
   where status = 'open'
   order by starts_at desc
   limit 1;

  if cur.id is null then
    nxt := public.play_current_season();
    return jsonb_build_object(
      'rolled', false, 'reason', 'no open season; created current',
      'season_id', nxt.id,
      'reset_bankrolls', reset_bankrolls_in
    );
  end if;

  if cur.ends_at > now() then
    return jsonb_build_object(
      'rolled', false,
      'reason', 'current season has not ended yet',
      'season_id', cur.id,
      'ends_at', cur.ends_at,
      'reset_bankrolls', reset_bankrolls_in
    );
  end if;

  -- Close the expired season.
  update public.play_seasons
     set status = 'closed', closed_at = now()
   where id = cur.id;

  -- Open the next window. It must start exactly where the closed season
  -- ended, otherwise the two ranges overlap and the exclusion constraint
  -- silently rejects the insert. GREATEST also keeps an early/forced
  -- rollover from creating a season that starts in the past.
  --
  -- The END is always snapped back to the Monday 00:00 UTC grid, so an
  -- off-cycle rollover produces one short season and then re-aligns
  -- rather than drifting the boundary forever. Whichever branch GREATEST
  -- takes, the resulting window always covers now(): cur.ends_at is in the
  -- past, so the end lands at week_start(now()) + 7 days at the earliest.
  w_start := greatest(cur.ends_at, public.play_week_start(now()));

  insert into public.play_seasons (starts_at, ends_at, status)
  values (
    w_start,
    public.play_week_start(w_start) + interval '7 days',
    'open'
  )
  on conflict do nothing
  returning * into nxt;

  if nxt.id is null then
    select * into nxt
      from public.play_seasons
     where status = 'open' and ends_at > now()
     order by starts_at desc
     limit 1;
  end if;

  if nxt.id is null then
    raise exception 'play: rollover could not open a new season'
      using errcode = '22023';
  end if;

  -- Zero every non-zero bankroll, with a ledger row for each. Skipped
  -- entirely on the automatic path.
  if reset_bankrolls_in then
    for a in
      select id, balance_usd from public.play_accounts
       where balance_usd > 0
       order by id
      for update
    loop
      insert into public.play_ledger (
        account_id, season_id, kind, amount_usd,
        balance_before, balance_after, idempotency_key, metadata
      )
      values (
        a.id, nxt.id, 'season_reset', -a.balance_usd,
        a.balance_usd, 0, 'season_reset:' || cur.id::text,
        jsonb_build_object('closed_season_id', cur.id, 'new_season_id', nxt.id)
      )
      on conflict (account_id, idempotency_key) do nothing;

      if found then
        update public.play_accounts
           set balance_usd = 0, updated_at = now()
         where id = a.id;
        reset_count := reset_count + 1;
        reset_total := reset_total + a.balance_usd;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'rolled',            true,
    'closed_season_id',  cur.id,
    'new_season_id',     nxt.id,
    'new_starts_at',     nxt.starts_at,
    'new_ends_at',       nxt.ends_at,
    'reset_bankrolls',   reset_bankrolls_in,
    'accounts_reset',    reset_count,
    'balance_cleared_usd', reset_total
  );
end $$;


-- The zero-argument name every existing caller uses — the admin route
-- POST /api/play/season/rollover, the runbook's manual
-- `select public.play_rollover_season();` and the migration test suite.
-- Unchanged semantics: the weekly rollover DOES reset bankrolls.
--
-- Declared without a DEFAULT on the overload above on purpose: a default
-- would make the no-argument call ambiguous once both signatures exist.
create or replace function public.play_rollover_season()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.play_rollover_season(true);
$$;


-- =====================================================================
-- 2. CURRENT SEASON — self-healing through the existing rollover
-- =====================================================================
-- Returns the open season covering now(), recovering from an expired one
-- rather than refusing and telling a human to run SQL.
create or replace function public.play_current_season()
returns public.play_seasons
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  s       public.play_seasons;
  w_start timestamptz;
  stale   integer;
begin
  -- Fast path: the overwhelmingly common case, no lock, no write.
  select * into s
    from public.play_seasons
   where status = 'open' and starts_at <= now() and ends_at > now()
   limit 1;

  if s.id is not null then
    return s;
  end if;

  -- Slow path. Serialize with every other caller that is about to create
  -- or roll a season, so concurrent first buys cannot race.
  perform pg_advisory_xact_lock(hashtext('play_season_rollover'));

  -- Re-read under the lock: another transaction may have healed it while
  -- we waited, in which case there is nothing left to do.
  select * into s
    from public.play_seasons
   where status = 'open' and starts_at <= now() and ends_at > now()
   limit 1;

  if s.id is not null then
    return s;
  end if;

  -- THE FIX. An open season whose window has already ended is what blocks
  -- the insert below: play_seasons_single_open_idx permits exactly one
  -- 'open' row, so the stale one must be closed before a new one can
  -- exist. Hand that to the rollover function — it owns season creation,
  -- boundary alignment and overlap avoidance — with the bankroll reset
  -- switched OFF, because this runs inside an ordinary user action.
  select id into stale
    from public.play_seasons
   where status = 'open' and ends_at <= now()
   order by starts_at desc
   limit 1;

  if stale is not null then
    perform public.play_rollover_season(false);

    select * into s
      from public.play_seasons
     where status = 'open' and starts_at <= now() and ends_at > now()
     limit 1;

    if s.id is not null then
      return s;
    end if;
  end if;

  -- No season at all yet (fresh database), or the rollover left a gap.
  w_start := public.play_week_start(now());

  insert into public.play_seasons (starts_at, ends_at, status)
  values (w_start, w_start + interval '7 days', 'open')
  on conflict do nothing
  returning * into s;

  if s.id is null then
    -- Lost the race to a concurrent caller; read theirs. Re-query by
    -- coverage rather than by starts_at, so we can never hand back a
    -- CLOSED season just because its window happens to match.
    select * into s
      from public.play_seasons
     where status = 'open' and starts_at <= now() and ends_at > now()
     limit 1;
  end if;

  if s.id is null then
    -- Unreachable by any state this function can produce. Getting here
    -- means a CLOSED season overlaps now() and the exclusion constraint is
    -- refusing every insert — a hand-edited row, not something rollover
    -- can fix. Refuse loudly rather than trade into a closed season and
    -- mis-attribute everyone's P&L. Deliberately does NOT tell the reader
    -- to run play_rollover_season(): it has already run, above.
    raise exception
      'play: no open season covers now() and automatic rollover could not open one'
      using errcode = '22023';
  end if;

  return s;
end $$;


-- =====================================================================
-- 2b. DAILY GRANT — resolve the season BEFORE locking the account row
-- =====================================================================
-- Identical to 20260721_play_mode_core.sql except that
-- `season := public.play_current_season()` moves ABOVE the account's
-- `for update`.
--
-- WHY: play_current_season() may now take the rollover advisory lock, and
-- the weekly admin rollover takes that same lock and then locks every
-- funded play_accounts row. With the old ordering a trade could hold an
-- account row lock while waiting for the advisory lock, while the admin
-- rollover held the advisory lock and waited for that account row — a
-- textbook lock-order inversion that Postgres would resolve by killing
-- one of them. Acquiring the season first makes the order global and the
-- cycle impossible.
--
-- Everything else is unchanged: one $10,000 grant per UTC calendar day,
-- keyed by `daily_grant:<YYYY-MM-DD>`, no retroactive grants, and the
-- account row still locked for the read-modify-write of the balance.
create or replace function public.play_ensure_daily_grant(account_id_in uuid)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  cfg       public.play_settings;
  season    public.play_seasons;
  today     date;
  idem      text;
  bal_before numeric(18,2);
  bal_after  numeric(18,2);
  -- integer, not boolean: GET DIAGNOSTICS ... = ROW_COUNT yields an
  -- integer and Postgres has no integer->boolean assignment cast.
  n_inserted integer := 0;
begin
  select * into cfg from public.play_settings where id = 1;
  today := (now() at time zone 'UTC')::date;
  idem  := 'daily_grant:' || to_char(today, 'YYYY-MM-DD');

  -- Before any row lock. See the note above.
  season := public.play_current_season();

  -- Lock this account's row so two concurrent first-touches serialize.
  select balance_usd into bal_before
    from public.play_accounts where id = account_id_in for update;

  if bal_before is null then
    raise exception 'play: account % not found', account_id_in
      using errcode = '23503';
  end if;

  bal_after := bal_before + cfg.daily_grant_usd;

  insert into public.play_ledger (
    account_id, season_id, kind, amount_usd,
    balance_before, balance_after, idempotency_key, metadata
  )
  values (
    account_id_in, season.id, 'daily_grant', cfg.daily_grant_usd,
    bal_before, bal_after, idem,
    jsonb_build_object('grant_date', today)
  )
  on conflict (account_id, idempotency_key) do nothing;

  get diagnostics n_inserted = row_count;

  if n_inserted > 0 then
    update public.play_accounts
       set balance_usd     = bal_after,
           last_grant_date = today,
           updated_at      = now()
     where id = account_id_in;
    return bal_after;
  end if;

  -- Already granted today.
  return bal_before;
end $$;


-- =====================================================================
-- 3. SETTLEMENT — independent of any season covering now()
-- =====================================================================
-- Identical to 20260722_play_settle_idempotent.sql except for ONE thing:
-- the payout/refund ledger row is stamped with the SETTLED TRADE's
-- season_id instead of play_current_season().id.
--
-- WHY
-- ---
-- Settling a position that was opened last week is pure history. Requiring
-- a season to cover now() in order to write its ledger row made a Real
-- finalization fail for a reason that has nothing to do with the market,
-- the trade or the money — and it made settlement's success depend on a
-- weekly maintenance chore. It also does not survive the obvious question
-- "which season does this payout belong to?": play_trades.season_id is
-- already the answer everywhere else. A trade placed in season N keeps
-- season N (the core migration is explicit about this), its realized_pnl
-- is attributed to season N, and now its payout ledger row is too. One
-- season per position, start to finish.
--
-- ledger.metadata->>'trade_season_id' is retained, so nothing that read the
-- old shape loses information.
--
-- Everything else — the terminal-state gate, the already-settled no-op, the
-- pro-rata formula, the refund path, the balance credits, the idempotency
-- keys, the market-state bump — is unchanged, byte for byte.
create or replace function public.play_settle_market(market_address_in text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
set "TimeZone" = 'UTC'
as $$
declare
  m             record;
  st            public.play_market_states;
  t             record;
  final_status  text;
  winning       integer;
  final_pool    numeric(18,2);
  total_winning numeric(28,8);
  payout        numeric(18,2);
  pnl           numeric(18,2);
  new_status    text;
  bal_before    numeric(18,2);
  bal_after     numeric(18,2);
  settled_count integer := 0;
  paid_total    numeric(18,2) := 0;
  -- True when the whole market refunds instead of paying pro-rata:
  -- either the market was cancelled, or it finalized with no user-owned
  -- shares on the winning outcome.
  refund_all    boolean := false;
  no_winners    boolean := false;
  settle_reason text;
begin
  select market_address, resolution_status, resolved, winning_outcome
    into m
    from public.markets
   where market_address = market_address_in;

  if not found then
    raise exception 'play: market % not found', market_address_in
      using errcode = 'P0002';
  end if;

  final_status := lower(coalesce(m.resolution_status, 'open'));

  -- 2. Terminal states only. 'proposed' is NOT terminal — a dispute can
  --    still change the outcome, so Play waits.
  if final_status = 'cancelled' then
    winning := null;
  elsif final_status = 'finalized' and m.winning_outcome is not null then
    winning := m.winning_outcome;
  else
    return jsonb_build_object(
      'settled', false,
      'reason', 'market not in a terminal state',
      'resolution_status', final_status,
      'trades_settled', 0
    );
  end if;

  -- No Play economy for this market: nothing to do.
  select * into st from public.play_market_states
    where market_address = market_address_in;
  if st.id is null then
    return jsonb_build_object(
      'settled', true, 'reason', 'no play state', 'trades_settled', 0
    );
  end if;

  -- 3. lock
  select * into st from public.play_market_states where id = st.id for update;

  -- 3b. IDEMPOTENCY GUARD — true no-op if already settled.
  --
  -- If this market's Play state is already terminal, a prior call settled
  -- it. Return WITHOUT touching a single row: no version bump, no
  -- updated_at, no settled_at, no settlement_meta rewrite, no ledger, no
  -- balance change, no trade change.
  --
  -- Critically, we must NOT fall through to the recompute below. After the
  -- first settlement there are zero OPEN trades and the pool has drained,
  -- so recomputing would evaluate `no_winners := (winning is not null and
  -- total_winning = 0)` as true and mislabel a finalized pro-rata market
  -- as 'no_winning_positions' with zeroed totals. Instead we report the
  -- ORIGINAL settlement straight from the persisted settlement_meta, and
  -- flag the current invocation as having moved nothing.
  if st.status <> 'open' then
    return jsonb_build_object(
      'settled',                true,
      'already_settled',        true,
      'market_address',         market_address_in,
      'resolution_status',      final_status,
      -- The ORIGINAL settlement (persisted). settlement_meta is set on the
      -- first settlement; the status fallback covers only a terminal state
      -- with empty meta, which the normal path never produces.
      'reason',                 coalesce(st.settlement_meta->>'reason', st.status),
      'winning_outcome',        nullif(st.settlement_meta->>'winning_outcome','')::integer,
      'final_pool_usd',         nullif(st.settlement_meta->>'final_pool_usd','')::numeric,
      'original_paid_out_usd',  nullif(st.settlement_meta->>'paid_out_usd','')::numeric,
      'original_trades_settled',nullif(st.settlement_meta->>'trades_settled','')::integer,
      'settlement_meta',        st.settlement_meta,
      -- THIS invocation moved nothing:
      'trades_settled',         0,
      'paid_out_usd',           0,
      'market_state',           to_jsonb(st)
    );
  end if;

  final_pool := st.virtual_pool_usd;

  -- 4. Aggregate open winning shares. Sourced from play_trades, so the
  --    seeded supply in play_market_states can never be mistaken for a
  --    user-owned winning share.
  if winning is not null then
    select coalesce(sum(shares), 0) into total_winning
      from public.play_trades
     where market_address = market_address_in
       and status         = 'open'
       and outcome_index  = winning;
  else
    total_winning := 0;
  end if;

  -- Decide the settlement mode once, before touching any row.
  no_winners := (winning is not null and total_winning = 0);
  refund_all := (winning is null) or no_winners;

  settle_reason := case
    when winning is null then 'cancelled'
    when no_winners      then 'no_winning_positions'
    else 'pro_rata'
  end;

  -- 5..9. Walk every open trade in deterministic order.
  for t in
    select * from public.play_trades
     where market_address = market_address_in
       and status = 'open'
     order by created_at, id
    for update
  loop
    if refund_all then
      -- Cancelled market, or finalized with nobody on the winner.
      new_status := 'refunded';
      payout     := t.stake_usd;
      pnl        := 0;
    elsif t.outcome_index = winning then
      -- total_winning > 0 is guaranteed here: refund_all covers the zero
      -- case above, so this division is always safe.
      new_status := 'won';
      payout     := trunc(t.shares / total_winning * final_pool, 2);
      pnl        := payout - t.stake_usd;
    else
      new_status := 'lost';
      payout     := 0;
      pnl        := -t.stake_usd;
    end if;

    update public.play_trades
       set status           = new_status,
           payout_usd       = payout,
           realized_pnl_usd = pnl,
           settled_at       = now()
     where id = t.id;

    if payout > 0 then
      -- 7. Credit exactly once. The PRIMARY idempotency guard is the
      --    `status = 'open'` filter on the loop above: a second call
      --    selects no rows and credits nothing. The ledger key below is a
      --    backstop — if it ever conflicts, the whole settlement aborts,
      --    which is the correct response to that kind of inconsistency.
      update public.play_accounts
         set balance_usd = balance_usd + payout,
             updated_at  = now()
       where id = t.account_id
      returning balance_usd - payout, balance_usd into bal_before, bal_after;

      -- 8. one ledger row per settled trade, stamped with the season the
      --    POSITION belongs to. No season needs to cover now().
      insert into public.play_ledger (
        account_id, season_id, trade_id, kind, amount_usd,
        balance_before, balance_after, idempotency_key, metadata
      )
      values (
        t.account_id, t.season_id, t.id,
        case when refund_all then 'trade_refund' else 'trade_payout' end,
        payout, bal_before, bal_after,
        (case when refund_all then 'trade_refund:' else 'trade_payout:' end)
          || t.id::text,
        jsonb_build_object(
          'market_address', market_address_in,
          'outcome_index',  t.outcome_index,
          'winning_outcome', winning,
          'shares',         t.shares,
          'final_pool_usd', final_pool,
          'trade_season_id', t.season_id,
          'reason',         settle_reason
        )
      );

      paid_total := paid_total + payout;
    end if;

    settled_count := settled_count + 1;
  end loop;

  -- 10. Pool retains only the rounding dust; state becomes terminal.
  --     On a refund_all settlement SUM(refunds) == SUM(stakes) == pool
  --     exactly, so the pool drains to 0 and nothing is orphaned.
  --     Status is 'finalized' whenever the Real market finalized — the
  --     no-winning-positions case is a payout rule, not a cancellation.
  update public.play_market_states
     set virtual_pool_usd = greatest(final_pool - paid_total, 0),
         status           = case when winning is null then 'cancelled'
                                 else 'finalized' end,
         version          = version + 1,
         -- Record the FIRST settlement only. A repeat call settles zero
         -- trades and must not overwrite the audit trail of the run that
         -- actually moved the money.
         settlement_meta  = case
                              when settlement_meta = '{}'::jsonb then
                                jsonb_build_object(
                                  'reason',               settle_reason,
                                  'winning_outcome',      winning,
                                  'total_winning_shares', total_winning,
                                  'final_pool_usd',       final_pool,
                                  'paid_out_usd',         paid_total,
                                  'trades_settled',       settled_count,
                                  'settled_at',           now()
                                )
                              else settlement_meta
                            end,
         settled_at       = coalesce(settled_at, now()),
         updated_at       = now()
   where id = st.id
  returning * into st;

  -- 11. First settlement — THIS invocation moved the money, so the
  --     current-invocation totals and the original settlement totals are
  --     one and the same. already_settled is false to disambiguate from
  --     the repeat-call response shape.
  return jsonb_build_object(
    'settled',          true,
    'already_settled',  false,
    'market_address',   market_address_in,
    'resolution_status', final_status,
    'winning_outcome',  winning,
    'reason',           settle_reason,
    'no_winning_positions', no_winners,
    'refunded_all',     refund_all,
    'trades_settled',   settled_count,
    'final_pool_usd',   final_pool,
    'paid_out_usd',     paid_total,
    'dust_usd',         final_pool - paid_total,
    'total_winning_shares', total_winning,
    'market_state',     to_jsonb(st)
  );
end $$;


-- =====================================================================
-- 4. GRANTS — service_role only, as everywhere else in Play
-- =====================================================================

revoke all on function public.play_rollover_season(boolean)  from public;
revoke all on function public.play_rollover_season()         from public;
revoke all on function public.play_current_season()          from public;
revoke all on function public.play_ensure_daily_grant(uuid)  from public;
revoke all on function public.play_settle_market(text)       from public;

grant execute on function public.play_rollover_season(boolean)  to service_role;
grant execute on function public.play_rollover_season()         to service_role;
grant execute on function public.play_current_season()          to service_role;
grant execute on function public.play_ensure_daily_grant(uuid)  to service_role;
grant execute on function public.play_settle_market(text)       to service_role;


-- =====================================================================
-- 5. HEAL THE CURRENT DATABASE
-- =====================================================================
-- Applying the migration is itself the recovery: if this environment is
-- sitting on an expired open season right now, close it and open the
-- covering one. Bankrolls are NOT reset — this is a repair, not a weekly
-- competition boundary. Idempotent: a no-op when a season already covers
-- now().
select public.play_current_season();
