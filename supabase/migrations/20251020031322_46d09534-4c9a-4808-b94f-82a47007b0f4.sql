-- Phase 5: Initial notification templates and rules

-- Insert notification templates (Japanese and English)

-- Template: license_grace_started (Japanese)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  gen_random_uuid(),
  1,
  'ja',
  'in_app',
  'ライセンス猶予期間開始',
  'ファンマーク「{{fanmark_name}}」のライセンスが猶予期間に入りました。{{grace_expires_at}}までに更新してください。',
  'ライセンス更新が必要です',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "license_end", "grace_expires_at"]}'::jsonb,
  true
);

-- Template: license_grace_started (English)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND body LIKE '%猶予期間%' LIMIT 1),
  1,
  'en',
  'in_app',
  'License Grace Period Started',
  'Your fanmark "{{fanmark_name}}" license has entered the grace period. Please renew by {{grace_expires_at}}.',
  'License renewal required',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "license_end", "grace_expires_at"]}'::jsonb,
  true
);

-- Template: license_expired (Japanese)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  gen_random_uuid(),
  1,
  'ja',
  'in_app',
  'ライセンス失効',
  'ファンマーク「{{fanmark_name}}」のライセンスが失効しました。再度取得することができます。',
  'ライセンスが失効しました',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "expired_at", "license_end"]}'::jsonb,
  true
);

-- Template: license_expired (English)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND body LIKE '%失効しました%' LIMIT 1),
  1,
  'en',
  'in_app',
  'License Expired',
  'Your fanmark "{{fanmark_name}}" license has expired. You can acquire it again.',
  'License has expired',
  '{"required": ["user_id", "fanmark_id", "fanmark_name", "expired_at", "license_end"]}'::jsonb,
  true
);

-- Template: favorite_fanmark_available (Japanese)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  gen_random_uuid(),
  1,
  'ja',
  'in_app',
  'お気に入りファンマークが利用可能',
  'お気に入りのファンマーク「{{fanmark_name}}」が再び利用可能になりました。',
  '取得チャンスです',
  '{"required": ["user_id", "fanmark_id", "fanmark_name"]}'::jsonb,
  true
);

-- Template: favorite_fanmark_available (English)
INSERT INTO public.notification_templates (template_id, version, language, channel, title, body, summary, payload_schema, is_active)
VALUES (
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND body LIKE '%再び利用可能%' LIMIT 1),
  1,
  'en',
  'in_app',
  'Favorite Fanmark Available',
  'Your favorite fanmark "{{fanmark_name}}" is now available again.',
  'Acquisition opportunity',
  '{"required": ["user_id", "fanmark_id", "fanmark_name"]}'::jsonb,
  true
);

-- Insert notification rules

-- Rule: license_grace_started -> in_app notification
INSERT INTO public.notification_rules (
  event_type,
  channel,
  template_id,
  template_version,
  priority,
  delay_seconds,
  enabled,
  max_per_user,
  cooldown_window_seconds
)
VALUES (
  'license_grace_started',
  'in_app',
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND body LIKE '%猶予期間%' LIMIT 1),
  1,
  8,
  0,
  true,
  NULL,
  NULL
);

-- Rule: license_expired -> in_app notification
INSERT INTO public.notification_rules (
  event_type,
  channel,
  template_id,
  template_version,
  priority,
  delay_seconds,
  enabled,
  max_per_user,
  cooldown_window_seconds
)
VALUES (
  'license_expired',
  'in_app',
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND body LIKE '%失効しました%' LIMIT 1),
  1,
  7,
  0,
  true,
  NULL,
  NULL
);

-- Rule: favorite_fanmark_available -> in_app notification
INSERT INTO public.notification_rules (
  event_type,
  channel,
  template_id,
  template_version,
  priority,
  delay_seconds,
  enabled,
  max_per_user,
  cooldown_window_seconds
)
VALUES (
  'favorite_fanmark_available',
  'in_app',
  (SELECT template_id FROM public.notification_templates WHERE language = 'ja' AND body LIKE '%再び利用可能%' LIMIT 1),
  1,
  6,
  0,
  true,
  1,
  86400
);