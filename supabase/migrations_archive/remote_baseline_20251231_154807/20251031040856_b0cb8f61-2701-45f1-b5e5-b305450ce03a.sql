-- Fix cron job to include Authorization header
-- Drop existing job
SELECT cron.unschedule('check-expired-licenses-daily');

-- Recreate with proper Authorization header
SELECT cron.schedule(
  'check-expired-licenses-daily',
  '0 15 * * *', -- Daily at 15:00 UTC (00:00 JST)
  $$
  SELECT net.http_post(
    url := 'https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/check-expired-licenses',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o'
    ),
    body := jsonb_build_object('scheduled', true)
  );
  $$
);