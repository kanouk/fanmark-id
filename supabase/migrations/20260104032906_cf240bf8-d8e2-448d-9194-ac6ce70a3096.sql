-- Update stripe_mode to live for production
UPDATE public.system_settings 
SET setting_value = 'live', updated_at = now()
WHERE setting_key = 'stripe_mode';