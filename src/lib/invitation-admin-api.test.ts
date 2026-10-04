import assert from "node:assert/strict";
import test from "node:test";
import {
  createInvitationCode,
  deleteInvitationCode,
  getInvitationAdminBackend,
  InvitationAdminClientError,
  loadInvitationCodes,
  updateInvitationCode,
} from "./invitation-admin-api.ts";

const API_BASE = "https://api.example.test";
const CODE_ID = "46111111-1111-4111-8111-111111111111";
const TIME = "2026-09-25T12:00:00.000Z";
const code = {
  id: CODE_ID, code: "WELCOME", max_uses: 4, used_count: 1, expires_at: null, special_perks: { bonus: true },
  is_active: true, created_at: TIME, updated_at: TIME,
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("invitation admin selector defaults to Supabase and rejects unknown values", () => {
  assert.equal(getInvitationAdminBackend(undefined), "supabase");
  assert.equal(getInvitationAdminBackend(" worker "), "worker");
  assert.throws(() => getInvitationAdminBackend("d1"), InvitationAdminClientError);
});

test("loads only validated invitation fields using same-origin cookies and no cache", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const codes = await loadInvitationCodes({ baseUrl: API_BASE, authBaseUrl: API_BASE, fetchImpl: async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return response({ schemaVersion: 1, codes: [code] });
  } });
  assert.equal(capturedUrl, `${API_BASE}/api/admin/invitation-codes`);
  assert.equal(capturedInit?.credentials, "include");
  assert.equal(capturedInit?.cache, "no-store");
  assert.deepEqual(codes, [code]);
});

test("creates, compare-and-set patches, and deletes codes through separate methods", async () => {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = { url: String(input), method: String(init?.method), ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {}) };
    calls.push(call);
    if (call.method === "POST") return response({ schemaVersion: 1, code });
    if (call.method === "PATCH") return response({ schemaVersion: 1, code: { ...code, is_active: false } });
    return response({ schemaVersion: 1, deleted: true });
  };
  await createInvitationCode({ code: null, max_uses: 2, expires_at: null, special_perks: null }, { baseUrl: API_BASE, authBaseUrl: API_BASE, fetchImpl });
  const updated = await updateInvitationCode(CODE_ID, { is_active: false, expectedUpdatedAt: TIME }, { baseUrl: API_BASE, authBaseUrl: API_BASE, fetchImpl });
  assert.equal(updated.is_active, false);
  await deleteInvitationCode(CODE_ID, { baseUrl: API_BASE, authBaseUrl: API_BASE, fetchImpl });
  assert.deepEqual(calls.map(({ url, method }) => [url, method]), [
    [`${API_BASE}/api/admin/invitation-codes`, "POST"],
    [`${API_BASE}/api/admin/invitation-codes/${CODE_ID}`, "PATCH"],
    [`${API_BASE}/api/admin/invitation-codes/${CODE_ID}`, "DELETE"],
  ]);
  assert.deepEqual(calls[1]?.body, { is_active: false, expectedUpdatedAt: TIME });
});

test("rejects cross-origin auth, malformed DTOs, and preserves HTTP status", async () => {
  await assert.rejects(loadInvitationCodes({ baseUrl: API_BASE, authBaseUrl: "https://auth.example.test" }), InvitationAdminClientError);
  await assert.rejects(loadInvitationCodes({ baseUrl: API_BASE, authBaseUrl: API_BASE, fetchImpl: async () => response({ schemaVersion: 1, codes: [{ ...code, leaked: true }] }) }),
    (error: unknown) => error instanceof InvitationAdminClientError && error.kind === "invalid_response");
  await assert.rejects(loadInvitationCodes({ baseUrl: API_BASE, authBaseUrl: API_BASE, fetchImpl: async () => response({}, 403) }),
    (error: unknown) => error instanceof InvitationAdminClientError && error.kind === "http" && error.status === 403);
});
