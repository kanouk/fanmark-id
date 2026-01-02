-- Add live Stripe Price IDs to system_settings
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public)
VALUES 
  ('creator_stripe_price_id_live', 'price_1Sl5ULJk0VCfiKUpAN5l361v', 'Creator Plan Stripe Price ID (Live)', true),
  ('business_stripe_price_id_live', 'price_1Sl5UNJk0VCfiKUp41qPfiSf', 'Business Plan Stripe Price ID (Live)', true),
  ('max_stripe_price_id_live', 'price_1Sl5UPJk0VCfiKUpLDe65uLL', 'Max Plan Stripe Price ID (Live)', true)
ON CONFLICT (setting_key) DO UPDATE
SET 
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public;

-- Add stripe_price_id_live column to fanmark_tier_extension_prices
ALTER TABLE fanmark_tier_extension_prices
ADD COLUMN IF NOT EXISTS stripe_price_id_live text;

COMMENT ON COLUMN fanmark_tier_extension_prices.stripe_price_id_live IS 'Stripe Price ID for live/production mode';

-- Update Tier B (tier_level=2) live prices
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5URJk0VCfiKUpfLVp58oB' WHERE tier_level = 2 AND months = 1;
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UTJk0VCfiKUpsb1byM5v' WHERE tier_level = 2 AND months = 2;
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UUJk0VCfiKUpBZdRi0vC' WHERE tier_level = 2 AND months = 3;
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UWJk0VCfiKUpX3Q7GMfL' WHERE tier_level = 2 AND months = 6;

-- Update Tier A (tier_level=3) live prices
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UXJk0VCfiKUpH51JexDX' WHERE tier_level = 3 AND months = 1;
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UZJk0VCfiKUpW9qR5TOx' WHERE tier_level = 3 AND months = 2;
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UaJk0VCfiKUpF4B8Dpnt' WHERE tier_level = 3 AND months = 3;
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UcJk0VCfiKUpGcol8cba' WHERE tier_level = 3 AND months = 6;

-- Update Tier S (tier_level=4) live prices
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UdJk0VCfiKUpm3IObmlH' WHERE tier_level = 4 AND months = 1;
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UfJk0VCfiKUpvxB4Y7Ir' WHERE tier_level = 4 AND months = 2;
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UhJk0VCfiKUppzWFMvNS' WHERE tier_level = 4 AND months = 3;
UPDATE fanmark_tier_extension_prices SET stripe_price_id_live = 'price_1Sl5UiJk0VCfiKUp7n91bbKH' WHERE tier_level = 4 AND months = 6;