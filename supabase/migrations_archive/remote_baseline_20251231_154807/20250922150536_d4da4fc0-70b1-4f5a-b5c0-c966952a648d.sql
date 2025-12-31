-- Fix emoji_profiles table permissions for authenticated users
-- Ensure authenticated users have all necessary permissions for their own profiles

-- Grant all necessary permissions to authenticated users for emoji_profiles table
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emoji_profiles TO authenticated;

-- Verify that the functions can still be called by anonymous users for public access
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_emoji_profile(uuid) TO anon;