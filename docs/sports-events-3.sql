-- sports-events-3.sql
-- Add end_time column, indexes, and lock down RLS (server-only writes)

ALTER TABLE public.sport_events
ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sport_events_start_time
ON public.sport_events(start_time);

CREATE INDEX IF NOT EXISTS idx_sport_events_end_time
ON public.sport_events(end_time);

ALTER TABLE public.sport_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_read_sport_events
ON public.sport_events;

CREATE POLICY public_read_sport_events
ON public.sport_events
FOR SELECT
USING (true);

-- Remove any client-side write policies (server role bypasses RLS)
DROP POLICY IF EXISTS public_insert_user_sport_events
ON public.sport_events;

DROP POLICY IF EXISTS public_update_user_sport_events
ON public.sport_events;
