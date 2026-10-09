import { expect, test } from "vitest";
import {
  handleReferenceMasterServiceRequest,
  type PrivateExtensionPrice,
} from "../src/reference-master-service-api.ts";
import type { Env } from "../src/repository.ts";

const API_BASE = "https://fanmark-app-staging.fanmark-id.workers.dev";
const SECRET = "synthetic-reference-master-service-secret-0001";
const NOW = Date.UTC(2026, 8, 25, 3, 0, 0);
const RELEASE_VERSION = "a".repeat(64);

function makeDatabase(rows: Record<string, unknown>[]) {
  let bindings: unknown[] = [];
  const database = {
    prepare(sql: string) {
      expect(sql).toMatch(/fanmark_extension_price_release_rows/u);
      return {
        bind(...values: unknown[]) {
          bindings = values;
          return {
            async all() {
              return { success: true, results: rows };
            },
          };
        },
      };
    },
    getBindings() {
      return bindings;
    },
  };
  return database as unknown as D1Database & { getBindings(): unknown[] };
}

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    release_version: RELEASE_VERSION,
    expected_count: 16,
    actual_count: 16,
    tier_level: 2,
    months: 3,
    price_yen: 1200,
    is_active: 1,
    stripe_price_id: "price_syntheticTest1",
    stripe_price_id_live: "price_syntheticLive1",
    ...overrides,
  };
}

async function signedRequest(options: {
  mode?: "test" | "live" | "none";
  timestamp?: number;
  path?: string;
  secret?: string;
  origin?: string;
  method?: string;
} = {}): Promise<Request> {
  const mode = options.mode ?? "test";
  const timestamp = String(Math.floor((options.timestamp ?? NOW) / 1000));
  const url = new URL(options.path ?? "/api/internal/reference-masters/extension-price", API_BASE);
  url.search = new URLSearchParams({ mode, months: "3", tier_level: "2" }).toString();
  const message = `GET\n/api/internal/reference-masters/extension-price?mode=${mode}&months=3&tier_level=2\n${timestamp}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(options.secret ?? SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  const hex = [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const headers = new Headers({
    "x-fanmark-service-timestamp": timestamp,
    "x-fanmark-service-signature": `v1=${hex}`,
  });
  if (options.origin) headers.set("origin", options.origin);
  return new Request(url, { method: options.method ?? "GET", headers });
}

function env(database = makeDatabase([validRow()]), overrides: Partial<Env> = {}): Env {
  return {
    D1_TOPOLOGY: "split",
    REFERENCE_MASTER_BACKEND: "d1",
    REFERENCE_MASTER_SERVICE_SECRET: SECRET,
    MASTER_DB: database,
    ...overrides,
  };
}

test("returns one private, mode-specific price from the active release", async () => {
  const database = makeDatabase([validRow()]);
  const request = await signedRequest();
  const response = await handleReferenceMasterServiceRequest(request, env(database), () => NOW);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("cache-control")).toBe("no-store");
  expect(response?.headers.get("access-control-allow-origin")).toBeNull();
  expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
  const result = await response?.json() as PrivateExtensionPrice;
  expect(result).toEqual({
    schemaVersion: 1,
    releaseVersion: RELEASE_VERSION,
    tierLevel: 2,
    months: 3,
    priceYen: 1200,
    isActive: true,
    stripePriceId: "price_syntheticTest1",
  });
  expect(database.getBindings()).toEqual([2, 3]);
});

test("selects only the requested mode and omits Stripe IDs for price-only consumers", async () => {
  const database = makeDatabase([validRow()]);
  const liveResponse = await handleReferenceMasterServiceRequest(await signedRequest({ mode: "live" }), env(database), () => NOW);
  expect((await liveResponse?.json() as PrivateExtensionPrice).stripePriceId).toBe("price_syntheticLive1");

  const publicProjectionResponse = await handleReferenceMasterServiceRequest(
    await signedRequest({ mode: "none" }), env(database), () => NOW,
  );
  expect((await publicProjectionResponse?.json() as PrivateExtensionPrice).stripePriceId).toBeNull();
});

test("rejects bad signatures, stale requests, browser origins, query ambiguity, and other methods", async () => {
  const configured = env();
  const tampered = await signedRequest();
  const tamperedUrl = new URL(tampered.url);
  tamperedUrl.searchParams.set("months", "6");
  expect((await handleReferenceMasterServiceRequest(new Request(tamperedUrl, tampered), configured, () => NOW))?.status).toBe(401);

  expect((await handleReferenceMasterServiceRequest(
    await signedRequest({ timestamp: NOW - 61_000 }), configured, () => NOW,
  ))?.status).toBe(401);
  expect((await handleReferenceMasterServiceRequest(
    await signedRequest({ origin: "https://app.example.test" }), configured, () => NOW,
  ))?.status).toBe(401);
  const duplicatedQuery = await signedRequest();
  const duplicatedQueryUrl = new URL(duplicatedQuery.url);
  duplicatedQueryUrl.search += "&mode=test";
  expect((await handleReferenceMasterServiceRequest(
    new Request(duplicatedQueryUrl, duplicatedQuery), configured, () => NOW,
  ))?.status).toBe(401);
  expect((await handleReferenceMasterServiceRequest(
    await signedRequest({ method: "POST" }), configured, () => NOW,
  ))?.status).toBe(405);
});

test("fails closed when the secret/backend/release projection is unavailable or inconsistent", async () => {
  const request = await signedRequest();
  expect((await handleReferenceMasterServiceRequest(request, env(undefined, {
    REFERENCE_MASTER_SERVICE_SECRET: undefined,
  }), () => NOW))?.status).toBe(503);
  expect((await handleReferenceMasterServiceRequest(request, env(undefined, {
    REFERENCE_MASTER_BACKEND: "supabase",
  }), () => NOW))?.status).toBe(503);

  const badReleaseDb = makeDatabase([validRow({ actual_count: 15 })]);
  const badReleaseResponse = await handleReferenceMasterServiceRequest(request, env(badReleaseDb), () => NOW);
  expect(badReleaseResponse?.status).toBe(503);

  const unavailableDb = makeDatabase([]);
  const missingResponse = await handleReferenceMasterServiceRequest(request, env(unavailableDb), () => NOW);
  expect(missingResponse?.status).toBe(404);

  const duplicateDb = makeDatabase([validRow(), validRow()]);
  const duplicateResponse = await handleReferenceMasterServiceRequest(request, env(duplicateDb), () => NOW);
  expect(duplicateResponse?.status).toBe(503);
});

test("keeps inactive status visible for the checkout caller to reject", async () => {
  const response = await handleReferenceMasterServiceRequest(
    await signedRequest(), env(makeDatabase([validRow({ is_active: 0 })])), () => NOW,
  );
  expect(response?.status).toBe(200);
  expect((await response?.json() as PrivateExtensionPrice).isActive).toBe(false);
});
