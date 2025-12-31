-- Add Stripe configuration settings to system_settings table
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public)
VALUES 
  ('creator_stripe_price_id', 'price_1SRXrAJ9Sc4J9g7EG9hEt1td', 'Creator Plan Stripe Price ID', true),
  ('business_stripe_price_id', 'price_1SRXrXJ9Sc4J9g7Ed64bgbBY', 'Business Plan Stripe Price ID', true),
  ('stripe_mode', 'test', 'Current Stripe mode (test or live)', true)
ON CONFLICT (setting_key) DO UPDATE
SET 
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public;