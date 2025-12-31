-- Fix verify_fanmark_password function to use correct license_id lookup
DROP FUNCTION IF EXISTS public.verify_fanmark_password(uuid, text);

CREATE OR REPLACE FUNCTION public.verify_fanmark_password(fanmark_uuid uuid, provided_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  stored_password text;
  is_enabled boolean;
BEGIN
  -- Get the password configuration for the fanmark through license
  SELECT 
    pc.access_password,
    pc.is_enabled
  INTO stored_password, is_enabled
  FROM public.fanmarks f
  JOIN public.fanmark_licenses fl ON f.id = fl.fanmark_id 
    AND fl.status = 'active' 
    AND fl.license_end > now()
  JOIN public.fanmark_password_configs pc ON fl.id = pc.license_id
  WHERE f.id = fanmark_uuid;
  
  -- Return false if no password config found or not enabled
  IF stored_password IS NULL OR is_enabled IS FALSE THEN
    RETURN false;
  END IF;
  
  -- Return true if passwords match
  RETURN stored_password = provided_password;
END;
$$;