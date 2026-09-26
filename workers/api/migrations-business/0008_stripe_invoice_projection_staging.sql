-- Local/staging preparation only: non-granting invoice payment-state projection.
-- This migration does not enable Stripe processing or change plan entitlements.

CREATE TABLE "stripe_sync_fences" (
  "livemode" INTEGER NOT NULL CHECK (typeof("livemode") = 'integer' AND "livemode" IN (0, 1)),
  "stripe_customer_id" TEXT NOT NULL CHECK (length(trim("stripe_customer_id")) > 0),
  "owner_token" TEXT,
  "generation" INTEGER NOT NULL CHECK (typeof("generation") = 'integer' AND "generation" BETWEEN 1 AND 9007199254740991),
  "lease_until" TEXT,
  "last_reconciled_at" TEXT,
  "last_invoice_id" TEXT,
  "last_invoice_attempt_key" TEXT,
  "last_error_code" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CHECK (("owner_token" IS NULL) = ("lease_until" IS NULL)),
  PRIMARY KEY ("livemode", "stripe_customer_id")
);

CREATE INDEX "stripe_sync_fences_lease_idx"
  ON "stripe_sync_fences" ("livemode", "lease_until");

CREATE TABLE "stripe_application_ledger" (
  "id" TEXT NOT NULL PRIMARY KEY
    CHECK (length("id") = 36 AND substr("id", 9, 1) = '-' AND substr("id", 14, 1) = '-' AND
      substr("id", 19, 1) = '-' AND substr("id", 24, 1) = '-' AND
      replace("id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "receipt_id" TEXT NOT NULL,
  "dispatch_id" TEXT NOT NULL,
  "stripe_event_id" TEXT NOT NULL CHECK (length(trim("stripe_event_id")) > 0),
  "livemode" INTEGER NOT NULL CHECK (typeof("livemode") = 'integer' AND "livemode" IN (0, 1)),
  "effect_kind" TEXT NOT NULL CHECK ("effect_kind" = 'invoice_projection'),
  "effect_key" TEXT NOT NULL CHECK (length(trim("effect_key")) BETWEEN 1 AND 512),
  "stripe_customer_id" TEXT NOT NULL CHECK (length(trim("stripe_customer_id")) > 0),
  "stripe_subscription_id" TEXT NOT NULL CHECK (length(trim("stripe_subscription_id")) > 0),
  "source_invoice_id" TEXT NOT NULL CHECK (length(trim("source_invoice_id")) > 0),
  "current_invoice_id" TEXT NOT NULL CHECK (length(trim("current_invoice_id")) > 0),
  "invoice_attempt_key" TEXT NOT NULL CHECK (length(trim("invoice_attempt_key")) BETWEEN 1 AND 512),
  "local_user_id" TEXT NOT NULL
    CHECK (length("local_user_id") = 36 AND substr("local_user_id", 9, 1) = '-' AND substr("local_user_id", 14, 1) = '-' AND
      substr("local_user_id", 19, 1) = '-' AND substr("local_user_id", 24, 1) = '-' AND
      replace("local_user_id", '-', '') NOT GLOB '*[^0-9a-f]*'),
  "fence_generation" INTEGER NOT NULL CHECK (typeof("fence_generation") = 'integer' AND "fence_generation" > 0),
  "input_hash" TEXT NOT NULL CHECK (length("input_hash") = 64 AND "input_hash" NOT GLOB '*[^0-9a-f]*'),
  "current_outcome" TEXT NOT NULL CHECK ("current_outcome" IN ('paid', 'payment_failed', 'requires_action', 'uncollectible')),
  "current_invoice_status" TEXT NOT NULL,
  "payment_intent_status" TEXT,
  "status" TEXT NOT NULL DEFAULT 'applying' CHECK ("status" IN ('applying', 'applied')),
  "result_summary" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("result_summary") AND json_type("result_summary") = 'object'),
  "attempt_count" INTEGER NOT NULL DEFAULT 1 CHECK (typeof("attempt_count") = 'integer' AND "attempt_count" > 0),
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "applied_at" TEXT,
  CHECK (("status" = 'applied') = ("applied_at" IS NOT NULL)),
  FOREIGN KEY ("receipt_id", "livemode", "stripe_event_id")
    REFERENCES "stripe_webhook_receipts" ("id", "livemode", "stripe_event_id") ON DELETE CASCADE,
  FOREIGN KEY ("dispatch_id") REFERENCES "stripe_webhook_dispatches" ("id") ON DELETE CASCADE,
  UNIQUE ("livemode", "stripe_event_id", "effect_kind"),
  UNIQUE ("livemode", "effect_key")
);

CREATE INDEX "stripe_application_ledger_invoice_idx"
  ON "stripe_application_ledger" ("livemode", "stripe_customer_id", "stripe_subscription_id", "source_invoice_id");
