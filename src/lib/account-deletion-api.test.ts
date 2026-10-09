import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountDeletionApiError,
  buildAccountDeletionApiUrl,
  deleteAccountThroughWorker,
  getAccountDeletionBackend,
} from "./account-deletion-api.ts";

test("account deletion defaults to Supabase and rejects unknown selectors", () => {
  assert.equal(getAccountDeletionBackend(undefined), "supabase");
  assert.equal(getAccountDeletionBackend("worker"), "worker");
  assert.throws(() => getAccountDeletionBackend("unknown"), AccountDeletionApiError);
});

test("account deletion URL uses only a clean Worker origin", () => {
  assert.equal(
    String(buildAccountDeletionApiUrl("https://api.example.test")),
    "https://api.example.test/api/me/account/delete",
  );
  assert.throws(() => buildAccountDeletionApiUrl("https://api.example.test/prefix?token=secret#fragment"), AccountDeletionApiError);
});

test("Worker deletion sends exact confirmation, password, and same-origin credentials", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  await deleteAccountThroughWorker("synthetic-current-password", {
    backend: "worker",
    baseUrl: "https://api.example.test",
    authBaseUrl: "https://api.example.test",
    timeoutMs: 2_000,
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ success: true, message: "Account deleted successfully" }), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.example.test/api/me/account/delete");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.credentials, "include");
  assert.equal(requests[0].init.cache, "no-store");
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), {
    confirmation: "DELETE",
    password: "synthetic-current-password",
  });
});

test("Worker deletion rejects cross-origin auth, errors, and malformed success without fallback", async () => {
  await assert.rejects(
    deleteAccountThroughWorker("password", { backend: "worker", baseUrl: "https://api.example.test", authBaseUrl: "https://auth.example.test" }),
    AccountDeletionApiError,
  );
  let calls = 0;
  await assert.rejects(
    deleteAccountThroughWorker("password", {
      backend: "worker",
      baseUrl: "https://api.example.test",
      authBaseUrl: "https://api.example.test",
      fetchImpl: async () => { calls += 1; return new Response("denied", { status: 503 }); },
    }),
    (error: unknown) => error instanceof AccountDeletionApiError && error.status === 503,
  );
  await assert.rejects(
    deleteAccountThroughWorker("password", {
      backend: "worker",
      baseUrl: "https://api.example.test",
      authBaseUrl: "https://api.example.test",
      fetchImpl: async () => new Response(JSON.stringify({ success: true, message: "User deleted" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    }),
    AccountDeletionApiError,
  );
  assert.equal(calls, 1);
});
