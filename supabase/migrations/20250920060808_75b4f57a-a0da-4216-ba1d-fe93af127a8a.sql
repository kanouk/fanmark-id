-- Drop the previous view and recreate it without SECURITY DEFINER
DROP VIEW IF EXISTS public.public_profiles;

-- Create a simple view that inherits the user's permissions
CREATE VIEW public.public_profiles AS
SELECT 
  id,
  username,
  display_name,
  bio,
  avatar_url,
  created_at
FROM public.profiles
WHERE is_public_profile = true;

-- The view will inherit RLS policies from the underlying table
-- Grant SELECT permissions on the view
GRANT SELECT ON public.public_profiles TO anon;
GRANT SELECT ON public.public_profiles TO authenticated;

-- Now let's fix the RLS policies to work properly with the view
-- We need to update the policies to allow the view to work correctly

-- Drop existing policies
DROP POLICY IF EXISTS "Public can view limited profile data" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view public profiles" ON public.profiles;

-- Create a single policy for public profile access
-- This will work with both direct table access and view access
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles 
FOR SELECT 
USING (is_public_profile = true);

-- The owner policy remains the same
-- Users can still view their complete profile including sensitive data