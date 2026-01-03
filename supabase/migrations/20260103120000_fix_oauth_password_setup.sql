-- Ensure OAuth signups require password setup and backfill existing OAuth users without passwords.

-- Backfill: mark OAuth users without passwords as requiring setup.
UPDATE public.user_settings us
SET requires_password_setup = true
FROM auth.users u
WHERE us.user_id = u.id
  AND us.requires_password_setup = false
  AND (u.raw_app_meta_data ->> 'provider') IS NOT NULL
  AND (u.raw_app_meta_data ->> 'provider') <> 'email'
  AND (u.encrypted_password IS NULL OR u.encrypted_password = '');

-- Update user creation trigger to flag OAuth signups.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  generated_username TEXT;
  is_oauth_user BOOLEAN;
BEGIN
  -- Generate username: user_ + first 8 chars of UUID
  generated_username := COALESCE(
    NEW.raw_user_meta_data ->> 'username',
    'user_' || substring(NEW.id::text, 1, 8)
  );

  is_oauth_user := (
    COALESCE(NEW.raw_app_meta_data ->> 'provider', '') <> ''
    AND (NEW.raw_app_meta_data ->> 'provider') <> 'email'
  ) OR (
    NEW.raw_user_meta_data ? 'iss'
    OR NEW.raw_user_meta_data ? 'provider'
    OR NEW.raw_user_meta_data ? 'provider_id'
  );

  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language,
    invited_by_code,
    requires_password_setup
  )
  VALUES (
    NEW.id,
    generated_username,
    -- Use the same value as username for display_name (privacy protection)
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', generated_username),
    COALESCE((NEW.raw_user_meta_data ->> 'plan_type')::user_plan, 'free'),
    COALESCE((NEW.raw_user_meta_data ->> 'preferred_language')::user_language, 'ja'),
    NEW.raw_user_meta_data ->> 'invited_by_code',
    CASE
      WHEN is_oauth_user THEN true
      ELSE COALESCE((NEW.raw_user_meta_data ->> 'requires_password_setup')::boolean, false)
    END
  );
  RETURN NEW;
END;
$function$;
