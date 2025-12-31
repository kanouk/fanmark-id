ALTER TABLE public.fanmark_licenses
ADD COLUMN IF NOT EXISTS transfer_locked_until timestamptz;
