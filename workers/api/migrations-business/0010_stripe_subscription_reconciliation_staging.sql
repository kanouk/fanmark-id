-- Local/staging preparation for current Stripe subscription reconciliation.
-- D1 guards make ownership/fence failures abort the full application batch.
CREATE TABLE "stripe_subscription_applications" (
  "id" TEXT NOT NULL PRIMARY KEY
    CHECK (length("id") = 36 AND substr("id", 9, 1) = '-' AND substr("id", 14, 1) = '-' AND
      substr("id", 19, 1) = '-' AND substr("id", 24, 1) = '-' AND
      replace("id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "receipt_id" TEXT NOT NULL,
  "dispatch_id" TEXT NOT NULL,
  "stripe_event_id" TEXT NOT NULL CHECK (length(trim("stripe_event_id")) > 0),
  "livemode" INTEGER NOT NULL CHECK (typeof("livemode") = 'integer' AND "livemode" IN (0, 1)),
  "effect_key" TEXT NOT NULL CHECK (length(trim("effect_key")) BETWEEN 1 AND 512),
  "stripe_customer_id" TEXT NOT NULL CHECK (length(trim("stripe_customer_id")) > 0),
  "stripe_subscription_id" TEXT NOT NULL CHECK (length(trim("stripe_subscription_id")) > 0),
  "local_user_id" TEXT NOT NULL
    CHECK (length("local_user_id") = 36 AND substr("local_user_id", 9, 1) = '-' AND substr("local_user_id", 14, 1) = '-' AND
      substr("local_user_id", 19, 1) = '-' AND substr("local_user_id", 24, 1) = '-' AND
      replace("local_user_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "fence_generation" INTEGER NOT NULL CHECK (typeof("fence_generation") = 'integer' AND "fence_generation" > 0),
  "input_hash" TEXT NOT NULL CHECK (length("input_hash") = 64 AND "input_hash" NOT GLOB '*[^0-9a-f]*'),
  "effective_plan_type" TEXT CHECK ("effective_plan_type" IN ('creator', 'max', 'business')),
  "active_subscription_count" INTEGER NOT NULL CHECK (typeof("active_subscription_count") = 'integer' AND "active_subscription_count" >= 0),
  "status" TEXT NOT NULL CHECK ("status" IN ('applying', 'applied')),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "applied_at" TEXT,
  CHECK (("status" = 'applied') = ("applied_at" IS NOT NULL)),
  FOREIGN KEY ("receipt_id", "livemode", "stripe_event_id")
    REFERENCES "stripe_webhook_receipts" ("id", "livemode", "stripe_event_id") ON DELETE CASCADE,
  FOREIGN KEY ("dispatch_id") REFERENCES "stripe_webhook_dispatches" ("id") ON DELETE CASCADE,
  UNIQUE ("livemode", "stripe_event_id"),
  UNIQUE ("livemode", "effect_key")
);

CREATE INDEX "stripe_subscription_applications_customer_idx"
  ON "stripe_subscription_applications" ("livemode", "stripe_customer_id", "created_at");

CREATE TABLE "stripe_subscription_transaction_guards" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "passed" INTEGER NOT NULL CHECK (typeof("passed") = 'integer' AND "passed" = 1)
);
