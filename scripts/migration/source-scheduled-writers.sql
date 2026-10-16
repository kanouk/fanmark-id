-- Operational metadata only: no application/Auth rows or raw commands.
-- Command mentions do not prove execution or rule out indirect/external callers.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT jsonb_build_object(
  'observed_at', statement_timestamp(),
  'session_timezone', current_setting('TimeZone'),
  'cron_timezone', current_setting('cron.timezone', true),
  'raw_commands_excluded', true,
  'jobs', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'job_id', jobid,
      'schedule', schedule,
      'active', active,
      'command_sha256', encode(sha256(convert_to(command, 'UTF8')), 'hex'),
      'command_mentions', array_remove(ARRAY[
        CASE WHEN strpos(command, 'check-expired-licenses') > 0 THEN 'check-expired-licenses' END,
        CASE WHEN strpos(command, 'manual-expire-grace-licenses') > 0 THEN 'manual-expire-grace-licenses' END,
        CASE WHEN strpos(command, 'process-notification-events') > 0 THEN 'process-notification-events' END,
        CASE WHEN strpos(command, 'archive_old_notifications') > 0 THEN 'archive_old_notifications' END
      ], NULL)
    ) ORDER BY jobid), '[]'::jsonb)
    FROM cron.job
  )
);
COMMIT;
