-- ==========================================================================
-- Sports Events Cache: Supabase migration
-- Run this in Supabase SQL Editor (or via supabase db push / migration).
-- ==========================================================================

-- 1) Create sport_events table
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sport_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text        NOT NULL,                          -- e.g. 'api_sports'
  provider_event_id text      NOT NULL UNIQUE,
  sport           text        NOT NULL
                    CHECK (sport IN ('soccer','basketball','american_football','mma','tennis')),
  league          text        NULL,
  home_team       text        NOT NULL,
  away_team       text        NOT NULL,
  start_time      timestamptz NOT NULL,
  status          text        NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','live','finished','cancelled','postponed')),
  score           jsonb       NULL,                              -- normalized provider score
  last_polled_at  timestamptz NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sport_events_sport_start
  ON public.sport_events (sport, start_time);
CREATE INDEX IF NOT EXISTS idx_sport_events_status
  ON public.sport_events (status);
CREATE INDEX IF NOT EXISTS idx_sport_events_provider_event_id
  ON public.sport_events (provider_event_id);

-- 2) Add columns to existing markets table
-- -----------------------------------------------------------------
-- NOTE: market_type (integer: 0=binary, 1=multi) already exists.
--       We add market_mode (text) for normal / sport_live / live_stream.
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS market_mode     text   NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS sport_event_id  uuid   NULL
    REFERENCES public.sport_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sport_meta      jsonb  NULL;

-- 3) RLS policies for sport_events
-- -----------------------------------------------------------------
ALTER TABLE public.sport_events ENABLE ROW LEVEL SECURITY;

-- Public read
CREATE POLICY sport_events_select_public
  ON public.sport_events FOR SELECT
  USING (true);

-- No client-side INSERT/UPDATE/DELETE — only service role bypasses RLS.
-- (Intentionally no write policies.)

-- 4) DO NOT change existing RLS on markets.
-- The new columns are governed by existing policies.
