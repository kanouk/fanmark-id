-- Explicitly allowlisted public registration setting exported from Supabase on 2026-09-26.
-- system_settings is never copied wholesale; this row contains no user or secret data.
INSERT INTO system_settings
  (setting_key, setting_value, description, is_public, created_at, updated_at)
VALUES
  ('max_emoji_characters', '5', 'ファンマークの最大文字数', 1,
   '2025-09-22 09:55:11.192196+00', '2025-09-22 09:55:11.192196+00')
ON CONFLICT (setting_key) DO NOTHING;
