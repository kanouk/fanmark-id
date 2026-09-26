import assert from "node:assert/strict";
import test from "node:test";
import {
  getWaitlistAdminBackend,
  loadWaitlistAdmin,
  revealWaitlistAdminEmail,
  WaitlistAdminClientError,
} from "./waitlist-admin-api.ts";

const baseUrl = "https://app.example.test";
const id = "46111111-1111-4111-8111-111111111111";
const entry = {
  id,
  email_hash: "a".repeat(64),
  referral_source: "campaign",
  status: "waiting",
  created_at: "2026-09-25T12:00:00.000Z",
};
const securityLog = {
  id: "audit-1",
  action: "AUTHORIZED_WAITLIST_ACCESS",
  resource_type: "waitlist",
  created_at: "2026-09-27T12:34:56.000Z",
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

test("waitlist admin backend defaults to Supabase and accepts an explicit Worker selection", () => {
  assert.equal(getWaitlistAdminBackend(undefined), "supabase");
  assert.equal(getWaitlistAdminBackend(" worker "), "worker");
  assert.throws(() => getWaitlistAdminBackend("other"), WaitlistAdminClientError);
});

test("loads only hashed waitlist rows and safe audit projections through the same-origin Worker", async () => {
  let requestedUrl: URL | null = null;
  let requestInit: RequestInit | null = null;
  const snapshot = await loadWaitlistAdmin({
    baseUrl,
    authBaseUrl: baseUrl,
    fetchImpl: async (input, init) => {
      requestedUrl = new URL(String(input));
      requestInit = init;
      return jsonResponse({ schemaVersion: 1, entries: [entry], securityLogs: [securityLog] });
    },
  });
  assert.equal(requestedUrl?.pathname, "/api/admin/waitlist");
  assert.equal(requestInit?.credentials, "include");
  assert.equal(requestInit?.cache, "no-store");
  assert.deepEqual(snapshot, { entries: [entry], securityLogs: [securityLog] });
});

test("rejects raw addresses in the hashed-list response", async () => {
  await assert.rejects(() => loadWaitlistAdmin({
    baseUrl,
    authBaseUrl: baseUrl,
    fetchImpl: async () => jsonResponse({
      schemaVersion: 1,
      entries: [{ ...entry, email: "person@example.test" }],
      securityLogs: [],
    }),
  }), (error: unknown) => error instanceof WaitlistAdminClientError && error.kind === "invalid_response");
});

test("reveals a single address through its dedicated endpoint and validates the audit projection", async () => {
  let requestedUrl: URL | null = null;
  const result = await revealWaitlistAdminEmail(id, {
    baseUrl,
    authBaseUrl: baseUrl,
    fetchImpl: async (input) => {
      requestedUrl = new URL(String(input));
      return jsonResponse({ schemaVersion: 1, email: "person@example.test", securityLogs: [securityLog] });
    },
  });
  assert.equal(requestedUrl?.pathname, `/api/admin/waitlist/${id}/email`);
  assert.deepEqual(result, { email: "person@example.test", securityLogs: [securityLog] });
});

test("refuses cross-origin API/session wiring and malformed addresses", async () => {
  let called = false;
  await assert.rejects(() => loadWaitlistAdmin({
    baseUrl,
    authBaseUrl: "https://auth.example.test",
    fetchImpl: async () => { called = true; return jsonResponse({}); },
  }), (error: unknown) => error instanceof WaitlistAdminClientError && error.kind === "configuration");
  assert.equal(called, false);

  await assert.rejects(() => revealWaitlistAdminEmail(id, {
    baseUrl,
    authBaseUrl: baseUrl,
    fetchImpl: async () => jsonResponse({ schemaVersion: 1, email: "not-an-email", securityLogs: [] }),
  }), (error: unknown) => error instanceof WaitlistAdminClientError && error.kind === "invalid_response");
});
