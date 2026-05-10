-- Adds an optional bio field to the public profiles table.
-- Idempotent: safe to run more than once.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text;
