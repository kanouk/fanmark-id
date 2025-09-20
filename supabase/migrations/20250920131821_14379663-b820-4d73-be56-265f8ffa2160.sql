-- Insert a sample invitation code for testing
INSERT INTO invitation_codes (
  code,
  is_active,
  max_uses,
  used_count,
  special_perks,
  expires_at
) VALUES (
  'WELCOME2025',
  true,
  100,
  0,
  '{"premium_trial": true, "bonus_emojis": 5}',
  NOW() + INTERVAL '30 days'
);

-- Enable invitation mode
INSERT INTO system_settings (setting_key, setting_value, is_public, description)
VALUES ('invitation_mode', 'true', true, 'Controls whether invitation codes are required for registration')
ON CONFLICT (setting_key) 
DO UPDATE SET 
  setting_value = 'true',
  updated_at = NOW();