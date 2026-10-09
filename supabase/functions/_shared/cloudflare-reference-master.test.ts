import assert from "node:assert/strict";
import test from "node:test";
import { fetchCloudflareExtensionPrice, CloudflareReferenceMasterError } from "./cloudflare-reference-master.ts";
import { handleReferenceMasterServiceRequest } from "../../../workers/api/src/reference-master-service-api.ts";
import type { Env } from "../../../workers/api/src/repository.ts";

const API_BASE = "https://fanmark-app-staging.fanmark-id.workers.dev";
const SECRET = "synthetic-reference-master-service-secret-0001";
const NOW = Date.UTC(2026, 8, 25, 3, 0, 0);
const RELEASE_VERSION = "b".repeat(64);

function fakeDatabase(row: Record<string, unknown>) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              return { success: true, results: [row] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function testEnv(rowOverrides: Record<string, unknown> = {}): Env {
  return {
    D1_TOPOLOGY: "split",
    MASTER_DB: fakeDatabase({
      release_version: RELEASE_VERSION,
      expected_count: 16,
      actual_count: 16,
      tier_level: 3,
      months: 6,
      price_yen: 2400,
      is_active: 1,
      stripe_price_id: "price_syntheticTest3",
      stripe_price_id_live: "price_syntheticLive3",
      ...rowOverrides,
    }),
    REFERENCE_MASTER_BACKEND: "d1",
    REFERENCE_MASTER_SERVICE_SECRET: SECRET,
  };
}

test("Supabase Edge helper signs a Worker request and reads an exact private release projection", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await fetchCloudflareExtensionPrice({
    apiBaseUrl: API_BASE,
    secret: SECRET,
    tierLevel: 3,
    months: 6,
    mode: "live",
    now: () => NOW,
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return handleReferenceMasterServiceRequest(new Request(input, init), testEnv(), () => NOW) as Promise<Response>;
    },
  });
  assert.equal(requestUrl, `${API_BASE}/api/internal/reference-masters/extension-price?mode=live&months=6&tier_level=3`);
  assert.equal(requestInit?.method, "GET");
  assert.equal(requestInit?.credentials, "omit");
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(requestInit?.redirect, "error");
  assert.equal(new Headers(requestInit?.headers).has("origin"), false);
  assert.deepEqual(result, {
    schemaVersion: 1,
    releaseVersion: RELEASE_VERSION,
    tierLevel: 3,
    months: 6,
    priceYen: 2400,
    isActive: true,
    stripePriceId: "price_syntheticLive3",
  });
});

test("price-only mode never returns a Stripe ID", async () => {
  const result = await fetchCloudflareExtensionPrice({
    apiBaseUrl: API_BASE,
    secret: SECRET,
    tierLevel: 3,
    months: 6,
    mode: "none",
    now: () => NOW,
    fetcher: async (input, init) => handleReferenceMasterServiceRequest(
      new Request(input, init), testEnv(), () => NOW,
    ) as Promise<Response>,
  });
  assert.equal(result.stripePriceId, null);
});

test("fails closed on incomplete configuration, unsafe origins, and malformed or uncacheable Worker replies", async () => {
  await assert.rejects(() => fetchCloudflareExtensionPrice({
    apiBaseUrl: API_BASE,
    secret: "too-short",
    tierLevel: 3,
    months: 6,
    mode: "test",
  }), (error: unknown) => error instanceof CloudflareReferenceMasterError && error.kind === "configuration");

  await assert.rejects(() => fetchCloudflareExtensionPrice({
    apiBaseUrl: "https://user:pass@api.example.test/path",
    secret: SECRET,
    tierLevel: 3,
    months: 6,
    mode: "test",
  }), (error: unknown) => error instanceof CloudflareReferenceMasterError && error.kind === "configuration");

  const malformed = { schemaVersion: 1, releaseVersion: RELEASE_VERSION, tierLevel: 3, months: 6,
    priceYen: 2400, isActive: true, stripePriceId: "sk_live_not_a_price_id" };
  await assert.rejects(() => fetchCloudflareExtensionPrice({
    apiBaseUrl: API_BASE,
    secret: SECRET,
    tierLevel: 3,
    months: 6,
    mode: "test",
    fetcher: async () => new Response(JSON.stringify(malformed), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }),
  }), (error: unknown) => error instanceof CloudflareReferenceMasterError && error.kind === "invalid_response");

  await assert.rejects(() => fetchCloudflareExtensionPrice({
    apiBaseUrl: API_BASE,
    secret: SECRET,
    tierLevel: 3,
    months: 6,
    mode: "test",
    fetcher: async () => new Response(JSON.stringify({}), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    }),
  }), (error: unknown) => error instanceof CloudflareReferenceMasterError && error.kind === "invalid_response");
});

test("propagates Worker refusal without silently falling back", async () => {
  await assert.rejects(() => fetchCloudflareExtensionPrice({
    apiBaseUrl: API_BASE,
    secret: SECRET,
    tierLevel: 3,
    months: 6,
    mode: "test",
    now: () => NOW,
    fetcher: async (input, init) => handleReferenceMasterServiceRequest(
      new Request(input, init), testEnv(), () => NOW + 61_000,
    ) as Promise<Response>,
  }), (error: unknown) => error instanceof CloudflareReferenceMasterError && error.kind === "http" && error.status === 401);
});
