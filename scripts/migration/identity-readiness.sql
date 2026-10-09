-- Deferred real-user-data stage only. Run against the verified source project
-- with an authorized read role and keep output private. Returns aggregate
-- blockers, never IDs, owners, emoji arrays or display values. No data changes.
-- NULL/empty arrays are not repaired, deduplicated, truncated or skipped.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
WITH source_rows(relation, owner_key, ids, display_key) AS MATERIALIZED (
-- BEGIN SOURCE ROWS
  SELECT 'fanmarks'::text, NULL::text, normalized_emoji_ids, normalized_emoji
  FROM public.fanmarks
  UNION ALL
  SELECT 'fanmark_discoveries', NULL::text, normalized_emoji_ids, NULL::text
  FROM public.fanmark_discoveries
  UNION ALL
  SELECT 'fanmark_favorites', user_id::text, normalized_emoji_ids, NULL::text
  FROM public.fanmark_favorites
  UNION ALL
  SELECT 'fanmark_events', NULL::text, normalized_emoji_ids, NULL::text
  FROM public.fanmark_events
-- END SOURCE ROWS
), classified AS MATERIALIZED (
  SELECT relation, owner_key, ids, display_key,
    CASE
      WHEN ids IS NULL THEN 'null_array'
      WHEN cardinality(ids) = 0 THEN 'empty_array'
      WHEN array_ndims(ids) <> 1 THEN 'unsupported_dimensions'
      WHEN array_lower(ids, 1) <> 1 THEN 'unsupported_lower_bound'
      WHEN EXISTS (SELECT 1 FROM unnest(ids) AS element WHERE element IS NULL)
        THEN 'null_element'
      ELSE 'admitted'
    END AS disposition
  FROM source_rows
), identity_conflicts AS (
  -- UUID->JSON preserves canonical case, order and repetitions. Owner is part
  -- of the favorite key only. Do not group by source MD5 or remove NULLs.
  SELECT relation, count(*) AS affected_rows
  FROM classified WHERE disposition = 'admitted' AND relation <> 'fanmark_events'
  GROUP BY relation, owner_key, to_jsonb(ids)
  HAVING count(*) > 1
), display_conflicts AS (
  -- Additional target fanmarks.normalized_emoji uniqueness is independent
  -- of the UUID identity. Check all rows, including shape-blocked ones.
  SELECT count(*) AS affected_rows
  FROM source_rows WHERE relation = 'fanmarks' AND display_key IS NOT NULL
  GROUP BY display_key HAVING count(*) > 1
), relations(relation) AS (
  VALUES ('fanmarks'), ('fanmark_discoveries'), ('fanmark_favorites'), ('fanmark_events')
), counts AS (
  SELECT r.relation,
    (SELECT count(*) FROM classified c WHERE c.relation = r.relation) AS total_rows,
    (SELECT count(*) FROM classified c WHERE c.relation = r.relation AND c.disposition = 'admitted') AS admitted_rows,
    (SELECT count(*) FROM classified c WHERE c.relation = r.relation AND c.disposition = 'null_array') AS null_arrays,
    (SELECT count(*) FROM classified c WHERE c.relation = r.relation AND c.disposition = 'empty_array') AS empty_arrays,
    (SELECT count(*) FROM classified c WHERE c.relation = r.relation AND c.disposition = 'unsupported_dimensions') AS unsupported_dimensions,
    (SELECT count(*) FROM classified c WHERE c.relation = r.relation AND c.disposition = 'unsupported_lower_bound') AS unsupported_lower_bounds,
    (SELECT count(*) FROM classified c WHERE c.relation = r.relation AND c.disposition = 'null_element') AS null_element_arrays,
    (SELECT count(*) FROM identity_conflicts c WHERE c.relation = r.relation) AS canonical_duplicate_groups,
    (SELECT coalesce(sum(c.affected_rows), 0) FROM identity_conflicts c WHERE c.relation = r.relation) AS canonical_duplicate_rows,
    CASE WHEN r.relation = 'fanmarks' THEN (SELECT count(*) FROM display_conflicts) ELSE 0 END AS display_duplicate_groups,
    CASE WHEN r.relation = 'fanmarks' THEN (SELECT coalesce(sum(affected_rows), 0) FROM display_conflicts) ELSE 0 END AS display_duplicate_rows
  FROM relations r
)
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'observedAt', clock_timestamp(),
  'scope', 'deferred source identity import preflight, aggregate counts only',
  'tables', (SELECT jsonb_agg(to_jsonb(c) ORDER BY relation) FROM counts c),
  'readyForIdentityImport', NOT EXISTS (
    SELECT 1 FROM counts WHERE total_rows <> admitted_rows
      OR canonical_duplicate_groups <> 0 OR display_duplicate_groups <> 0
  )
) AS identity_readiness;
COMMIT;
