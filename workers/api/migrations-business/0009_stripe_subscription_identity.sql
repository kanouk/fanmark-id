-- A Stripe subscription has one global owner, including after cancellation.
-- This target-side invariant prevents stale events from reassigning a tombstone.
CREATE UNIQUE INDEX "user_subscriptions_stripe_subscription_id_key"
  ON "user_subscriptions" ("stripe_subscription_id");
