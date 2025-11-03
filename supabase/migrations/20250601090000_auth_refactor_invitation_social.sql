-- Add social_login_enabled system setting (default true)
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public, created_at, updated_at)
VALUES (
  'social_login_enabled',
  'true',
  'Toggle to allow or disable social (OAuth) login/signup from the product UI',
  true,
  now(),
  now()
)
ON CONFLICT (setting_key) DO UPDATE
SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public,
  updated_at = now();

-- Extend user_settings to track password setup requirement
ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS requires_password_setup boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_settings.requires_password_setup IS
  'Indicates that the user must complete password setup before accessing the app';

-- Ensure existing OAuth users without a password are flagged
UPDATE public.user_settings us
SET requires_password_setup = true
FROM auth.users u
WHERE us.user_id = u.id
  AND (
    u.raw_user_meta_data ? 'iss'
    OR u.raw_user_meta_data ? 'provider'
    OR u.raw_user_meta_data ? 'provider_id'
  )
  AND (u.encrypted_password IS NULL OR u.encrypted_password = '');

-- Update handle_new_user trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  invitation_mode_enabled text;
  social_login_enabled text;
  invitation_code text;
  validation_result record;
  use_code_result record;
  is_oauth_user boolean;
BEGIN
  -- Determine if this signup came from an OAuth provider
  is_oauth_user := (
    NEW.raw_user_meta_data ? 'iss' OR
    NEW.raw_user_meta_data ? 'provider' OR
    NEW.raw_user_meta_data ? 'provider_id'
  );

  -- Fetch invitation mode flag
  SELECT setting_value INTO invitation_mode_enabled
  FROM public.system_settings
  WHERE setting_key = 'invitation_mode';

  -- Fetch social login toggle (defaults to true when missing)
  SELECT setting_value INTO social_login_enabled
  FROM public.system_settings
  WHERE setting_key = 'social_login_enabled';

  IF social_login_enabled IS NULL THEN
    social_login_enabled := 'true';
  END IF;

  -- Block OAuth signups when invitation mode is active or social login is disabled
  IF is_oauth_user THEN
    IF invitation_mode_enabled = 'true' THEN
      RAISE EXCEPTION 'Social login is not allowed while invitation mode is active';
    END IF;

    IF social_login_enabled = 'false' THEN
      RAISE EXCEPTION 'Social login is currently disabled';
    END IF;
  END IF;

  -- For email/password signups, enforce invitation code when required
  IF invitation_mode_enabled = 'true' AND NOT is_oauth_user THEN
    invitation_code := NEW.raw_user_meta_data ->> 'invitation_code';

    IF invitation_code IS NULL OR invitation_code = '' THEN
      RAISE EXCEPTION 'Invitation code is required for sign-up';
    END IF;

    SELECT is_valid INTO validation_result
    FROM public.validate_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR validation_result.is_valid = false THEN
      RAISE EXCEPTION 'Invalid invitation code: %', invitation_code;
    END IF;

    SELECT success INTO use_code_result
    FROM public.use_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR use_code_result.success = false THEN
      RAISE EXCEPTION 'Failed to use invitation code: %', invitation_code;
    END IF;
  END IF;

  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language,
    invited_by_code,
    requires_password_setup
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'username', 'user_' || substring(NEW.id::text, 1, 8)),
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      public.generate_safe_display_name(NEW.email, NEW.id)
    ),
    'free',
    COALESCE(NEW.raw_user_meta_data ->> 'preferred_language', 'en')::user_language,
    CASE WHEN NOT is_oauth_user THEN NEW.raw_user_meta_data ->> 'invitation_code' ELSE NULL END,
    CASE WHEN is_oauth_user THEN true ELSE false END
  );

  RETURN NEW;
END;
$function$;
