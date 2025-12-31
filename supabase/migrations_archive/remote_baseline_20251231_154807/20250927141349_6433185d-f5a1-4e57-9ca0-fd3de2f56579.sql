-- Update grace period to 1 day for cooldown processing
UPDATE system_settings 
SET setting_value = '1', updated_at = now()
WHERE setting_key = 'grace_period_days';

-- Enable pg_cron extension for scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a cron job to run check-expired-licenses daily at 0:00 JST
SELECT cron.schedule(
  'check-expired-licenses-daily',
  '0 15 * * *', -- 15:00 UTC = 0:00 JST (considering JST is UTC+9)
  $$
  SELECT
    net.http_post(
        url:='https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/check-expired-licenses',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o"}'::jsonb,
        body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);