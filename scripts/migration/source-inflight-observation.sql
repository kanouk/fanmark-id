-- Read-only observations, not a source-drain verdict. pg_stat_activity is live
-- statistics, and pg_net removes requests from its queue before HTTP completes.
-- Do not select query text, queued request bodies, URLs, headers or responses.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT jsonb_build_object(
  'format', 'fanmark-source-inflight-observation-v1',
  'observed_at', clock_timestamp(),
  'role', current_user,
  'transaction_read_only', current_setting('transaction_read_only'),
  'other_client_transactions', (
    SELECT count(*) FROM pg_stat_activity
    WHERE pid <> pg_backend_pid() AND backend_type = 'client backend' AND xact_start IS NOT NULL
  ),
  'other_assigned_write_transactions', (
    SELECT count(*) FROM pg_stat_activity
    WHERE pid <> pg_backend_pid() AND backend_xid IS NOT NULL
  ),
  'prepared_transactions', (SELECT count(*) FROM pg_prepared_xacts),
  'cron_unfinished', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'job_id', jobid, 'run_id', runid, 'status', status,
      'start_time', start_time, 'end_time', end_time
    ) ORDER BY runid), '[]'::jsonb)
    FROM cron.job_run_details WHERE status IS NULL OR status NOT IN ('succeeded', 'failed')
  ),
  'queued_http_requests', (SELECT count(*) FROM net.http_request_queue),
  'pg_net_inflight_known', false,
  'source_drain_verified', false,
  'source_writes', 0
);
COMMIT;
