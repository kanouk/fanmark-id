import assert from "node:assert/strict";
import { test } from "node:test";
import { validateStripeExtensionApplicationResult } from "../../../supabase/functions/_shared/stripe-extension-application.ts";

const RECEIPT_ID = "10000000-0000-4000-8000-000000000001";

test("accepts only matching terminal application and receipt states", () => {
  for (const result of [
    { outcome: "applied", receipt_status: "applied", dispatch_status: "completed" },
    { outcome: "duplicate_session", receipt_status: "applied", dispatch_status: "completed" },
    { outcome: "awaiting_payment", receipt_status: "ignored", dispatch_status: "completed" },
    { outcome: "no_grant", receipt_status: "ignored", dispatch_status: "completed" },
    { outcome: "dead_letter", receipt_status: "dead_letter", dispatch_status: "dead_letter" },
    { outcome: "duplicate_terminal", receipt_status: "applied", dispatch_status: "completed" },
  ]) {
    assert.deepEqual(
      validateStripeExtensionApplicationResult(RECEIPT_ID, [{ receipt_id: RECEIPT_ID, ...result }]),
      { receipt_id: RECEIPT_ID, ...result },
    );
  }
});

test("rejects missing, mismatched, or nonterminal application results", () => {
  assert.throws(() => validateStripeExtensionApplicationResult(RECEIPT_ID, []), /invalid result/);
  assert.throws(() => validateStripeExtensionApplicationResult(RECEIPT_ID, [
    { receipt_id: "10000000-0000-4000-8000-000000000099", outcome: "applied", receipt_status: "applied", dispatch_status: "completed" },
  ]), /inconsistent terminal result/);
  assert.throws(() => validateStripeExtensionApplicationResult(RECEIPT_ID, [
    { receipt_id: RECEIPT_ID, outcome: "applied", receipt_status: "received", dispatch_status: "pending" },
  ]), /inconsistent terminal result/);
});
