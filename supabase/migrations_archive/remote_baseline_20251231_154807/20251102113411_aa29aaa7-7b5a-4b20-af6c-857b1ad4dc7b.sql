-- Modify handle_new_user() function to enforce invitation code for OAuth signups
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
BEGIN
  -- Check if invitation mode is enabled
  SELECT setting_value INTO invitation_mode_enabled
  FROM public.system_settings
  WHERE setting_key = 'invitation_mode';

  -- If invitation mode is enabled, validate invitation code
  IF invitation_mode_enabled = 'true' THEN
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
    invitation_code
  );

  RETURN NEW;
END;
$function$;