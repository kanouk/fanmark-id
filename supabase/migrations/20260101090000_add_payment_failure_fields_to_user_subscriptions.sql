ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS payment_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_payment_attempt timestamptz,
  ADD COLUMN IF NOT EXISTS payment_failure_type text;

COMMENT ON COLUMN public.user_subscriptions.payment_failure_at IS 'Timestamp when Stripe payment failure was recorded';
COMMENT ON COLUMN public.user_subscriptions.next_payment_attempt IS 'Stripe next_payment_attempt from invoice for recovery schedule';
COMMENT ON COLUMN public.user_subscriptions.payment_failure_type IS 'Stripe event type that triggered the failure state (invoice.payment_failed/action_required)';
