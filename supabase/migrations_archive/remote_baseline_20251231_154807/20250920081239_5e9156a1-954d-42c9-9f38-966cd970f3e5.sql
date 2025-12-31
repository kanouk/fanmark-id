-- Fix security issue: Add RLS policies to public_profiles view
-- The public_profiles view should be read-only and accessible to everyone
-- but should not allow any modifications

-- Enable RLS on the public_profiles view
ALTER TABLE public.public_profiles ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view public profiles (read-only access)
CREATE POLICY "Anyone can view public profiles" 
ON public.public_profiles 
FOR SELECT 
USING (true);

-- Explicitly deny all modification operations on the view
-- This ensures the view remains read-only
CREATE POLICY "No modifications allowed on public profiles view" 
ON public.public_profiles 
FOR ALL
USING (false);