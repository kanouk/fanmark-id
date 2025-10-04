-- Ensure usernames are automatically generated in the format userXXXXXXXXXX
CREATE SEQUENCE IF NOT EXISTS public.user_username_seq;

-- Helper function to generate the next available numeric username
CREATE OR REPLACE FUNCTION public.generate_numeric_username()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
BEGIN
  LOOP
    candidate := 'user' || lpad(nextval('public.user_username_seq')::text, 10, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.user_settings WHERE username = candidate
    );
  END LOOP;
  RETURN candidate;
END;
$$;

-- Align the sequence with the current highest numeric username, if any exist
DO $$
DECLARE
  max_suffix bigint;
BEGIN
  SELECT MAX((regexp_matches(username, '^user(\\d+)$'))[1]::bigint)
    INTO max_suffix
  FROM public.user_settings
  WHERE username ~ '^user\\d+$';

  IF max_suffix IS NULL THEN
    PERFORM setval('public.user_username_seq', 0, false);
  ELSE
    PERFORM setval('public.user_username_seq', max_suffix, true);
  END IF;
END;
$$;

-- Update new user handler to always use the generated username
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (
    user_id,
    username,
    display_name,
    plan_type,
    preferred_language
  ) VALUES (
    NEW.id,
    public.generate_numeric_username(),
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      public.generate_safe_display_name(NEW.email, NEW.id)
    ),
    'free',
    COALESCE(NEW.raw_user_meta_data ->> 'preferred_language', 'en')::user_language
  );
  RETURN NEW;
END;
$$;
