-- Metadata aggregates only. Object paths, owners, file contents, and cron SQL
-- (which may contain credentials) are deliberately excluded. Keep output private.
BEGIN READ ONLY;
SELECT 'storage_buckets' AS category,
       coalesce(jsonb_agg(s), '[]'::jsonb)::text AS summary
FROM (
  SELECT b.id AS bucket, b.public, count(o.id) AS object_count,
         coalesce(sum(CASE WHEN o.metadata->>'size' ~ '^[0-9]+$'
           THEN (o.metadata->>'size')::bigint ELSE 0 END), 0) AS metadata_bytes,
         count(o.id) FILTER (
           WHERE coalesce(o.metadata->>'size', '') !~ '^[0-9]+$'
         ) AS missing_size
  FROM storage.buckets b
  LEFT JOIN storage.objects o ON o.bucket_id = b.id
  GROUP BY b.id, b.public
) s
UNION ALL
SELECT 'cron_jobs', coalesce(jsonb_agg(s), '[]'::jsonb)::text
FROM (
  SELECT jobname, schedule, active, md5(command) AS command_hash
  FROM cron.job ORDER BY jobname
) s;
COMMIT;
