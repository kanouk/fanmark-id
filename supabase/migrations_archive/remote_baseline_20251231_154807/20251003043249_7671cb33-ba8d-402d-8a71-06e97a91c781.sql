-- Remove existing cron job
SELECT cron.unschedule('check-expired-licenses-daily');

-- Reschedule cron job to run daily at midnight UTC
SELECT cron.schedule(
  'check-expired-licenses-daily',
  '0 0 * * *', -- Every day at midnight UTC
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