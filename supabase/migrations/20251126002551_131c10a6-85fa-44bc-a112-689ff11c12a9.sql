-- Migrate fanmark_tier_extension_prices to single stripe_price_id column
-- Add new column
ALTER TABLE fanmark_tier_extension_prices
ADD COLUMN stripe_price_id text;

-- Migrate existing test price IDs to the new column
UPDATE fanmark_tier_extension_prices
SET stripe_price_id = stripe_price_id_test
WHERE stripe_price_id_test IS NOT NULL;

-- Drop old columns
ALTER TABLE fanmark_tier_extension_prices
DROP COLUMN stripe_price_id_test,
DROP COLUMN stripe_price_id_live;