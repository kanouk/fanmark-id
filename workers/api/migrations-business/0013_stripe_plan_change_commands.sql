-- Owner-bound, retryable Stripe subscription change commands.
CREATE TABLE "stripe_plan_change_commands" (
  "request_id" TEXT NOT NULL PRIMARY KEY
    CHECK (length("request_id") = 36 AND substr("request_id", 9, 1) = '-' AND
      substr("request_id", 14, 1) = '-' AND substr("request_id", 19, 1) = '-' AND
      substr("request_id", 24, 1) = '-' AND replace("request_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "user_id" TEXT NOT NULL
    CHECK (length("user_id") = 36 AND substr("user_id", 9, 1) = '-' AND
      substr("user_id", 14, 1) = '-' AND substr("user_id", 19, 1) = '-' AND
      substr("user_id", 24, 1) = '-' AND replace("user_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "stripe_subscription_id" TEXT NOT NULL CHECK ("stripe_subscription_id" GLOB 'sub_*'),
  "stripe_customer_id" TEXT NOT NULL CHECK ("stripe_customer_id" GLOB 'cus_*'),
  "from_plan_type" TEXT NOT NULL CHECK ("from_plan_type" IN ('creator', 'max', 'business')),
  "to_plan_type" TEXT NOT NULL CHECK ("to_plan_type" IN ('free', 'creator', 'max', 'business')),
  "from_price_id" TEXT NOT NULL CHECK ("from_price_id" GLOB 'price_*'),
  "to_price_id" TEXT CHECK ("to_price_id" IS NULL OR "to_price_id" GLOB 'price_*'),
  "livemode" INTEGER NOT NULL CHECK (typeof("livemode") = 'integer' AND "livemode" IN (0, 1)),
  "status" TEXT NOT NULL CHECK ("status" IN ('prepared', 'requires_action', 'submitted')),
  "idempotency_safe_until" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CHECK (("to_plan_type" = 'free') = ("to_price_id" IS NULL)),
  CHECK ("from_plan_type" <> "to_plan_type")
);

CREATE INDEX "stripe_plan_change_commands_owner_idx"
  ON "stripe_plan_change_commands" ("user_id", "created_at");

CREATE UNIQUE INDEX "stripe_plan_change_commands_one_open_per_owner_idx"
  ON "stripe_plan_change_commands" ("user_id")
  WHERE "status" IN ('prepared', 'requires_action');
