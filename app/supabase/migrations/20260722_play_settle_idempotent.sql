-- =====================================================================
-- Play Mode — settlement idempotency fix (follow-up migration)
-- =====================================================================
-- Re-defines public.play_settle_market so that a repeated call on an
-- already-settled market is a TRUE no-op.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The base migration 20260721_play_mode_core.sql has already been applied
-- to Supabase Dev, so its play_settle_market edit does not reach Dev by
-- itself. This additive follow-up carries the identical, corrected
-- function definition to any environment that already ran the base
-- migration. `create or replace` makes it safe to run any number of times.
--
-- The function body below is byte-for-byte identical to play_settle_market
-- in 20260721_play_mode_core.sql. A fresh database that applies the base
-- migration and then this one ends at the same definition.
--
-- THE BUG THIS FIXES
-- ------------------
-- The old function's only idempotency guard was the `status = 'open'`
-- filter on the per-trade loop. That correctly stopped re-crediting money,
-- but the function still:
--   * recomputed the settlement mode from the now-empty open-trade set,
--     mislabelling a finalized pro-rata market as 'no_winning_positions'
--     with zeroed totals; and
--   * ran the terminal-state UPDATE unconditionally, bumping version and
--     updated_at on every repeat call.
-- The fix adds an early no-op return, immediately after the row lock, when
-- the Play market state is already terminal.
--
-- Additive and idempotent. No table is altered, no Real object touched.
-- =====================================================================

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
  season        public.play_seasons;
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

  season     := public.play_current_season();
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

      -- 8. one ledger row per settled trade
      insert into public.play_ledger (
        account_id, season_id, trade_id, kind, amount_usd,
        balance_before, balance_after, idempotency_key, metadata
      )
      values (
        t.account_id, season.id, t.id,
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

-- Re-assert the grant (create or replace preserves it, but be explicit so
-- this file is self-sufficient on any environment).
revoke all on function public.play_settle_market(text) from public;
grant execute on function public.play_settle_market(text) to service_role;
