import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import Stripe from "stripe";
import { PGlite } from "@electric-sql/pglite";

import {
  buildReceiptPersistenceInput,
  canonicalizeNormalizedPayload,
  createStripeReceiptIngress,
  createSupabaseReceiptPersister,
  normalizeStripeEvent,
  sha256Hex,
} from "../../../supabase/functions/_shared/stripe-receipt-ingress/index.ts";

const SECRET = "whsec_ingress_test_secret";
const stripe = new Stripe("sk_test_ingress_only", {
  apiVersion: "2025-08-27.basil",
});
const encoder = new TextEncoder();
const migrationSql = await readFile(
  new URL("../../../supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql", import.meta.url),
  "utf8",
);

function checkoutEvent({
  id = "evt_ingress_checkout_001",
  created = Math.floor(Date.now() / 1000),
  apiVersion = "2025-08-27.basil",
  livemode = false,
  objectId = "cs_ingress_001",
  metadata = {
    type: "license_extension",
    user_id: "user_ingress_001",
    license_id: "license_ingress_001",
    fanmark_id: "fanmark_ingress_001",
    months: "3",
    secret_key: "must_not_be_retained",
  },
} = {}) {
  return {
    id,
    object: "event",
    api_version: apiVersion,
    created,
    livemode,
    type: "checkout.session.completed",
    data: {
      object: {
        id: objectId,
        object: "checkout.session",
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        amount_total: 1200,
        currency: "jpy",
        customer: "cus_ingress_001",
        payment_intent: "pi_ingress_001",
        client_reference_id: "user_ingress_001",
        metadata,
      },
    },
  };
}

function signedRequest(payload, { timestamp = Math.floor(Date.now() / 1000), body = payload } = {}) {
  const header = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: SECRET,
    timestamp,
  });
  return new Request("https://example.test/stripe", {
    method: "POST",
    headers: { "stripe-signature": header },
    body: encoder.encode(body),
  });
}

function durableResult(overrides = {}) {
  return {
    receipt_id: "receipt_ingress_001",
    dispatch_id: "dispatch_ingress_001",
    outcome: "accepted",
    receipt_status: "received",
    dispatch_status: "pending",
    delivery_count: 1,
    ...overrides,
  };
}

async function responseJson(response) {
  return response.json();
}

test("real Stripe SDK verifies the raw signed bytes before the persister runs", async () => {
  const event = checkoutEvent();
  const payload = JSON.stringify(event);
  const persisted = [];
  const handler = createStripeReceiptIngress({
    stripe,
    webhookSecret: SECRET,
    persistReceipt: async (input) => {
      persisted.push(input);
      return durableResult();
    },
  });

  const response = await handler(signedRequest(payload));

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), {
    received: true,
    outcome: "accepted",
    receipt_status: "received",
    dispatch_status: "pending",
  });
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].stripeEventId, event.id);
  assert.equal(persisted[0].rawPayloadSha256, await sha256Hex(encoder.encode(payload)));
  assert.deepEqual(persisted[0].normalizedPayload.checkout_session.metadata, {
    fanmark_id: "fanmark_ingress_001",
    license_id: "license_ingress_001",
    months: "3",
    type: "license_extension",
    user_id: "user_ingress_001",
  });
  assert.equal("secret_key" in persisted[0].normalizedPayload.checkout_session.metadata, false);
});

test("tampered and stale signatures are rejected without a database call", async () => {
  const event = checkoutEvent({ id: "evt_ingress_bad_signature" });
  const payload = JSON.stringify(event);
  let persistCalls = 0;
  const handler = createStripeReceiptIngress({
    stripe,
    webhookSecret: SECRET,
    persistReceipt: async () => {
      persistCalls += 1;
      return durableResult();
    },
  });

  const tampered = await handler(signedRequest(payload, { body: `${payload} ` }));
  const stale = await handler(
    signedRequest(payload, { timestamp: Math.floor(Date.now() / 1000) - 3601 }),
  );

  assert.equal(tampered.status, 400);
  assert.deepEqual(await responseJson(tampered), { error: "Invalid signature" });
  assert.equal(stale.status, 400);
  assert.deepEqual(await responseJson(stale), { error: "Invalid signature" });
  assert.equal(persistCalls, 0);
});

test("the streaming body limit rejects a body after a later chunk and never persists", async () => {
  let persistCalls = 0;
  const handler = createStripeReceiptIngress({
    stripe,
    webhookSecret: SECRET,
    maxBodyBytes: 8,
    persistReceipt: async () => {
      persistCalls += 1;
      return durableResult();
    },
  });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("12345"));
      controller.enqueue(encoder.encode("67890"));
      controller.close();
    },
  });
  const request = new Request("https://example.test/stripe", {
    method: "POST",
    headers: { "stripe-signature": "unused" },
    body: stream,
    duplex: "half",
  });

  const response = await handler(request);

  assert.equal(response.status, 413);
  assert.deepEqual(await responseJson(response), { error: "Request body too large" });
  assert.equal(persistCalls, 0);
});

test("a hanging body stream is bounded and cancellation does not delay the response", async () => {
  const handler = createStripeReceiptIngress({
    stripe,
    webhookSecret: SECRET,
    bodyReadTimeoutMs: 10,
    persistReceipt: async () => durableResult(),
  });
  let cancelled = false;
  const stream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://example.test/stripe", {
    method: "POST",
    headers: { "stripe-signature": "unused" },
    body: stream,
    duplex: "half",
  });

  const startedAt = Date.now();
  const response = await handler(request);

  assert.equal(response.status, 408);
  assert.ok(Date.now() - startedAt < 500);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});

test("only POST is accepted and missing signatures are sanitized", async () => {
  let persistCalls = 0;
  const handler = createStripeReceiptIngress({
    stripe,
    webhookSecret: SECRET,
    persistReceipt: async () => {
      persistCalls += 1;
      return durableResult();
    },
  });

  const getResponse = await handler(new Request("https://example.test/stripe", { method: "GET" }));
  const missingSignature = await handler(
    new Request("https://example.test/stripe", { method: "POST", body: "{}" }),
  );

  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get("allow"), "POST");
  assert.deepEqual(await responseJson(missingSignature), { error: "Invalid signature" });
  assert.equal(persistCalls, 0);
});

test("factory rejects unsafe numeric limits instead of disabling safeguards", () => {
  const base = {
    stripe,
    webhookSecret: SECRET,
    persistReceipt: async () => durableResult(),
  };
  assert.throws(() => createStripeReceiptIngress({ ...base, maxBodyBytes: Number.NaN }), /positive bounded integer/);
  assert.throws(() => createStripeReceiptIngress({ ...base, signatureToleranceSeconds: 0 }), /positive bounded integer/);
  assert.throws(() => createStripeReceiptIngress({ ...base, bodyReadTimeoutMs: Infinity }), /positive bounded integer/);
});

test("database failure and timeout return retryable 5xx without exposing payload data", async () => {
  const event = checkoutEvent({ id: "evt_ingress_db_error" });
  const payload = JSON.stringify(event);
  const failing = createStripeReceiptIngress({
    stripe,
    webhookSecret: SECRET,
    persistReceipt: async () => {
      throw new Error(`database failed for ${payload}`);
    },
  });
  const timedOut = createStripeReceiptIngress({
    stripe,
    webhookSecret: SECRET,
    persistTimeoutMs: 5,
    persistReceipt: async () => new Promise(() => {}),
  });

  const failureResponse = await failing(signedRequest(payload));
  const timeoutResponse = await timedOut(signedRequest(payload));
  const failureBody = JSON.stringify(await responseJson(failureResponse));
  const timeoutBody = JSON.stringify(await responseJson(timeoutResponse));

  assert.equal(failureResponse.status, 503);
  assert.equal(timeoutResponse.status, 503);
  assert.equal(failureBody.includes(payload), false);
  assert.equal(timeoutBody.includes(payload), false);
  assert.equal(failureBody.includes(SECRET), false);
});

test("2xx duplicate acknowledgements reflect the durable terminal or nonterminal result", async () => {
  const event = checkoutEvent({ id: "evt_ingress_duplicate" });
  const payload = JSON.stringify(event);
  let delivery = 0;
  const handler = createStripeReceiptIngress({
    stripe,
    webhookSecret: SECRET,
    persistReceipt: async () => {
      delivery += 1;
      return delivery === 1
        ? durableResult()
        : durableResult({
          outcome: "duplicate_nonterminal",
          delivery_count: 2,
        });
    },
  });

  const first = await handler(signedRequest(payload));
  const duplicate = await handler(signedRequest(payload));

  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal((await responseJson(duplicate)).outcome, "duplicate_nonterminal");
});

test("malformed or ambiguous RPC results are retryable failures, never acknowledgements", async () => {
  const event = checkoutEvent({ id: "evt_ingress_bad_rpc_result" });
  const payload = JSON.stringify(event);
  for (const data of [
    [],
    [durableResult(), durableResult()],
    [durableResult({ receipt_id: "" })],
    [durableResult({ dispatch_id: " " })],
    [durableResult({ delivery_count: 0 })],
    [durableResult({ delivery_count: 1.5 })],
    [durableResult({ receipt_status: "applied", dispatch_status: "pending" })],
    [durableResult({ outcome: "duplicate_terminal", receipt_status: "applied", dispatch_status: "pending" })],
  ]) {
    const handler = createStripeReceiptIngress({
      stripe,
      webhookSecret: SECRET,
      persistReceipt: createSupabaseReceiptPersister({
        rpc: async () => ({ data, error: null }),
      }),
    });
    const response = await handler(signedRequest(payload));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("factory validates every persister result and acknowledges consistent terminal receipts", async () => {
  const payload = JSON.stringify(checkoutEvent({ id: "evt_ingress_persister_boundary" }));
  const invalid = createStripeReceiptIngress({
    stripe,
    webhookSecret: SECRET,
    persistReceipt: async () => durableResult({ outcome: "unknown", delivery_count: -1 }),
  });
  assert.equal((await invalid(signedRequest(payload))).status, 503);
  for (const [receipt_status, dispatch_status] of [
    ["applied", "completed"], ["ignored", "completed"], ["dead_letter", "dead_letter"],
  ]) {
    const handler = createStripeReceiptIngress({
      stripe,
      webhookSecret: SECRET,
      persistReceipt: async () => durableResult({
        outcome: "duplicate_terminal", receipt_status, dispatch_status, delivery_count: 2,
      }),
    });
    const response = await handler(signedRequest(payload));
    assert.equal(response.status, 200);
    assert.equal((await responseJson(response)).outcome, "duplicate_terminal");
  }
});

test("canonical normalized JSON and its hash are independent of object key order", async () => {
  const first = { z: 1, nested: { b: true, a: "x" }, a: [2, 1] };
  const second = { a: [2, 1], nested: { a: "x", b: true }, z: 1 };
  const firstCanonical = canonicalizeNormalizedPayload(first);
  const secondCanonical = canonicalizeNormalizedPayload(second);

  assert.equal(firstCanonical, secondCanonical);
  assert.equal(
    await sha256Hex(encoder.encode(firstCanonical)),
    await sha256Hex(encoder.encode(secondCanonical)),
  );
});

test("Basil invoice relationships use parent.subscription_details.subscription and reject conflicts", () => {
  const basil = {
    id: "evt_ingress_invoice_basil",
    type: "invoice.payment_failed",
    api_version: "2025-08-27.basil",
    created: 1_750_000_000,
    livemode: true,
    data: {
      object: {
        id: "in_ingress_basil",
        object: "invoice",
        customer: "cus_ingress_001",
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: "sub_basil" },
        },
        amount_due: 100,
      },
    },
  };
  const legacy = {
    ...basil,
    id: "evt_ingress_invoice_legacy",
    api_version: "2024-06-20",
    data: {
      object: {
        ...basil.data.object,
        parent: null,
        subscription: "sub_legacy",
      },
    },
  };

  assert.equal(
    normalizeStripeEvent(basil).invoice.subscription_id,
    "sub_basil",
  );
  assert.equal(
    normalizeStripeEvent(legacy).invoice.subscription_relation_source,
    "legacy_top_level",
  );

  assert.throws(
    () => normalizeStripeEvent({
      ...basil,
      id: "evt_ingress_invoice_conflict_basil",
      data: {
        object: {
          ...basil.data.object,
          subscription: "sub_legacy",
        },
      },
    }),
    /relationship conflicts/,
  );
  const laterModern = normalizeStripeEvent({
    ...basil,
    id: "evt_ingress_invoice_later_modern",
    api_version: "2025-09-30.clover",
  });
  assert.equal(laterModern.invoice.subscription_id, "sub_basil");
  assert.throws(
    () => normalizeStripeEvent({
      ...basil,
      id: "evt_ingress_invoice_bad_parent_type",
      data: {
        object: {
          ...basil.data.object,
          parent: {
            type: "subscription_details_v2",
            subscription_details: { subscription: "sub_basil" },
          },
        },
      },
    }),
    /parent type is required/,
  );
  assert.throws(
    () => normalizeStripeEvent({
      ...basil,
      id: "evt_ingress_invoice_missing_parent_with_legacy",
      data: {
        object: {
          ...basil.data.object,
          parent: { type: "subscription_details", subscription_details: {} },
          subscription: "sub_legacy",
        },
      },
    }),
    /missing its parent subscription relationship/,
  );
  assert.throws(
    () => normalizeStripeEvent({
      ...legacy,
      id: "evt_ingress_invoice_conflict_legacy",
      data: {
        object: {
          ...legacy.data.object,
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_basil" },
          },
        },
      },
    }),
    /relationship conflicts/,
  );
  assert.throws(
    () => normalizeStripeEvent({
      ...legacy,
      id: "evt_ingress_invoice_unknown_version",
      api_version: "2025-99-99.basil",
    }),
    /API version is required/,
  );
});

test("known object type and replay-critical collection limits are validated", () => {
  const event = checkoutEvent({ id: "evt_ingress_wrong_object_type" });
  assert.throws(
    () => normalizeStripeEvent({
      ...event,
      data: { object: { ...event.data.object, object: "invoice" } },
    }),
    /object type is invalid/,
  );

  assert.throws(
    () => normalizeStripeEvent({
      id: "evt_ingress_too_many_items",
      type: "customer.subscription.updated",
      api_version: "2025-08-27.basil",
      created: 1_750_000_000,
      livemode: false,
      data: {
        object: {
          id: "sub_ingress_many_items",
          object: "subscription",
          customer: "cus_ingress_001",
          items: {
            has_more: false,
            data: Array.from({ length: 21 }, (_, index) => ({ id: `si_${index}` })),
          },
        },
      },
    }),
    /incomplete for deterministic replay/,
  );
});

test("unknown types retain only a bounded envelope and object reference", async () => {
  const event = {
    id: "evt_ingress_unknown",
    type: "some.future.event",
    api_version: "2025-08-27.basil",
    created: 1_750_000_000,
    livemode: false,
    data: {
      object: {
        id: "future_001",
        object: "future.object",
        metadata: { user_id: "user_should_not_be_copied" },
        secret_field: "do_not_copy",
      },
    },
  };
  const input = await buildReceiptPersistenceInput(event, encoder.encode(JSON.stringify(event)));

  assert.equal(input.normalizedPayload.branch, "unknown");
  assert.deepEqual(input.normalizedPayload.reference, {
    object_id: "future_001",
    object_type: "future.object",
  });
  assert.equal(JSON.stringify(input.normalizedPayload).includes("do_not_copy"), false);
  assert.equal(JSON.stringify(input.normalizedPayload).includes("user_should_not_be_copied"), false);
});

async function createPgliteRpc() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create function auth.role()
    returns text
    language sql
    stable
    as $$ select current_setting('request.jwt.claim.role', true) $$;
  `);
  await db.exec(migrationSql);
  await db.query("select set_config('request.jwt.claim.role', $1, false)", ["service_role"]);

  return {
    db,
    client: {
      async rpc(functionName, args) {
        assert.equal(functionName, "accept_stripe_webhook_receipt");
        const result = await db.query(
          `select * from public.accept_stripe_webhook_receipt(
             $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10
           )`,
          [
            args.p_stripe_event_id,
            args.p_livemode,
            args.p_event_type,
            args.p_object_type,
            args.p_object_id,
            args.p_api_version,
            args.p_normalized_schema_version,
            JSON.stringify(args.p_normalized_payload),
            args.p_normalized_payload_sha256,
            args.p_raw_payload_sha256,
          ],
        );
        return { data: result.rows, error: null };
      },
    },
  };
}

test("PGlite executes the real receipt RPC path and returns duplicate state", async () => {
  const { db, client } = await createPgliteRpc();
  try {
    const persist = createSupabaseReceiptPersister(client);
    const event = checkoutEvent({ id: "evt_ingress_pglite" });
    const payload = JSON.stringify(event);
    const handler = createStripeReceiptIngress({
      stripe,
      webhookSecret: SECRET,
      persistReceipt: persist,
    });

    const first = await handler(signedRequest(payload));
    const second = await handler(signedRequest(payload));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal((await responseJson(second)).outcome, "duplicate_nonterminal");
    const counts = await db.query(`
      select
        (select count(*)::int from billing_ingress.stripe_webhook_receipts) as receipts,
        (select count(*)::int from billing_ingress.stripe_webhook_dispatches) as dispatches
    `);
    assert.deepEqual(counts.rows[0], { receipts: 1, dispatches: 1 });
  } finally {
    await db.close();
  }
});
