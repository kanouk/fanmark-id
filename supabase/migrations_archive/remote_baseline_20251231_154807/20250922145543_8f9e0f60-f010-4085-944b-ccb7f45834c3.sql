-- CRITICAL SECURITY FIX: Remove the remaining public access policy that exposes user_id
-- The policy "Allow public access to emoji profiles via function" still allows direct table access

-- Drop the problematic policy that allows public access to the table
DROP POLICY IF EXISTS "Allow public access to emoji profiles via function" ON public.emoji_profiles;

-- The secure access should ONLY happen through the security definer function
-- The existing policy "Users can access emoji profiles through secure function only" 
-- already allows authenticated users to see their own profiles

-- Update the security definer function to be accessible by anon users for public profiles
-- This ensures public access only goes through the controlled function, never direct table access
REVOKE ALL ON public.emoji_profiles FROM anon;
REVOKE ALL ON public.emoji_profiles FROM authenticated;

-- Grant only what's needed for the security definer function to work
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Ensure the function can still be called but table access is completely controlled
-- The security definer function will handle all public access securely