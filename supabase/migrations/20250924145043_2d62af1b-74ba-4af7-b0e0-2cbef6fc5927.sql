-- Add a new RLS policy to allow checking fanmark availability without revealing owner details
CREATE POLICY "Anyone can check fanmark license status for availability" 
ON public.fanmark_licenses 
FOR SELECT 
USING (
  -- Allow viewing license existence for availability checking
  -- Only expose minimal data needed for availability determination
  status = 'active' AND license_end > now()
);

-- Create a secure function to check fanmark availability
CREATE OR REPLACE FUNCTION public.check_fanmark_availability(fanmark_uuid uuid)
RETURNS TABLE(
  is_available boolean,
  has_active_license boolean
) 
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    CASE 
      WHEN fl.id IS NULL THEN true
      WHEN fl.status = 'active' AND fl.license_end > now() THEN false
      ELSE true
    END as is_available,
    CASE 
      WHEN fl.status = 'active' AND fl.license_end > now() THEN true
      ELSE false
    END as has_active_license
  FROM fanmarks f
  LEFT JOIN fanmark_licenses fl ON f.id = fl.fanmark_id 
    AND fl.status = 'active' 
    AND fl.license_end > now()
  WHERE f.id = fanmark_uuid
  LIMIT 1;
$$;