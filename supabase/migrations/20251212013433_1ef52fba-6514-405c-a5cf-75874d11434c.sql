-- Rename setting key for consistency: max_fanmarks_per_user -> free_fanmarks_limit
UPDATE public.system_settings 
SET setting_key = 'free_fanmarks_limit', updated_at = now()
WHERE setting_key = 'max_fanmarks_per_user';