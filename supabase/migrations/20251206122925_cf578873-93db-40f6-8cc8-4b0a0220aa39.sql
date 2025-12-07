-- Update max_fanmarks_limit to 500 for the max plan
UPDATE public.system_settings 
SET setting_value = '500', updated_at = now()
WHERE setting_key = 'max_fanmarks_limit';

-- Add max_pricing setting (10000 yen)
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public)
VALUES ('max_pricing', '10000', 'Monthly price for Max plan in JPY', true)
ON CONFLICT (setting_key) DO UPDATE SET setting_value = '10000', updated_at = now();

-- Add max_stripe_price_id setting
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public)
VALUES ('max_stripe_price_id', 'price_1SbKbmJ9Sc4J9g7E2SYcL67D', 'Stripe Price ID for Max plan', true)
ON CONFLICT (setting_key) DO UPDATE SET setting_value = 'price_1SbKbmJ9Sc4J9g7E2SYcL67D', updated_at = now();