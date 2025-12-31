-- Security Fix: Restrict public access to fanmark_profiles table
-- Remove overly permissive public access policy and create secure public view

-- Drop the existing overly permissive public access policy
DROP POLICY IF EXISTS "Public can view public fanmark profiles" ON public.fanmark_profiles;

-- Create a secure view for public profile access that excludes sensitive data
CREATE OR REPLACE VIEW public.public_fanmark_profiles AS
SELECT 
  fp.fanmark_id,
  fp.display_name,
  fp.bio,
  fp.social_links,
  fp.theme_settings,
  fp.created_at,
  fp.updated_at
FROM public.fanmark_profiles fp
WHERE fp.is_public = true;

-- Grant public read access to the secure view only
GRANT SELECT ON public.public_fanmark_profiles TO anon, authenticated;

-- Create a more restrictive RLS policy for the main table
CREATE POLICY "Users can view their own fanmark profiles" 
ON public.fanmark_profiles 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own fanmark profiles" 
ON public.fanmark_profiles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own fanmark profiles" 
ON public.fanmark_profiles 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own fanmark profiles" 
ON public.fanmark_profiles 
FOR DELETE 
USING (auth.uid() = user_id);

-- Drop the existing function first to avoid signature conflicts
DROP FUNCTION IF EXISTS public.get_public_emoji_profile(uuid);

-- Create the updated secure function that excludes user_id and id
CREATE OR REPLACE FUNCTION public.get_public_emoji_profile(profile_fanmark_id uuid)
RETURNS TABLE(
  fanmark_id uuid, 
  display_name text, 
  bio text, 
  social_links jsonb, 
  theme_settings jsonb, 
  created_at timestamp with time zone, 
  updated_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    ppf.fanmark_id,
    ppf.display_name,
    ppf.bio,
    ppf.social_links,
    ppf.theme_settings,
    ppf.created_at,
    ppf.updated_at
  FROM public.public_fanmark_profiles ppf
  WHERE ppf.fanmark_id = profile_fanmark_id
  ORDER BY ppf.updated_at DESC
  LIMIT 1;
$$;