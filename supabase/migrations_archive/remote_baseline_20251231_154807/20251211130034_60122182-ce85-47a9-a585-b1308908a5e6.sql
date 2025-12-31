-- Update Tier B (tier_level=2) prices
UPDATE fanmark_tier_extension_prices 
SET price_yen = 500, stripe_price_id = 'price_1Sd9RdJ9Sc4J9g7E7wHRfLb7', updated_at = now()
WHERE tier_level = 2 AND months = 1;

UPDATE fanmark_tier_extension_prices 
SET price_yen = 1000, stripe_price_id = 'price_1Sd9ReJ9Sc4J9g7EYHWy2FQ3', updated_at = now()
WHERE tier_level = 2 AND months = 2;

UPDATE fanmark_tier_extension_prices 
SET price_yen = 1500, stripe_price_id = 'price_1Sd9RfJ9Sc4J9g7ED7Wu1mGr', updated_at = now()
WHERE tier_level = 2 AND months = 3;

UPDATE fanmark_tier_extension_prices 
SET price_yen = 3000, stripe_price_id = 'price_1Sd9RgJ9Sc4J9g7EUJL9wAQK', updated_at = now()
WHERE tier_level = 2 AND months = 6;

-- Update Tier A (tier_level=3) prices
UPDATE fanmark_tier_extension_prices 
SET price_yen = 1000, stripe_price_id = 'price_1Sd9RhJ9Sc4J9g7EkHq1oQ6k', updated_at = now()
WHERE tier_level = 3 AND months = 1;

UPDATE fanmark_tier_extension_prices 
SET price_yen = 2000, stripe_price_id = 'price_1Sd9RiJ9Sc4J9g7EiWsx6lyT', updated_at = now()
WHERE tier_level = 3 AND months = 2;

UPDATE fanmark_tier_extension_prices 
SET price_yen = 3000, stripe_price_id = 'price_1Sd9RjJ9Sc4J9g7Eb77lK5Np', updated_at = now()
WHERE tier_level = 3 AND months = 3;

UPDATE fanmark_tier_extension_prices 
SET price_yen = 5000, stripe_price_id = 'price_1Sd9RkJ9Sc4J9g7EQYqNey7N', updated_at = now()
WHERE tier_level = 3 AND months = 6;

-- Update Tier S (tier_level=4) prices
UPDATE fanmark_tier_extension_prices 
SET price_yen = 2000, stripe_price_id = 'price_1Sd9RlJ9Sc4J9g7EKKoq1SsU', updated_at = now()
WHERE tier_level = 4 AND months = 1;

UPDATE fanmark_tier_extension_prices 
SET price_yen = 4000, stripe_price_id = 'price_1Sd9RmJ9Sc4J9g7Et5Tzlng0', updated_at = now()
WHERE tier_level = 4 AND months = 2;

UPDATE fanmark_tier_extension_prices 
SET price_yen = 6000, stripe_price_id = 'price_1Sd9RnJ9Sc4J9g7EdrwkytqE', updated_at = now()
WHERE tier_level = 4 AND months = 3;

UPDATE fanmark_tier_extension_prices 
SET price_yen = 10000, stripe_price_id = 'price_1Sd9RnJ9Sc4J9g7E56MpeeXI', updated_at = now()
WHERE tier_level = 4 AND months = 6;