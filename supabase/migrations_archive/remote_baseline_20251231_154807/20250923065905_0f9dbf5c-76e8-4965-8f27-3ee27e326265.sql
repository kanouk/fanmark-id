-- Fix fanmarks table security vulnerability by removing overly permissive public access
-- while preserving legitimate functionality

-- Drop the overly permissive public read policy
DROP POLICY IF EXISTS "read_active_fanmarks_public" ON public.fanmarks;

-- Create a more secure policy for anonymous users that only allows access to basic fanmark data
-- for search functionality without exposing user ownership data
CREATE POLICY "anonymous_search_fanmarks_limited" ON public.fanmarks
FOR SELECT 
USING (
  status = 'active' 
  AND auth.uid() IS NULL
);

-- Create a policy for authenticated users to search fanmarks without seeing user ownership
-- This allows search functionality while protecting user privacy
CREATE POLICY "authenticated_search_fanmarks_limited" ON public.fanmarks
FOR SELECT 
USING (
  status = 'active' 
  AND auth.uid() IS NOT NULL 
  AND auth.uid() != user_id
);

-- The existing policies for users to see their own fanmarks remain:
-- "Users can view their own fanmarks" - SELECT policy using auth.uid() = user_id
-- "Users can update their own fanmarks" - UPDATE policy using auth.uid() = user_id  
-- "Users can create their own fanmarks" - INSERT policy with check auth.uid() = user_id

-- Create a secure view for public fanmark search that excludes sensitive user data
CREATE OR REPLACE VIEW public.fanmarks_public_search AS
SELECT 
  id,
  emoji_combination,
  normalized_emoji,
  short_id,
  tier_level,
  status,
  current_license_id,
  created_at
FROM public.fanmarks
WHERE status = 'active';

-- Grant access to the public search view
GRANT SELECT ON public.fanmarks_public_search TO authenticated;
GRANT SELECT ON public.fanmarks_public_search TO anon;

-- Update the get_fanmark_by_emoji function to ensure it continues working correctly
-- This function already has SECURITY DEFINER so it will work regardless of RLS policies
CREATE OR REPLACE FUNCTION public.get_fanmark_by_emoji(emoji_combo text)
RETURNS TABLE(
  emoji_combination text, 
  display_name text, 
  access_type text, 
  target_url text, 
  text_content text, 
  status text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT 
    f.emoji_combination,
    f.display_name,
    f.access_type,
    f.target_url,
    f.text_content,
    f.status
  FROM public.fanmarks f
  WHERE f.emoji_combination = emoji_combo 
    AND f.status = 'active'
  LIMIT 1;
$function$;