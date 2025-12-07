-- =====================================================
-- Add access_type to analytics tables for access type breakdown
-- =====================================================

-- 1. Add access_type column to fanmark_access_logs
ALTER TABLE public.fanmark_access_logs
ADD COLUMN IF NOT EXISTS access_type text;

-- 2. Add access_type columns to fanmark_access_daily_stats for breakdown
ALTER TABLE public.fanmark_access_daily_stats
ADD COLUMN IF NOT EXISTS access_type_profile integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS access_type_redirect integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS access_type_text integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS access_type_inactive integer DEFAULT 0;

-- 3. Add index for access_type queries
CREATE INDEX IF NOT EXISTS idx_access_logs_access_type ON public.fanmark_access_logs(access_type);
CREATE INDEX IF NOT EXISTS idx_daily_stats_fanmark_date_type ON public.fanmark_access_daily_stats(fanmark_id, stat_date, access_type_profile, access_type_redirect, access_type_text, access_type_inactive);

-- 4. Add comment for documentation
COMMENT ON COLUMN public.fanmark_access_logs.access_type IS 'Access type at the time of access: profile, redirect, text, inactive';
COMMENT ON COLUMN public.fanmark_access_daily_stats.access_type_profile IS 'Daily count of profile access type';
COMMENT ON COLUMN public.fanmark_access_daily_stats.access_type_redirect IS 'Daily count of redirect access type';
COMMENT ON COLUMN public.fanmark_access_daily_stats.access_type_text IS 'Daily count of text (messageboard) access type';
COMMENT ON COLUMN public.fanmark_access_daily_stats.access_type_inactive IS 'Daily count of inactive access type';

