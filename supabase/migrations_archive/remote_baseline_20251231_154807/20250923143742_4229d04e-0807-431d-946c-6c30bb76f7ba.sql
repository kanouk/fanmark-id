-- Update Free user fanmark limit from 10 to 3
UPDATE public.system_settings 
SET setting_value = '3', updated_at = now()
WHERE setting_key = 'max_fanmarks_per_user' AND is_public = true;