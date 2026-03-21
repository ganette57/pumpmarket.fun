-- Live micro-markets MVP (devnet-only foundation)
-- Phase 1: soccer_next_goal_5m
--
-- Run manually in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS public.live_micro_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  provider_match_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  sport TEXT NOT NULL CHECK (sport IN ('soccer', 'crypto')),
  micro_market_type TEXT NOT NULL CHECK (micro_market_type IN ('soccer_next_goal_5m', 'flash_crypto_price')),

  linked_market_id UUID NULL REFERENCES public.markets(id),
  linked_market_address TEXT NULL,

  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,

  start_home_score INT NOT NULL,
  start_away_score INT NOT NULL,
  end_home_score INT NULL,
  end_away_score INT NULL,
  last_polled_at TIMESTAMPTZ NULL,
  goal_observed BOOLEAN NOT NULL DEFAULT FALSE,
  goal_observed_at TIMESTAMPTZ NULL,
  trading_locked_at TIMESTAMPTZ NULL,
  pending_outcome TEXT NULL CHECK (pending_outcome IN ('YES','NO')),

  engine_status TEXT NOT NULL DEFAULT 'active',
  resolution_outcome TEXT NULL CHECK (resolution_outcome IN ('YES','NO')),

  created_by_operator_wallet TEXT NOT NULL,

  provider_payload_start JSONB NULL,
  provider_payload_end JSONB NULL,

  error_state TEXT NULL,
  error_message TEXT NULL,

  resolved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.live_micro_markets
  ADD COLUMN IF NOT EXISTS goal_observed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.live_micro_markets
  ADD COLUMN IF NOT EXISTS goal_observed_at TIMESTAMPTZ NULL;

ALTER TABLE public.live_micro_markets
  ADD COLUMN IF NOT EXISTS trading_locked_at TIMESTAMPTZ NULL;

ALTER TABLE public.live_micro_markets
  ADD COLUMN IF NOT EXISTS pending_outcome TEXT NULL CHECK (pending_outcome IN ('YES','NO'));

CREATE INDEX IF NOT EXISTS idx_live_micro_provider_match
  ON public.live_micro_markets(provider_match_id, provider_name);

CREATE INDEX IF NOT EXISTS idx_live_micro_engine_status
  ON public.live_micro_markets(engine_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_live_micro_active_per_match
  ON public.live_micro_markets(provider_match_id, provider_name, micro_market_type)
  WHERE engine_status = 'active';

ALTER TABLE public.live_micro_markets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_read_live_micro_markets ON public.live_micro_markets;
CREATE POLICY public_read_live_micro_markets
  ON public.live_micro_markets
  FOR SELECT
  USING (true);

-- No client write policy (service role only)
DROP POLICY IF EXISTS public_insert_live_micro_markets ON public.live_micro_markets;
DROP POLICY IF EXISTS public_update_live_micro_markets ON public.live_micro_markets;
DROP POLICY IF EXISTS public_delete_live_micro_markets ON public.live_micro_markets;

-- ---------------------------------------------------------------------------
-- Selected-match loop controller (Phase 2)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.live_micro_match_loops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  provider_match_id TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'soccer' CHECK (sport = 'soccer'),

  loop_status TEXT NOT NULL DEFAULT 'active' CHECK (loop_status IN ('active', 'halftime', 'ended', 'error')),
  loop_phase TEXT NOT NULL DEFAULT 'first_half' CHECK (loop_phase IN ('first_half', 'halftime', 'second_half', 'ended')),

  first_half_count INT NOT NULL DEFAULT 0,
  second_half_count INT NOT NULL DEFAULT 0,
  halftime_started_at TIMESTAMPTZ NULL,

  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by TEXT NULL,
  scheduled_start_time TIMESTAMPTZ NULL,
  last_snapshot_payload JSONB NULL,

  stop_reason TEXT NULL,
  current_active_live_micro_id UUID NULL REFERENCES public.live_micro_markets(id),
  error_message TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS loop_status TEXT NOT NULL DEFAULT 'active' CHECK (loop_status IN ('active', 'halftime', 'ended', 'error'));

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS loop_phase TEXT NOT NULL DEFAULT 'first_half' CHECK (loop_phase IN ('first_half', 'halftime', 'second_half', 'ended'));

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS first_half_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS second_half_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS halftime_started_at TIMESTAMPTZ NULL;

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS activated_by TEXT NULL;

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS scheduled_start_time TIMESTAMPTZ NULL;

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS last_snapshot_payload JSONB NULL;

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS stop_reason TEXT NULL;

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS current_active_live_micro_id UUID NULL REFERENCES public.live_micro_markets(id);

ALTER TABLE public.live_micro_match_loops
  ADD COLUMN IF NOT EXISTS error_message TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_live_micro_match_loops_match
  ON public.live_micro_match_loops(provider_match_id, provider_name, sport);

CREATE INDEX IF NOT EXISTS idx_live_micro_match_loops_status
  ON public.live_micro_match_loops(loop_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_micro_match_loops_phase
  ON public.live_micro_match_loops(loop_phase, updated_at DESC);

ALTER TABLE public.live_micro_match_loops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_read_live_micro_match_loops ON public.live_micro_match_loops;
CREATE POLICY public_read_live_micro_match_loops
  ON public.live_micro_match_loops
  FOR SELECT
  USING (true);

-- No client write policy (service role only)
DROP POLICY IF EXISTS public_insert_live_micro_match_loops ON public.live_micro_match_loops;
DROP POLICY IF EXISTS public_update_live_micro_match_loops ON public.live_micro_match_loops;
DROP POLICY IF EXISTS public_delete_live_micro_match_loops ON public.live_micro_match_loops;
