-- Extend user_plan enum to include 'max' plan
ALTER TYPE user_plan ADD VALUE 'max';

-- Add creator and max plan fanmark limits to system settings
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public) VALUES
('creator_fanmarks_limit', '10', 'Maximum fanmarks allowed for creator plan users', true),
('max_fanmarks_limit', '50', 'Maximum fanmarks allowed for max plan users', true);