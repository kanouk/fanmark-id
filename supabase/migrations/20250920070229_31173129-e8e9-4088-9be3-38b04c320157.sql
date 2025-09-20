-- Fix the sync function permissions without SECURITY DEFINER
-- Grant the necessary permissions for the trigger function to work

-- Grant INSERT, UPDATE, DELETE permissions on public_profile_cache to public schema
GRANT INSERT, UPDATE, DELETE ON public.public_profile_cache TO PUBLIC;

-- Recreate the function with proper permissions
CREATE OR REPLACE FUNCTION public.sync_public_profile_cache()
RETURNS trigger
LANGUAGE plpgsql
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