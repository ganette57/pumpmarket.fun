-- =====================================================================
-- Play Mode — chart history read index (additive follow-up)
-- =====================================================================
-- Supports the Play chart history reconstruction in
-- getPlayMarketHistory() / POST /api/play/markets/history, which reads
-- EVERY trade for one market (open AND settled) in created_at order to
-- replay the authoritative outcome-supply series.
--
-- The existing play_trades indexes do not cover that access pattern:
--   * play_trades_settlement_idx (market_address, status) WHERE status='open'
--     is PARTIAL to open rows, so a full-history read (which needs settled
--     rows too) cannot use it once a market resolves.
--   * play_trades_account_idx (account_id, created_at) is keyed on account,
--     not market.
--
-- This adds a full (non-partial) index on (market_address, created_at) so
-- the per-market, chronologically-ordered chart read is an index range scan
-- instead of a sequential scan as the ledger grows.
--
-- SCOPE: Play only. Additive. Idempotent (`if not exists`). Touches no Real
-- table and no function; existing Play behaviour is unchanged.
-- =====================================================================

create index if not exists play_trades_market_history_idx
  on public.play_trades (market_address, created_at);
