-- Fix security issue: Remove public access to invitation codes
DROP POLICY IF EXISTS "Anyone can validate invitation codes" ON public.invitation_codes;

-- Create a secure function to validate invitation codes without exposing them
CREATE OR REPLACE FUNCTION public.validate_invitation_code(code_to_check text)
RETURNS TABLE(
  is_valid boolean,
  special_perks jsonb,
  remaining_uses integer
) 
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    CASE 
      WHEN ic.code IS NOT NULL THEN true
      ELSE false
    END as is_valid,
    COALESCE(ic.special_perks, '{}'::jsonb) as special_perks,
    GREATEST(0, ic.max_uses - ic.used_count) as remaining_uses
  FROM public.invitation_codes ic
  WHERE ic.code = code_to_check
    AND ic.is_active = true
    AND (ic.expires_at IS NULL OR ic.expires_at > now())
    AND ic.used_count < ic.max_uses
  LIMIT 1;
$$;

-- Create a function to increment invitation code usage (for registration process)
CREATE OR REPLACE FUNCTION public.use_invitation_code(code_to_use text)
RETURNS TABLE(
  success boolean,
  special_perks jsonb,
  error_message text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  code_record record;
BEGIN
  -- Check if code exists and is valid
  SELECT * INTO code_record
  FROM public.invitation_codes
  WHERE code = code_to_use
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND used_count < max_uses;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '{}'::jsonb, 'Invalid or expired invitation code'::text;
    RETURN;
  END IF;

  -- Increment usage count
  UPDATE public.invitation_codes
  SET used_count = used_count + 1,
      updated_at = now()
  WHERE id = code_record.id;

  RETURN QUERY SELECT true, code_record.special_perks, ''::text;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.validate_invitation_code(text) TO anon;
GRANT EXECUTE ON FUNCTION public.validate_invitation_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_invitation_code(text) TO anon;
GRANT EXECUTE ON FUNCTION public.use_invitation_code(text) TO authenticated;