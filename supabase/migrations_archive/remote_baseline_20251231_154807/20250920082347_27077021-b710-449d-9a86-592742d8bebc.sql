-- Fix: Convert definer-style public view to invoker-safe cache-backed view, keep functionality intact
-- 1) Recreate view to read from cache (publicly selectable) and enable invoker rights
DROP VIEW IF EXISTS public.public_profiles;

CREATE VIEW public.public_profiles AS
SELECT 
  id,
  username,
  display_name,
  bio,
  avatar_url,
  created_at
FROM public.public_profile_cache;

-- Make sure the view evaluates RLS/permissions of the querying user
ALTER VIEW public.public_profiles SET (security_invoker = true, security_barrier = true);

-- 2) Ensure proper permissions
GRANT SELECT ON public.public_profiles TO anon;
GRANT SELECT ON public.public_profiles TO authenticated;

-- 3) Add triggers to keep cache in sync with profiles (function already exists)
DROP TRIGGER IF EXISTS trg_sync_public_profile_cache_insupd ON public.profiles;
DROP TRIGGER IF EXISTS trg_sync_public_profile_cache_del ON public.profiles;

CREATE TRIGGER trg_sync_public_profile_cache_insupd
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_public_profile_cache();

CREATE TRIGGER trg_sync_public_profile_cache_del
AFTER DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_public_profile_cache();

-- 4) Backfill cache for existing public profiles to avoid empty results
INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
SELECT p.id, p.username, p.display_name, p.bio, p.avatar_url, p.created_at
FROM public.profiles p
WHERE p.is_public_profile = true
ON CONFLICT (id) DO UPDATE
SET 
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  bio = EXCLUDED.bio,
  avatar_url = EXCLUDED.avatar_url,
  created_at = EXCLUDED.created_at;
