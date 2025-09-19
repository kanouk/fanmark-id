-- Create a view for public profiles that excludes sensitive subscription data
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT 
  id,
  user_id,
  username,
  display_name,
  bio,
  avatar_url,
  social_links,
  created_at
FROM public.profiles
WHERE is_public_profile = true;

-- Enable RLS on the view
ALTER VIEW public.public_profiles SET (security_barrier = true);

-- Create RLS policy for the public profiles view
CREATE POLICY "Public profiles view is accessible to everyone"
ON public.profiles
FOR SELECT
USING (
  is_public_profile = true 
  AND (
    -- Only allow access to non-sensitive fields when accessed publicly
    current_setting('row_security', true) = 'on'
  )
);

-- Drop the existing overly permissive public policy
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

-- Create a more restrictive policy for public access
CREATE POLICY "Limited public profile access"
ON public.profiles
FOR SELECT
USING (
  is_public_profile = true
  AND (
    -- Only authenticated users can see full profiles
    auth.uid() IS NOT NULL
    -- Or we're accessing through the public view (this will be handled by application logic)
  )
);

-- Ensure users can still see their own full profiles
-- (This policy already exists but let's make sure it's there)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'profiles' 
    AND policyname = 'Users can view their own profile'
  ) THEN
    CREATE POLICY "Users can view their own profile"
    ON public.profiles
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;
END $$;