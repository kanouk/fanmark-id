-- Remove Grace period editing permissions from RLS policies

-- 1. fanmark_basic_configs: Remove Grace period condition
DROP POLICY IF EXISTS "Users can manage configs for their own licenses" ON public.fanmark_basic_configs;

CREATE POLICY "Users can manage configs for their own licenses"
ON public.fanmark_basic_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_basic_configs.license_id
      AND fl.user_id = auth.uid()
      AND fl.status = 'active'
      AND fl.license_end > now()
  )
);

-- 2. fanmark_redirect_configs: Remove Grace period condition
DROP POLICY IF EXISTS "Users can manage redirect configs for their own licenses" ON public.fanmark_redirect_configs;

CREATE POLICY "Users can manage redirect configs for their own licenses"
ON public.fanmark_redirect_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_redirect_configs.license_id
      AND fl.user_id = auth.uid()
      AND fl.status = 'active'
      AND fl.license_end > now()
  )
);

-- 3. fanmark_messageboard_configs: Remove Grace period condition
DROP POLICY IF EXISTS "Users can manage messageboard configs for their own licenses" ON public.fanmark_messageboard_configs;

CREATE POLICY "Users can manage messageboard configs for their own licenses"
ON public.fanmark_messageboard_configs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM fanmark_licenses fl
    WHERE fl.id = fanmark_messageboard_configs.license_id
      AND fl.user_id = auth.uid()
      AND fl.status = 'active'
      AND fl.license_end > now()
  )
);