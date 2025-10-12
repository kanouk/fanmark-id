-- Add admin policies for fanmark_tier_extension_prices table
-- This allows admins to view and update tier extension prices from the admin dashboard

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow admin read all extension prices" ON public.fanmark_tier_extension_prices;
DROP POLICY IF EXISTS "Allow admin update extension prices" ON public.fanmark_tier_extension_prices;

-- Create policy for admins to read all extension prices (including inactive ones)
CREATE POLICY "Allow admin read all extension prices"
ON public.fanmark_tier_extension_prices
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.user_settings us
    WHERE us.user_id = auth.uid()
      AND us.is_admin = true
  )
);

-- Create policy for admins to update extension prices
CREATE POLICY "Allow admin update extension prices"
ON public.fanmark_tier_extension_prices
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.user_settings us
    WHERE us.user_id = auth.uid()
      AND us.is_admin = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_settings us
    WHERE us.user_id = auth.uid()
      AND us.is_admin = true
  )
);

-- Note: The existing policy "Allow authenticated read extension prices"
-- remains in place for non-admin users to read active prices
