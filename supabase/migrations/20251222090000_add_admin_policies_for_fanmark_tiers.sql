-- Allow admins to manage fanmark tiers from the dashboard

ALTER TABLE public.fanmark_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow admin read fanmark tiers" ON public.fanmark_tiers;
CREATE POLICY "Allow admin read fanmark tiers"
ON public.fanmark_tiers
FOR SELECT
USING (public.is_admin());

DROP POLICY IF EXISTS "Allow admin update fanmark tiers" ON public.fanmark_tiers;
CREATE POLICY "Allow admin update fanmark tiers"
ON public.fanmark_tiers
FOR UPDATE
USING (public.is_admin())
WITH CHECK (public.is_admin());

