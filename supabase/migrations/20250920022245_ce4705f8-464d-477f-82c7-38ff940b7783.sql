-- Fix the remaining RLS policy conflict
-- Drop all SELECT policies and create one comprehensive policy

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- Create a single, comprehensive SELECT policy
CREATE POLICY "Profile access policy" 
ON public.profiles 
FOR SELECT 
USING (
  -- Users can always view their own profile
  auth.uid() = user_id 
  OR 
  -- Anyone can view public profiles
  is_public_profile = true
);