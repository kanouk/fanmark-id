-- Extend user_plan enum to include new plan types
ALTER TYPE user_plan ADD VALUE IF NOT EXISTS 'business';
ALTER TYPE user_plan ADD VALUE IF NOT EXISTS 'enterprise'; 
ALTER TYPE user_plan ADD VALUE IF NOT EXISTS 'admin';

-- Add new system settings for business and enterprise plans
INSERT INTO public.system_settings (setting_key, setting_value, description, is_public) VALUES
  ('business_fanmarks_limit', '50', 'Maximum fanmarks for business plan users', true),
  ('business_pricing', '10000', 'Monthly pricing for business plan (JPY)', true),
  ('enterprise_fanmarks_limit', '100', 'Default maximum fanmarks for enterprise plan users', true),
  ('enterprise_pricing', '50000', 'Default monthly pricing for enterprise plan (JPY)', true)
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = EXCLUDED.setting_value,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public;

-- Create table for individual enterprise user settings
CREATE TABLE IF NOT EXISTS public.enterprise_user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  custom_fanmarks_limit INTEGER,
  custom_pricing INTEGER,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID -- admin who created this setting
);

-- Enable RLS on enterprise_user_settings
ALTER TABLE public.enterprise_user_settings ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for enterprise_user_settings
CREATE POLICY "Only admins can manage enterprise user settings" 
ON public.enterprise_user_settings 
FOR ALL 
USING (is_admin())
WITH CHECK (is_admin());

-- Create policy for enterprise users to view their own settings
CREATE POLICY "Enterprise users can view their own settings" 
ON public.enterprise_user_settings 
FOR SELECT 
USING (auth.uid() = user_id);

-- Add trigger for updated_at timestamp
CREATE TRIGGER update_enterprise_user_settings_updated_at
BEFORE UPDATE ON public.enterprise_user_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();