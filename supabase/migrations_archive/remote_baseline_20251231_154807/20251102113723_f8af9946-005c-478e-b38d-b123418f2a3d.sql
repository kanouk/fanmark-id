-- Update handle_new_user() to handle OAuth users differently
-- OAuth users will have invitation code validation done in the frontend
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  invitation_mode_enabled text;
  invitation_code text;
  validation_result record;
  use_code_result record;
  is_oauth_user boolean;
BEGIN
  -- Check if this is an OAuth user (has iss or provider in raw_user_meta_data)
  is_oauth_user := (
    NEW.raw_user_meta_data ? 'iss' OR 
    NEW.raw_user_meta_data ? 'provider' OR
    NEW.raw_user_meta_data ? 'provider_id'
  );

  -- Check if invitation mode is enabled
  SELECT setting_value INTO invitation_mode_enabled
  FROM public.system_settings
  WHERE setting_key = 'invitation_mode';

  -- For email/password signups, validate invitation code if invitation mode is enabled
  IF invitation_mode_enabled = 'true' AND NOT is_oauth_user THEN
    -- Extract invitation_code from raw_user_meta_data
    invitation_code := NEW.raw_user_meta_data ->> 'invitation_code';

    -- Check if invitation code exists
    IF invitation_code IS NULL OR invitation_code = '' THEN
      RAISE EXCEPTION 'Invitation code is required for sign-up';
    END IF;

    -- Validate the invitation code
    SELECT is_valid INTO validation_result
    FROM public.validate_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR validation_result.is_valid = false THEN
      RAISE EXCEPTION 'Invalid invitation code: %', invitation_code;
    END IF;

    -- Use (consume) the invitation code
    SELECT success INTO use_code_result
    FROM public.use_invitation_code(invitation_code)
    LIMIT 1;

    IF NOT FOUND OR use_code_result.success = false THEN
      RAISE EXCEPTION 'Failed to use invitation code: %', invitation_code;
    END IF;
  END IF;

  -- Insert user settings (with or without invitation code)
  -- OAuth users will have their invitation code updated later in the frontend
  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language,
    invited_by_code
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'username', 'user_' || substring(NEW.id::text, 1, 8)),
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      public.generate_safe_display_name(NEW.email, NEW.id)
    ),
    'free',
    COALESCE(NEW.raw_user_meta_data ->> 'preferred_language', 'en')::user_language,
    CASE WHEN is_oauth_user THEN NULL ELSE invitation_code END
  );

  RETURN NEW;
END;
$function$;