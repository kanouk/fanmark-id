-- Phase 7: Cron設定 - 通知イベント処理を毎分実行

-- pg_cron拡張機能を有効化
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- pg_net拡張機能を有効化（HTTP呼び出しに必要）
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 既存のCronジョブを削除（存在する場合）
SELECT cron.unschedule('process-notification-events-every-minute') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-notification-events-every-minute'
);

-- 通知イベント処理を毎分実行するCronジョブを作成
SELECT cron.schedule(
  'process-notification-events-every-minute',
  '* * * * *', -- 毎分実行
  $$
  SELECT
    net.http_post(
        url:='https://ppqgtbjykitqtiaisyji.supabase.co/functions/v1/process-notification-events',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcWd0Ymp5a2l0cXRpYWlzeWppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyOTY4NjcsImV4cCI6MjA3Mzg3Mjg2N30.vWkjhMDzdKRjMsIkHLdtGgYlktHg9s6PpY8rj1Qi06o"}'::jsonb,
        body:=concat('{"timestamp": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);
