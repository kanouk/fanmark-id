-- Disable all availability rules to make all fanmarks free
UPDATE public.fanmark_availability_rules 
SET is_available = false 
WHERE is_available = true;