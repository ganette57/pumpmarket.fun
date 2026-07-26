-- =====================================================================
-- Play Mode — leaderboard read index (additive follow-up)
-- =====================================================================
-- Supports the global Play leaderboard build in getPlayLeaderboard() /
-- POST /api/play/leaderboard, which reads EVERY SETTLED play_trades row
-- (status <> 'open') and aggregates realized P&L per account, grouped by
-- (market_address, outcome_index) for the pick/win counts.
--
-- The existing play_trades indexes do not cover that access pattern:
--   * play_trades_season_pnl_idx (season_id, account_id) WHERE status<>'open'
--     and play_trades_daily_idx  (trade_date, account_id) WHERE status<>'open'
--     both lead with a PERIOD column. The leaderboard is All Time, so it has
--     no season_id / trade_date predicate to seek on.
--   * play_trades_account_idx    (account_id, created_at) is not partial, so
--     it cannot skip the open rows that make up most of a live ledger.
--   * play_trades_market_history_idx (market_address, created_at) is keyed on
--     market, not account.
--
-- This adds a partial index over settled rows only, keyed in the exact order
-- the aggregation groups, so the scan is an index range over the settled
-- subset instead of a sequential scan of the whole trade ledger.
--
-- NOT REQUIRED FOR CORRECTNESS. The leaderboard aggregates in Node over a
-- bounded read and is correct without this index; it is a pure read-path
-- optimisation as the ledger grows.
--
-- SCOPE: Play only. Additive. Idempotent (`if not exists`). Touches no Real
-- table, no function and no policy; existing Play behaviour is unchanged.
--
-- NOT APPLIED. Run it yourself, against DEV only:
--   psql "$DATABASE_URL" -f supabase/migrations/20260726_play_leaderboard_index.sql
-- =====================================================================

create index if not exists play_trades_leaderboard_idx
  on public.play_trades (account_id, market_address, outcome_index)
  where status <> 'open';
