-- Migration: profile follows (MVP)
-- Run manually in Supabase SQL editor.
--
-- Notes on RLS:
--   The web app talks to Supabase with the anon key and identifies the
--   current user only by their connected wallet address (no auth.users).
--   Existing tables (e.g. profiles, market_likes) follow the same trust
--   model: read/write is open to anon + authenticated roles, and integrity
--   relies on PRIMARY KEY / CHECK constraints rather than per-row auth.
--   These policies match that pattern. Tighten later when the app moves
--   to wallet-signed RPCs.

CREATE TABLE IF NOT EXISTS public.profile_follows (
  follower_wallet  text        NOT NULL,
  following_wallet text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_wallet, following_wallet),
  CHECK (follower_wallet <> following_wallet)
);

CREATE INDEX IF NOT EXISTS profile_follows_following_idx
  ON public.profile_follows (following_wallet);

CREATE INDEX IF NOT EXISTS profile_follows_follower_idx
  ON public.profile_follows (follower_wallet);

ALTER TABLE public.profile_follows ENABLE ROW LEVEL SECURITY;

-- Public read
DROP POLICY IF EXISTS "profile_follows_public_read" ON public.profile_follows;
CREATE POLICY "profile_follows_public_read"
  ON public.profile_follows FOR SELECT
  TO anon, authenticated
  USING (true);

-- Anon/authenticated insert (trust the follower_wallet sent by the client,
-- consistent with how profiles + market_likes work today)
DROP POLICY IF EXISTS "profile_follows_public_insert" ON public.profile_follows;
CREATE POLICY "profile_follows_public_insert"
  ON public.profile_follows FOR INSERT
  TO anon, authenticated
  WITH CHECK (follower_wallet <> following_wallet);

-- Anon/authenticated delete (same trust model)
DROP POLICY IF EXISTS "profile_follows_public_delete" ON public.profile_follows;
CREATE POLICY "profile_follows_public_delete"
  ON public.profile_follows FOR DELETE
  TO anon, authenticated
  USING (true);
