-- 1) Create a cache table that only stores NON-sensitive public fields
CREATE TABLE IF NOT EXISTS public.public_profile_cache (
  id uuid PRIMARY KEY,
  username text,
  display_name text,
  bio text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Enable RLS and allow public read on the cache only
ALTER TABLE public.public_profile_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can select cached profiles" ON public.public_profile_cache;
CREATE POLICY "Public can select cached profiles"
ON public.public_profile_cache
FOR SELECT
USING (true);

GRANT SELECT ON public.public_profile_cache TO anon;
GRANT SELECT ON public.public_profile_cache TO authenticated;

-- 3) Sync trigger to keep cache in sync with profiles while excluding sensitive fields
CREATE OR REPLACE FUNCTION public.sync_public_profile_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.public_profile_cache WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  IF NEW.is_public_profile THEN
    INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
    VALUES (NEW.id, NEW.username, NEW.display_name, NEW.bio, NEW.avatar_url, NEW.created_at)
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      bio = EXCLUDED.bio,
      avatar_url = EXCLUDED.avatar_url,
      created_at = EXCLUDED.created_at;
  ELSE
    DELETE FROM public.public_profile_cache WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_public_profile_cache ON public.profiles;
CREATE TRIGGER trg_sync_public_profile_cache
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_public_profile_cache();

-- 4) Backfill current public profiles into the cache
INSERT INTO public.public_profile_cache (id, username, display_name, bio, avatar_url, created_at)
SELECT id, username, display_name, bio, avatar_url, created_at
FROM public.profiles
WHERE is_public_profile = true
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  bio = EXCLUDED.bio,
  avatar_url = EXCLUDED.avatar_url,
  created_at = EXCLUDED.created_at;

-- 5) Recreate the public view to read from the cache only (safe fields only)
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles AS
SELECT id, username, display_name, bio, avatar_url, created_at
FROM public.public_profile_cache;

GRANT SELECT ON public.public_profiles TO anon;
GRANT SELECT ON public.public_profiles TO authenticated;

-- 6) Tighten base table RLS - remove public access to profiles
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
-- Keep owner-only read policy created earlier:
--   CREATE POLICY "Users can view their own complete profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
