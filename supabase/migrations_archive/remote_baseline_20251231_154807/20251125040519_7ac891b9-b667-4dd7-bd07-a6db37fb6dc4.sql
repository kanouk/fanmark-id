-- Phase 2: Add Stripe Price ID columns to fanmark_tier_extension_prices
ALTER TABLE fanmark_tier_extension_prices
ADD COLUMN IF NOT EXISTS stripe_price_id_test TEXT,
ADD COLUMN IF NOT EXISTS stripe_price_id_live TEXT;

COMMENT ON COLUMN fanmark_tier_extension_prices.stripe_price_id_test IS 'Stripe Price ID for test mode (e.g., price_xxxxx)';
COMMENT ON COLUMN fanmark_tier_extension_prices.stripe_price_id_live IS 'Stripe Price ID for live/production mode (e.g., price_yyyyy)';

-- Add stripe_mode to system_settings if not exists
INSERT INTO system_settings (setting_key, setting_value, is_public, description)
VALUES (
  'stripe_mode',
  'test',
  true,
  'Current Stripe environment mode: test or live'
)
ON CONFLICT (setting_key) DO NOTHING;