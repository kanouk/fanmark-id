-- Idempotent, owner-bound subscription Checkout commands for the D1 billing path.
CREATE TABLE "stripe_plan_customer_commands" (
  "user_id" TEXT NOT NULL PRIMARY KEY
    CHECK (length("user_id") = 36 AND substr("user_id", 9, 1) = '-' AND
      substr("user_id", 14, 1) = '-' AND substr("user_id", 19, 1) = '-' AND
      substr("user_id", 24, 1) = '-' AND
      replace("user_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "stripe_customer_id" TEXT UNIQUE CHECK ("stripe_customer_id" IS NULL OR "stripe_customer_id" GLOB 'cus_*'),
  "status" TEXT NOT NULL CHECK ("status" IN ('pending', 'created')),
  "idempotency_safe_until" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CHECK (("status" = 'created') = ("stripe_customer_id" IS NOT NULL))
);

CREATE TABLE "stripe_plan_checkout_commands" (
  "request_id" TEXT NOT NULL PRIMARY KEY
    CHECK (length("request_id") = 36 AND substr("request_id", 9, 1) = '-' AND
      substr("request_id", 14, 1) = '-' AND substr("request_id", 19, 1) = '-' AND
      substr("request_id", 24, 1) = '-' AND
      replace("request_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "user_id" TEXT NOT NULL
    CHECK (length("user_id") = 36 AND substr("user_id", 9, 1) = '-' AND
      substr("user_id", 14, 1) = '-' AND substr("user_id", 19, 1) = '-' AND
      substr("user_id", 24, 1) = '-' AND
      replace("user_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "plan_type" TEXT NOT NULL CHECK ("plan_type" IN ('creator', 'max', 'business')),
  "stripe_price_id" TEXT NOT NULL CHECK ("stripe_price_id" GLOB 'price_*'),
  "livemode" INTEGER NOT NULL CHECK (typeof("livemode") = 'integer' AND "livemode" IN (0, 1)),
  "stripe_customer_id" TEXT CHECK ("stripe_customer_id" IS NULL OR "stripe_customer_id" GLOB 'cus_*'),
  "stripe_checkout_session_id" TEXT CHECK ("stripe_checkout_session_id" IS NULL OR "stripe_checkout_session_id" GLOB 'cs_*'),
  "status" TEXT NOT NULL CHECK ("status" IN ('prepared', 'session_created')),
  "idempotency_safe_until" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CHECK (("status" = 'session_created') = ("stripe_checkout_session_id" IS NOT NULL))
);

CREATE INDEX "stripe_plan_checkout_commands_owner_idx"
  ON "stripe_plan_checkout_commands" ("user_id", "created_at");
