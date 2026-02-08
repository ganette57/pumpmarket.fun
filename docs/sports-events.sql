-- Sports Events infrastructure
-- Run this migration after live-sessions.sql

/* -------------------------------------------------------------------------- */
/*  sport_events table                                                         */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS sport_events (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  sport             TEXT NOT NULL CHECK (sport IN ('soccer','basketball','american_football','mma','tennis')),
  league            TEXT,
  home_team         TEXT,
  away_team         TEXT,
  start_time        TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','live','finished','cancelled','postponed')),
  score             JSONB DEFAULT '{}'::jsonb,
  last_update       TIMESTAMPTZ DEFAULT now(),
  raw               JSONB,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sport_events_provider_event_id ON sport_events (provider_event_id);
CREATE INDEX IF NOT EXISTS idx_sport_events_sport_start       ON sport_events (sport, start_time);
CREATE INDEX IF NOT EXISTS idx_sport_events_status_start      ON sport_events (status, start_time);

/* -------------------------------------------------------------------------- */
/*  Extend markets table                                                       */
/* -------------------------------------------------------------------------- */

ALTER TABLE markets ADD COLUMN IF NOT EXISTS market_mode    TEXT DEFAULT 'normal';
ALTER TABLE markets ADD COLUMN IF NOT EXISTS sport_event_id UUID REFERENCES sport_events(id);
ALTER TABLE markets ADD COLUMN IF NOT EXISTS sport_meta     JSONB DEFAULT '{}'::jsonb;

/* -------------------------------------------------------------------------- */
/*  RLS                                                                        */
/* -------------------------------------------------------------------------- */

ALTER TABLE sport_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_sport_events"
  ON sport_events FOR SELECT
  USING (true);

-- No client write policies — writes happen via service role only.
