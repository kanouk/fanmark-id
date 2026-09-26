import assert from "node:assert/strict";
import test from "node:test";
import {
  getWaitlistSignupBackend,
  submitWaitlistSignup,
  WaitlistSignupApiError,
} from "./waitlist-signup-api.ts";

const baseUrl = "https://app.example.test";

function acceptedResponse(value: unknown = { schemaVersion: 1, accepted: true }, status = 202): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

test("waitlist signup backend defaults to Supabase and accepts explicit Worker selection", () => {
  assert.equal(getWaitlistSignupBackend(undefined), "supabase");
  assert.equal(getWaitlistSignupBackend(" worker "), "worker");
  assert.throws(() => getWaitlistSignupBackend("other"), WaitlistSignupApiError);
});

test("submits the address only to the same-origin Worker with no-store and no credentials", async () => {
  let requestedUrl: URL | null = null;
  let requestInit: RequestInit | null = null;
  await submitWaitlistSignup("person@example.test", "invitation_page", {
    baseUrl,
    appBaseUrl: baseUrl,
    fetchImpl: async (input, init) => {
      requestedUrl = new URL(String(input));
      requestInit = init;
      return acceptedResponse();
    },
  });
  assert.equal(requestedUrl?.pathname, "/api/waitlist");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.credentials, "omit");
  assert.equal(requestInit?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    email: "person@example.test",
    referral_source: "invitation_page",
  });
});

test("does not accept a malformed success payload or non-202 status", async () => {
  await assert.rejects(() => submitWaitlistSignup("person@example.test", undefined, {
    baseUrl,
    appBaseUrl: baseUrl,
    fetchImpl: async () => acceptedResponse({ schemaVersion: 1, accepted: true, email: "person@example.test" }),
  }), (error: unknown) => error instanceof WaitlistSignupApiError && error.kind === "invalid_response");
  await assert.rejects(() => submitWaitlistSignup("person@example.test", undefined, {
    baseUrl,
    appBaseUrl: baseUrl,
    fetchImpl: async () => acceptedResponse({ error: "invalid_request" }, 400),
  }), (error: unknown) => error instanceof WaitlistSignupApiError && error.kind === "http" && error.status === 400);
});

test("refuses cross-origin Worker wiring and never falls back after a Worker failure", async () => {
  let called = false;
  await assert.rejects(() => submitWaitlistSignup("person@example.test", undefined, {
    baseUrl: "https://worker.example.test",
    appBaseUrl: baseUrl,
    fetchImpl: async () => { called = true; return acceptedResponse(); },
  }), (error: unknown) => error instanceof WaitlistSignupApiError && error.kind === "configuration");
  assert.equal(called, false);
  await assert.rejects(() => submitWaitlistSignup("person@example.test", undefined, {
    baseUrl,
    appBaseUrl: baseUrl,
    fetchImpl: async () => { throw new Error("synthetic network failure"); },
  }), (error: unknown) => error instanceof WaitlistSignupApiError && error.kind === "network");
});
