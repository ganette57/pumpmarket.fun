-- Migration: Allow flash_crypto_price and flash_crypto_graduation in live_micro_markets
-- Run in Supabase SQL editor on the target environment.

-- 1. Drop the existing single-value check constraints
ALTER TABLE public.live_micro_markets
  DROP CONSTRAINT IF EXISTS live_micro_markets_sport_check;

ALTER TABLE public.live_micro_markets
  DROP CONSTRAINT IF EXISTS live_micro_markets_micro_market_type_check;

-- 2. Re-add with expanded allowed values
ALTER TABLE public.live_micro_markets
  ADD CONSTRAINT live_micro_markets_sport_check
  CHECK (sport IN ('soccer', 'crypto'));

ALTER TABLE public.live_micro_markets
  ADD CONSTRAINT live_micro_markets_micro_market_type_check
  CHECK (micro_market_type IN ('soccer_next_goal_5m', 'flash_crypto_price', 'flash_crypto_graduation'));

-- 3. Also relax the sport check on live_micro_match_loops (line 90 of original SQL)
ALTER TABLE public.live_micro_match_loops
  DROP CONSTRAINT IF EXISTS live_micro_match_loops_sport_check;

ALTER TABLE public.live_micro_match_loops
  ADD CONSTRAINT live_micro_match_loops_sport_check
  CHECK (sport IN ('soccer', 'crypto'));
