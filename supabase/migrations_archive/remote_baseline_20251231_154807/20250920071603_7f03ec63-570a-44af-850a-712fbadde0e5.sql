-- Fix linter error: Security Definer View and secure public profile caching
-- 1) Secure cache table by revoking public DML (in case previously granted)
REVOKE INSERT, UPDATE, DELETE ON public.public_profile_cache FROM PUBLIC, anon, authenticated;

-- 2) Recreate sync function as SECURITY DEFINER so it can maintain the cache despite RLS
CREATE OR REPLACE FUNCTION public.sync_public_profile_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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
$function$;

-- 3) Attach trigger to keep cache in sync
DROP TRIGGER IF EXISTS profiles_sync_public_profile_cache ON public.profiles;
CREATE TRIGGER profiles_sync_public_profile_cache
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_public_profile_cache();

-- 4) Recreate the public view to be SECURITY INVOKER and read only from cache
DROP VIEW IF EXISTS public.public_profiles;
CREATE VIEW public.public_profiles WITH (security_invoker = true) AS
SELECT id, username, display_name, bio, avatar_url, created_at
FROM public.public_profile_cache;

-- 5) Explicitly grant read access to the view (data is safe and governed by cache table policy)
GRANT SELECT ON public.public_profiles TO anon, authenticated;
