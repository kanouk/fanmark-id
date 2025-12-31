-- Drop the existing view
DROP VIEW IF EXISTS public.recent_active_fanmarks;

-- Recreate the view without SECURITY DEFINER
CREATE VIEW public.recent_active_fanmarks AS
SELECT 
  fl.id AS license_id,
  fl.fanmark_id,
  f.short_id AS fanmark_short_id,
  COALESCE(f.normalized_emoji, f.user_input_fanmark) AS display_emoji,
  fl.created_at AS license_created_at
FROM fanmark_licenses fl
JOIN fanmarks f ON f.id = fl.fanmark_id
WHERE fl.status = 'active';

-- Grant SELECT permission to authenticated users
GRANT SELECT ON public.recent_active_fanmarks TO authenticated;
GRANT SELECT ON public.recent_active_fanmarks TO anon;