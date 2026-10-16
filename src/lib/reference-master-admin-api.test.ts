import assert from "node:assert/strict";
import { test } from "node:test";
import { createReferenceMasterAdminApi, ReferenceMasterAdminApiError } from "./reference-master-admin-api.ts";

const releaseVersion = "a".repeat(64);
const validPricing = {
  schemaVersion: 1,
  releaseVersion,
  generation: 4,
  tiers: [{
    id: "00000000-0000-4000-8000-000000000001",
    tier_level: 1,
    display_name: "Test",
    description: null,
    initial_license_days: 30,
    is_active: true,
  }],
  extensionPrices: [{
    id: "00000000-0000-4000-8000-000000000002",
    tier_level: 1,
    months: 1,
    price_yen: 100,
    is_active: true,
    stripe_price_id: "price_syntheticTest1",
    stripe_price_id_live: null,
  }],
};

test("admin pricing API reads only same-origin, noncached credentialed responses", async () => {
  let observed: Request | undefined;
  const api = createReferenceMasterAdminApi({
    baseUrl: "https://fanmark.example",
    fetcher: async (input, init) => {
      observed = new Request(input, init);
      return Response.json(validPricing, { headers: { "cache-control": "no-store" } });
    },
  });

  assert.deepEqual(await api.get(), validPricing);
  assert.equal(observed?.url, "https://fanmark.example/api/admin/reference-masters/pricing");
  assert.equal(observed?.method, "GET");
  assert.equal(observed?.credentials, "include");
  assert.equal(observed?.cache, "no-store");
  assert.equal(observed?.redirect, "error");
});

test("tier edit sends only the requested editable value with active release precondition", async () => {
  let observedBody: unknown;
  let observedRequest: Request | undefined;
  const api = createReferenceMasterAdminApi({
    baseUrl: "https://fanmark.example",
    fetcher: async (input, init) => {
      observedRequest = new Request(input, init);
      observedBody = await observedRequest.clone().json();
      return Response.json(validPricing);
    },
  });

  await api.updateTierDays(releaseVersion, validPricing.tiers[0].id, null);
  assert.equal(observedRequest?.method, "PUT");
  assert.equal(observedRequest?.headers.get("content-type"), "application/json");
  assert.deepEqual(observedBody, {
    expectedReleaseVersion: releaseVersion,
    type: "tier",
    id: validPricing.tiers[0].id,
    changes: { initialLicenseDays: null },
  });
});

test("extension edits map only the selected public model fields to the worker contract", async () => {
  let observedBody: unknown;
  const api = createReferenceMasterAdminApi({
    baseUrl: "https://fanmark.example",
    fetcher: async (input, init) => {
      observedBody = await new Request(input, init).json();
      return Response.json(validPricing);
    },
  });

  await api.updateExtensionPrice(releaseVersion, validPricing.extensionPrices[0].id, { stripe_price_id_live: "price_syntheticLive1" });
  assert.deepEqual(observedBody, {
    expectedReleaseVersion: releaseVersion,
    type: "extension_price",
    id: validPricing.extensionPrices[0].id,
    changes: { stripePriceIdLive: "price_syntheticLive1" },
  });
});

test("extension admin edits map price, availability, and both Stripe IDs exactly", async () => {
  let observedBody: unknown;
  const api = createReferenceMasterAdminApi({
    baseUrl: "https://fanmark.example",
    fetcher: async (input, init) => {
      observedBody = await new Request(input, init).json();
      return Response.json(validPricing);
    },
  });

  await api.updateExtensionPrice(releaseVersion, validPricing.extensionPrices[0].id, {
    price_yen: 888,
    is_active: false,
    stripe_price_id: "price_syntheticTest2",
    stripe_price_id_live: null,
  });
  assert.deepEqual(observedBody, {
    expectedReleaseVersion: releaseVersion,
    type: "extension_price",
    id: validPricing.extensionPrices[0].id,
    changes: {
      priceYen: 888,
      isActive: false,
      stripePriceId: "price_syntheticTest2",
      stripePriceIdLive: null,
    },
  });
});

test("stale-version conflicts are returned to the admin without fallback", async () => {
  const api = createReferenceMasterAdminApi({
    baseUrl: "https://fanmark.example",
    fetcher: async () => Response.json({ error: "reference_master_edit_conflict" }, { status: 409 }),
  });
  await assert.rejects(api.updateTierDays(releaseVersion, validPricing.tiers[0].id, 20), (error) => {
    assert.ok(error instanceof ReferenceMasterAdminApiError);
    assert.equal(error.code, "reference_master_edit_conflict");
    assert.match(error.message, /最新の設定を読み直/u);
    return true;
  });
});

test("invalid private Stripe identifiers in responses are rejected", async () => {
  const api = createReferenceMasterAdminApi({
    baseUrl: "https://fanmark.example",
    fetcher: async () => Response.json({
      ...validPricing,
      extensionPrices: [{ ...validPricing.extensionPrices[0], stripe_price_id: "sk_live_sensitive" }],
    }),
  });
  await assert.rejects(api.get(), (error) => error instanceof ReferenceMasterAdminApiError && error.code === "invalid_response");
});
