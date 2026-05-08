-- Migration: Add feed_thumbnail_url to markets and create market-feed-thumbnails storage bucket.
-- Companion to docs/migration-feed-video.sql. Run in Supabase SQL editor on the target environment.

-- 1. Add nullable column for the auto-generated video thumbnail URL.
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS feed_thumbnail_url text;

COMMENT ON COLUMN public.markets.feed_thumbnail_url
  IS 'Optional public URL of a JPEG poster frame extracted from feed_video_url. Used as a card preview when no market image was uploaded.';

-- 2. Create the public storage bucket for thumbnails (idempotent).
--    public = true lets the CDN serve direct public URLs without an RLS SELECT policy,
--    so we keep storage.objects locked down for listing while still allowing reads.
INSERT INTO storage.buckets (id, name, public)
VALUES ('market-feed-thumbnails', 'market-feed-thumbnails', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS policies — INSERT + UPDATE only.
--    We intentionally do NOT add a SELECT policy: the bucket's public=true flag
--    already serves files via the public URL, and skipping SELECT prevents
--    broad listing of the bucket contents through the Supabase SDK.

DROP POLICY IF EXISTS "feed_thumbnails_authenticated_insert" ON storage.objects;
CREATE POLICY "feed_thumbnails_authenticated_insert"
  ON storage.objects FOR INSERT
  TO authenticated, anon
  WITH CHECK (bucket_id = 'market-feed-thumbnails');

DROP POLICY IF EXISTS "feed_thumbnails_authenticated_update" ON storage.objects;
CREATE POLICY "feed_thumbnails_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated, anon
  USING (bucket_id = 'market-feed-thumbnails')
  WITH CHECK (bucket_id = 'market-feed-thumbnails');
