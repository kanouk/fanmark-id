-- Update handle_new_user function to set display_name same as username
-- This prevents unintentionally exposing email addresses as display names

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  generated_username TEXT;
BEGIN
  -- Generate username: user_ + first 8 chars of UUID
  generated_username := COALESCE(
    NEW.raw_user_meta_data ->> 'username',
    'user_' || substring(NEW.id::text, 1, 8)
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
    COALESCE((NEW.raw_user_meta_data ->> 'requires_password_setup')::boolean, false)
  );
  RETURN NEW;
END;
$$;