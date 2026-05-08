-- Migration: Add feed_video_url to markets and create market-feed-videos storage bucket
-- Run in Supabase SQL editor on the target environment.

-- 1. Add nullable column for the optional short vertical video URL.
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS feed_video_url text;

COMMENT ON COLUMN public.markets.feed_video_url
  IS 'Optional public URL of a short vertical video (≤ 8s, ≤ 8 MB) shown in the social/mobile feed.';

-- 2. Create the public storage bucket for feed videos (idempotent).
--    Mirror the existing "market-images" bucket: public read, authenticated write.
INSERT INTO storage.buckets (id, name, public)
VALUES ('market-feed-videos', 'market-feed-videos', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS policies — match the patterns used for market-images.
--    Adjust role names if your project uses different ones.

-- Public read
DROP POLICY IF EXISTS "feed_videos_public_read" ON storage.objects;
CREATE POLICY "feed_videos_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'market-feed-videos');

-- Authenticated upload
DROP POLICY IF EXISTS "feed_videos_authenticated_insert" ON storage.objects;
CREATE POLICY "feed_videos_authenticated_insert"
  ON storage.objects FOR INSERT
  TO authenticated, anon
  WITH CHECK (bucket_id = 'market-feed-videos');

-- Authenticated update (for upsert)
DROP POLICY IF EXISTS "feed_videos_authenticated_update" ON storage.objects;
CREATE POLICY "feed_videos_authenticated_update"
  ON storage.objects FOR UPDATE
  TO authenticated, anon
  USING (bucket_id = 'market-feed-videos')
  WITH CHECK (bucket_id = 'market-feed-videos');
