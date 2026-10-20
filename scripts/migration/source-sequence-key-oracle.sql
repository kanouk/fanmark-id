-- Literal-only expressions from source seq_key (fbe91b15), including the
-- PL/pgSQL IF's NULL condition behavior. No stored application function/row.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
WITH cases(label, ids) AS (VALUES
  ('ordered', ARRAY['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']::uuid[]),
  ('reversed', ARRAY['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::uuid[]),
  ('uppercase', ARRAY['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA','BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB']::uuid[]),
  ('null_element', ARRAY['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NULL,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']::uuid[]),
  ('all_null', ARRAY[NULL]::uuid[]),
  ('empty', ARRAY[]::uuid[]),
  ('sql_null', NULL::uuid[])
), expressions AS (
  SELECT label, ids, array_length(ids, 1) AS source_length,
    array_to_string(ids, ',') AS source_string,
    COALESCE(ids IS NULL OR array_length(ids, 1) = 0, false) AS guard_would_raise,
    CASE WHEN ids IS NULL THEN NULL ELSE md5(array_to_string(ids, ','))::uuid END AS source_key
  FROM cases
)
SELECT jsonb_build_object('observed_at', clock_timestamp(), 'cases',
  (SELECT jsonb_agg(jsonb_build_object('label', label, 'ids', ids,
    'sourceLength', source_length, 'sourceString', source_string,
    'strictNullSkipsBody', ids IS NULL, 'guardWouldRaiseIfBodyRan', guard_would_raise,
    'sourceKey', source_key) ORDER BY label) FROM expressions)) AS oracle;
COMMIT;
