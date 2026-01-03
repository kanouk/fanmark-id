-- Add maintenance mode settings to system_settings
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public)
VALUES
  ('maintenance_mode', 'false', 'Toggle maintenance mode for the public app', true),
  ('maintenance_message', '', 'Maintenance page message shown to users', true),
  ('maintenance_end_time', '', 'Scheduled maintenance end time (ISO 8601)', true)
ON CONFLICT (setting_key) DO UPDATE
SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public;
