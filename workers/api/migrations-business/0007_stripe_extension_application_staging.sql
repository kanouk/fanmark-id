-- Local/staging preparation only: D1 intent binding and atomic extension effects.
-- Keep the webhook selector disabled until the D1 Checkout command path and
-- dispatch processor have both been implemented and reviewed.

CREATE TABLE "stripe_extension_checkout_intents" (
  "id" TEXT NOT NULL PRIMARY KEY
    CHECK (length("id") = 36 AND substr("id", 9, 1) = '-' AND substr("id", 14, 1) = '-' AND
      substr("id", 19, 1) = '-' AND substr("id", 24, 1) = '-' AND
      replace("id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "request_id" TEXT NOT NULL
    CHECK (length("request_id") = 36 AND substr("request_id", 9, 1) = '-' AND substr("request_id", 14, 1) = '-' AND
      substr("request_id", 19, 1) = '-' AND substr("request_id", 24, 1) = '-' AND
      replace("request_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "user_id" TEXT NOT NULL
    CHECK (length("user_id") = 36 AND substr("user_id", 9, 1) = '-' AND substr("user_id", 14, 1) = '-' AND
      substr("user_id", 19, 1) = '-' AND substr("user_id", 24, 1) = '-' AND
      replace("user_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "license_id" TEXT NOT NULL
    CHECK (length("license_id") = 36 AND substr("license_id", 9, 1) = '-' AND substr("license_id", 14, 1) = '-' AND
      substr("license_id", 19, 1) = '-' AND substr("license_id", 24, 1) = '-' AND
      replace("license_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "fanmark_id" TEXT NOT NULL
    CHECK (length("fanmark_id") = 36 AND substr("fanmark_id", 9, 1) = '-' AND substr("fanmark_id", 14, 1) = '-' AND
      substr("fanmark_id", 19, 1) = '-' AND substr("fanmark_id", 24, 1) = '-' AND
      replace("fanmark_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "tier_level" INTEGER NOT NULL CHECK (typeof("tier_level") = 'integer' AND "tier_level" BETWEEN 1 AND 9999),
  "months" INTEGER NOT NULL CHECK (typeof("months") = 'integer' AND "months" BETWEEN 1 AND 12),
  "stripe_price_id" TEXT NOT NULL CHECK (length(trim("stripe_price_id")) > 0),
  "currency" TEXT NOT NULL DEFAULT 'jpy' CHECK ("currency" = 'jpy'),
  "expected_total_yen" INTEGER NOT NULL CHECK (
    typeof("expected_total_yen") = 'integer' AND "expected_total_yen" BETWEEN 1 AND 9007199254740991
  ),
  "allow_zero_total" INTEGER NOT NULL DEFAULT 0 CHECK ("allow_zero_total" = 0),
  "livemode" INTEGER NOT NULL CHECK (typeof("livemode") = 'integer' AND "livemode" IN (0, 1)),
  "stripe_checkout_session_id" TEXT,
  "stripe_session_status" TEXT,
  "stripe_payment_status" TEXT,
  "status" TEXT NOT NULL DEFAULT 'created' CHECK (
    "status" IN ('created', 'open', 'awaiting_payment_confirmation', 'applied', 'expired', 'failed', 'blocked_stale_owner', 'reconciliation_required')
  ),
  "idempotency_safe_until" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  UNIQUE ("user_id", "request_id"),
  UNIQUE ("livemode", "stripe_checkout_session_id")
);

CREATE TABLE "stripe_extension_applications" (
  "id" TEXT NOT NULL PRIMARY KEY
    CHECK (length("id") = 36 AND substr("id", 9, 1) = '-' AND substr("id", 14, 1) = '-' AND
      substr("id", 19, 1) = '-' AND substr("id", 24, 1) = '-' AND
      replace("id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "billing_intent_id" TEXT NOT NULL REFERENCES "stripe_extension_checkout_intents"("id"),
  "livemode" INTEGER NOT NULL CHECK (typeof("livemode") = 'integer' AND "livemode" IN (0, 1)),
  "stripe_checkout_session_id" TEXT NOT NULL CHECK (length(trim("stripe_checkout_session_id")) > 0),
  "source_receipt_id" TEXT NOT NULL REFERENCES "stripe_webhook_receipts"("id"),
  "last_receipt_id" TEXT NOT NULL REFERENCES "stripe_webhook_receipts"("id"),
  "applied_receipt_id" TEXT REFERENCES "stripe_webhook_receipts"("id"),
  "user_id" TEXT NOT NULL
    CHECK (length("user_id") = 36 AND substr("user_id", 9, 1) = '-' AND substr("user_id", 14, 1) = '-' AND
      substr("user_id", 19, 1) = '-' AND substr("user_id", 24, 1) = '-' AND
      replace("user_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "license_id" TEXT NOT NULL
    CHECK (length("license_id") = 36 AND substr("license_id", 9, 1) = '-' AND substr("license_id", 14, 1) = '-' AND
      substr("license_id", 19, 1) = '-' AND substr("license_id", 24, 1) = '-' AND
      replace("license_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "fanmark_id" TEXT NOT NULL
    CHECK (length("fanmark_id") = 36 AND substr("fanmark_id", 9, 1) = '-' AND substr("fanmark_id", 14, 1) = '-' AND
      substr("fanmark_id", 19, 1) = '-' AND substr("fanmark_id", 24, 1) = '-' AND
      replace("fanmark_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "tier_level" INTEGER NOT NULL CHECK (typeof("tier_level") = 'integer' AND "tier_level" BETWEEN 1 AND 9999),
  "months" INTEGER NOT NULL CHECK (typeof("months") = 'integer' AND "months" BETWEEN 1 AND 12),
  "expected_total_yen" INTEGER NOT NULL CHECK (
    typeof("expected_total_yen") = 'integer' AND "expected_total_yen" BETWEEN 1 AND 9007199254740991
  ),
  "allow_zero_total" INTEGER NOT NULL DEFAULT 0 CHECK ("allow_zero_total" = 0),
  "status" TEXT NOT NULL DEFAULT 'awaiting_payment_confirmation' CHECK (
    "status" IN ('awaiting_payment_confirmation', 'applying', 'applied', 'failed', 'expired', 'dead_letter')
  ),
  "result_code" TEXT NOT NULL DEFAULT 'awaiting_payment_confirmation',
  "failure_code" TEXT,
  "previous_license_end" TEXT,
  "new_license_end" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "applied_at" TEXT,
  "terminal_at" TEXT,
  CHECK (
    ("status" IN ('awaiting_payment_confirmation', 'applying') AND "terminal_at" IS NULL) OR
    ("status" IN ('applied', 'failed', 'expired', 'dead_letter') AND "terminal_at" IS NOT NULL)
  ),
  CHECK (("status" = 'applied') = ("applied_at" IS NOT NULL)),
  UNIQUE ("livemode", "stripe_checkout_session_id"),
  UNIQUE ("billing_intent_id"),
  UNIQUE ("source_receipt_id")
);

CREATE TABLE "stripe_extension_application_effects" (
  "application_id" TEXT NOT NULL PRIMARY KEY REFERENCES "stripe_extension_applications"("id"),
  "previous_license_end" TEXT NOT NULL,
  "new_license_end" TEXT NOT NULL,
  "cancelled_lottery_entries_count" INTEGER NOT NULL DEFAULT 0 CHECK (
    typeof("cancelled_lottery_entries_count") = 'integer' AND "cancelled_lottery_entries_count" >= 0
  ),
  "created_at" TEXT NOT NULL
);

CREATE TABLE "stripe_extension_application_lottery_entries" (
  "application_id" TEXT NOT NULL REFERENCES "stripe_extension_applications"("id"),
  "lottery_entry_id" TEXT NOT NULL REFERENCES "fanmark_lottery_entries"("id"),
  "user_id" TEXT NOT NULL
    CHECK (length("user_id") = 36 AND substr("user_id", 9, 1) = '-' AND substr("user_id", 14, 1) = '-' AND
      substr("user_id", 19, 1) = '-' AND substr("user_id", 24, 1) = '-' AND
      replace("user_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'cancelled')),
  "created_at" TEXT NOT NULL,
  PRIMARY KEY ("application_id", "lottery_entry_id")
);

CREATE INDEX "stripe_extension_intents_status_idx"
  ON "stripe_extension_checkout_intents" ("status", "updated_at");
CREATE INDEX "stripe_extension_applications_status_idx"
  ON "stripe_extension_applications" ("status", "updated_at");
