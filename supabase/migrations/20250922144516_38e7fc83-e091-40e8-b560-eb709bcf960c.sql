-- Fix security linter issues

-- Issue 1: Add a policy for anon users to use the public function
-- This allows the public function to work for unauthenticated users
CREATE POLICY "Allow public access to emoji profiles via function" 
ON public.emoji_profiles 
FOR SELECT 
TO anon
USING (
  -- This policy specifically allows the security definer function to access public profiles
  -- The function itself controls the access logic
  is_public = true
);

-- Issue 2: Enable leaked password protection in auth settings
-- Note: This requires updating auth configuration, which we'll document for the user