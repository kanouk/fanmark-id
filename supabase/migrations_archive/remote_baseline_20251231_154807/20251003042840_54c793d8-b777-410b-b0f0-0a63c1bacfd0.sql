-- Enable required extensions for cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Update existing grace licenses that have exceeded grace period to expired
DO $$
DECLARE
  grace_period_days_value INTEGER;
  grace_period_ms BIGINT;
BEGIN
  -- Get grace period setting
  SELECT setting_value::INTEGER INTO grace_period_days_value
  FROM public.system_settings
  WHERE setting_key = 'grace_period_days';
  
  -- Default to 7 days if not set
  IF grace_period_days_value IS NULL THEN
    grace_period_days_value := 7;
  END IF;
  
  grace_period_ms := grace_period_days_value * 24 * 60 * 60 * 1000;
  
  -- Update licenses that are in grace status and have exceeded grace period
  WITH expired_licenses AS (
    SELECT fl.id, fl.fanmark_id
    FROM public.fanmark_licenses fl
    WHERE fl.status = 'grace'
    AND EXTRACT(EPOCH FROM (now() - fl.license_end)) * 1000 > grace_period_ms
  )
  UPDATE public.fanmark_licenses fl
  SET 
    status = 'expired',
    excluded_at = now(),
    updated_at = now()
  FROM expired_licenses el
  WHERE fl.id = el.id;
  
  -- Delete associated configurations for expired licenses
  DELETE FROM public.fanmark_basic_configs
  WHERE license_id IN (
    SELECT id FROM public.fanmark_licenses WHERE status = 'expired' AND excluded_at IS NOT NULL
  );
  
  DELETE FROM public.fanmark_redirect_configs
  WHERE license_id IN (
    SELECT id FROM public.fanmark_licenses WHERE status = 'expired' AND excluded_at IS NOT NULL
  );
  
  DELETE FROM public.fanmark_messageboard_configs
  WHERE license_id IN (
    SELECT id FROM public.fanmark_licenses WHERE status = 'expired' AND excluded_at IS NOT NULL
  );
  
  DELETE FROM public.fanmark_password_configs
  WHERE license_id IN (
    SELECT id FROM public.fanmark_licenses WHERE status = 'expired' AND excluded_at IS NOT NULL
  );
END $$;

-- Schedule cron job to run check-expired-licenses function daily at 2 AM UTC
SELECT cron.schedule(
  'check-expired-licenses-daily',
  '0 2 * * *', -- Every day at 2:00 AM UTC
  $$
  SELECT
    net.http_post(
      url := 'https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/check-expired-licenses',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o'
      ),
      body := jsonb_build_object('scheduled', true)
    ) as request_id;
  $$
);