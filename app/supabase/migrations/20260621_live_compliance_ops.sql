-- =====================================================================
-- Live Compliance & Operations
--  - Adds the `disabled` status + audit columns to live_sessions
--  - Creates the blocked_streams table (DMCA / copyright / moderation)
-- This migration is additive and idempotent. It does NOT delete any data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. live_sessions: allow the `disabled` status + audit trail columns
-- ---------------------------------------------------------------------

-- Recreate the status CHECK constraint to include 'disabled'.
ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_status_check;
ALTER TABLE live_sessions
  ADD CONSTRAINT live_sessions_status_check
  CHECK (status IN (
    'scheduled','live','locked','ended','resolved','cancelled','disabled'
  ));

-- Audit trail for an Admin "Disable Live" action (Part 5).
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS disabled_at    TIMESTAMPTZ;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS disabled_by    TEXT;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS disable_reason TEXT;

-- ---------------------------------------------------------------------
-- 2. blocked_streams: compliance block-list (Part 7)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blocked_streams (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider          TEXT NOT NULL CHECK (provider IN ('youtube','twitch','kick')),
  provider_channel  TEXT,
  provider_video_id TEXT,
  reason            TEXT,
  created_at        TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Lookups happen by provider + (channel | video id) at create/render time.
CREATE INDEX IF NOT EXISTS idx_blocked_streams_video
  ON blocked_streams (provider, provider_video_id);
CREATE INDEX IF NOT EXISTS idx_blocked_streams_channel
  ON blocked_streams (provider, provider_channel);

-- RLS: anyone may read the block-list (needed for the client-side create/render
-- checks); only the service role (admin routes) may insert/delete.
ALTER TABLE blocked_streams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocked_streams read" ON blocked_streams;
CREATE POLICY "blocked_streams read"
  ON blocked_streams FOR SELECT
  USING (true);
