-- Restore necessary permissions for authenticated users to manage their own emoji profiles
-- while keeping public access completely locked down

-- Grant SELECT, INSERT, UPDATE permissions to authenticated users only for RLS policies to work
GRANT SELECT, INSERT, UPDATE ON public.emoji_profiles TO authenticated;

-- Verify that only authenticated users can access their own profiles
-- No public/anon access to the table directly - only through the security definer function