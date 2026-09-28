BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT
  count(*) FILTER (
    WHERE command LIKE '%manual-expire-grace-licenses%'
  ) AS matching_jobs,
  count(*) FILTER (
    WHERE active AND command LIKE '%manual-expire-grace-licenses%'
  ) AS active_matching_jobs
FROM cron.job;

ROLLBACK;
