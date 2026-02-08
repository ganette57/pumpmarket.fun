-- Sports Events Phase 2 — sport market integration
-- Run after docs/sports-events.sql

/* -------------------------------------------------------------------------- */
/*  Add sport_trading_state to markets                                         */
/* -------------------------------------------------------------------------- */

ALTER TABLE markets ADD COLUMN IF NOT EXISTS sport_trading_state TEXT DEFAULT 'open';
-- Values: 'open' | 'locked_by_sport' | 'ended_by_sport'
