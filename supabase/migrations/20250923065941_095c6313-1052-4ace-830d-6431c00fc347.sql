-- Fix the security definer view issue by dropping it and using a regular view instead
-- The view wasn't needed since we have proper RLS policies

-- Drop the problematic security definer view
DROP VIEW IF EXISTS public.fanmarks_public_search;

-- We don't need a separate view since our RLS policies now properly control access
-- The search functionality will use the existing fanmarks table with the new restrictive policies:
-- 1. anonymous_search_fanmarks_limited - for anonymous users
-- 2. authenticated_search_fanmarks_limited - for authenticated users (excludes their own)
-- 3. Users can view their own fanmarks - for users to see their own data

-- The get_fanmark_by_emoji function remains for legitimate public access to fanmarks by URL