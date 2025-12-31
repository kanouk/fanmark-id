-- Fix fanmark_profiles RLS to enforce is_public flag

-- Drop existing policy that allows all operations for owners
DROP POLICY IF EXISTS "Users can manage their own fanmark profiles" ON public.fanmark_profiles;

-- Create separate policies for different operations

-- SELECT policy: Allow viewing public profiles OR own profiles (public or private)
CREATE POLICY "Users can view public profiles or their own profiles"
ON public.fanmark_profiles
FOR SELECT
USING (
  is_public = true 
  OR 
  EXISTS (
    SELECT 1 
    FROM public.fanmark_licenses fl
    WHERE fl.id = fanmark_profiles.license_id 
      AND fl.user_id = auth.uid()
  )
);

-- INSERT policy: Users can create profiles for their own active licenses
CREATE POLICY "Users can create profiles for their own licenses"
ON public.fanmark_profiles
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.id = fanmark_profiles.license_id 
      AND fl.user_id = auth.uid()
      AND fl.status = 'active' 
      AND fl.license_end > now()
  )
);

-- UPDATE policy: Users can update their own profiles
CREATE POLICY "Users can update their own profiles"
ON public.fanmark_profiles
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.id = fanmark_profiles.license_id 
      AND fl.user_id = auth.uid()
  )
);

-- DELETE policy: Users can delete their own profiles
CREATE POLICY "Users can delete their own profiles"
ON public.fanmark_profiles
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.fanmark_licenses fl
    WHERE fl.id = fanmark_profiles.license_id 
      AND fl.user_id = auth.uid()
  )
);