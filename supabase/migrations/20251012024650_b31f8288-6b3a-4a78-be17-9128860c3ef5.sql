-- Create a secure function to check username availability
-- This prevents direct access to other users' data while allowing username uniqueness checks
CREATE OR REPLACE FUNCTION public.check_username_availability_secure(
  username_to_check text,
  current_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Return false if username is empty
  IF username_to_check IS NULL OR username_to_check = '' THEN
    RETURN false;
  END IF;
  
  -- Check if username exists for a different user
  RETURN NOT EXISTS (
    SELECT 1 
    FROM public.user_settings
    WHERE username = lower(username_to_check)
      AND user_id != COALESCE(current_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
END;
$$;

-- Add comment explaining the function's purpose
COMMENT ON FUNCTION public.check_username_availability_secure IS 
'Securely checks if a username is available without exposing other users data. Returns true if available, false if taken.';