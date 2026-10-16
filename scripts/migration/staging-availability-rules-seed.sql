-- Non-user availability configuration exported from the linked Supabase project on 2026-09-26.
-- `price_usd` is stored as exact integer cents in the D1 target. The source
-- `created_by` administrator UUID is intentionally omitted and stays NULL.
INSERT INTO fanmark_availability_rules
  (id, rule_type, priority, rule_config, is_available, price_usd, description, created_at, updated_at, created_by)
VALUES
  ('16776bb0-dcbb-4470-81cf-c06229b4a1f9', 'specific_pattern', 1,
   '{"patterns":["🎄","🏢","💎"]}', 0, 9999, 'Specific reserved patterns',
   '2025-09-20 12:41:36.213871+00', '2025-09-22 05:56:21.796165+00', NULL),
  ('1b61f7cd-8662-40ce-99dc-f197195dacd2', 'duplicate_pattern', 2,
   '{"enabled":true}', 0, 1999, 'Consecutive duplicate emojis',
   '2025-09-20 12:41:36.213871+00', '2025-09-22 05:56:21.796165+00', NULL),
  ('15a2f43a-0a93-4019-a2a2-cca5bad5ea24', 'prefix_pattern', 3,
   '{"prefixes":{"🎄":5.99,"🏢":29.99,"💎":19.99}}', 0, NULL, 'Prefix-based pricing',
   '2025-09-20 12:41:36.213871+00', '2025-09-22 05:56:21.796165+00', NULL),
  ('c0119428-348d-4fe6-9667-49e95a17211b', 'count_based', 4,
   '{"pricing":{"1":0.99,"2":4.99,"3":9.99,"4":19.99,"5":39.99}}', 0, NULL, 'Count-based default pricing',
   '2025-09-20 12:41:36.213871+00', '2025-09-22 05:56:21.796165+00', NULL)
ON CONFLICT (id) DO NOTHING;
