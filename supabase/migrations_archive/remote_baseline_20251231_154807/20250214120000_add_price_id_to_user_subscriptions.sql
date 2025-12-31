-- Add price_id column to user_subscriptions for tracking Stripe Price IDs
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS price_id TEXT;

COMMENT ON COLUMN public.user_subscriptions.price_id IS 'Stripe Price ID associated with the active subscription';
