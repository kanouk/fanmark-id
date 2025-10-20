-- ========================================
-- Cron Job Cleanup Migration
-- ========================================
-- 目的: マイグレーション内にハードコードされたCronジョブを削除し、
--       Supabase CLI ベースのスケジューリングに移行する
-- 
-- 実行日: 2025-10-20
-- 影響: 既存のpg_cronジョブをすべて削除（ダッシュボード/CLIで再設定が必要）
-- ========================================

-- 既存のCronジョブを安全に削除
SELECT cron.unschedule('check-expired-licenses-daily') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'check-expired-licenses-daily'
);

SELECT cron.unschedule('process-notification-events-every-minute') 
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-notification-events-every-minute'
);

-- ========================================
-- 注意事項
-- ========================================
-- 1. このマイグレーション実行後、Cronジョブは停止します
-- 2. 以下のいずれかの方法で再設定してください：
--    A) Supabase CLI: supabase functions schedule (推奨)
--       supabase functions schedule check-expired-licenses "0 15 * * *"
--       supabase functions schedule process-notification-events "* * * * *"
--    B) Supabase Dashboard: Database > Cron Jobs
-- 
-- 3. pg_cron/pg_net拡張機能は削除しません（他用途で使用可能性あり）
-- 
-- 4. 既存のJWTトークンは漏洩している可能性があるため、
--    再設定後にSupabaseダッシュボードでローテーションしてください
--    https://app.supabase.com/project/ppqgtbjykitqtiaisyji/settings/api
-- ========================================