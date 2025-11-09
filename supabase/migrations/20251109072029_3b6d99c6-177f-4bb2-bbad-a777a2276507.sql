-- Update handle_new_user trigger function to default to Japanese
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
    COALESCE(NEW.raw_user_meta_data ->> 'preferred_language', 'ja')::user_language,
    CASE WHEN NOT is_oauth_user THEN NEW.raw_user_meta_data ->> 'invitation_code' ELSE NULL END,
    CASE WHEN is_oauth_user THEN true ELSE false END
  );

  RETURN NEW;
END;
$function$;

-- Update default value for preferred_language column to Japanese
ALTER TABLE public.user_settings 
ALTER COLUMN preferred_language SET DEFAULT 'ja';

COMMENT ON COLUMN public.user_settings.preferred_language IS 
'User preferred language. Defaults to Japanese (ja) for new users.';