-- Set the view to use security_invoker instead of security_definer
-- This ensures the view uses the querying user's permissions rather than the creator's
ALTER VIEW public.recent_active_fanmarks
SET (security_invoker = true);