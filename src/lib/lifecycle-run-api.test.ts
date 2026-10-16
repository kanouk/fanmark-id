import assert from "node:assert/strict";
import test from "node:test";
import {
  getLifecycleRunBackend,
  LifecycleRunApiError,
  runLicenseExpiryInWorker,
} from "./lifecycle-run-api.ts";

const phase = (status: "completed" | "running" | "deferred_active_to_grace_running" | "deferred_page_budget", values: Record<string, unknown> = {}) => ({
  status,
  candidateCount: 3,
  processed: 2,
  conflicts: 1,
  pagesProcessed: 1,
  ...values,
});

const payload = {
  schemaVersion: 1,
  status: "in_progress",
  activeToGrace: phase("running"),
  graceFinalization: phase("deferred_page_budget", { candidateCount: 0, processed: 0, conflicts: 0, pagesProcessed: 0 }),
  pagesLimit: 4,
  elapsedMs: 125,
};

test("lifecycle batch backend defaults to Supabase and accepts only explicit Worker mode", () => {
  assert.equal(getLifecycleRunBackend(undefined), "supabase");
  assert.equal(getLifecycleRunBackend("worker"), "worker");
  assert.throws(() => getLifecycleRunBackend("fallback"), LifecycleRunApiError);
});

test("posts an empty credentialed same-origin request and validates only aggregate results", async () => {
  let seenRequest: Request | undefined;
  const result = await runLicenseExpiryInWorker({
    apiBaseUrl: "https://app.example.test",
    authBaseUrl: "https://app.example.test",
    fetcher: async (input, init) => {
      seenRequest = new Request(input, init);
      return Response.json(payload, { headers: { "cache-control": "no-store" } });
    },
  });
  assert.equal(result.status, "in_progress");
  assert.equal(result.activeToGrace.processed, 2);
  assert.equal(result.graceFinalization.status, "deferred_page_budget");
  assert.equal(seenRequest?.url, "https://app.example.test/api/admin/license-expiry/run");
  assert.equal(seenRequest?.method, "POST");
  assert.equal(seenRequest?.credentials, "include");
  assert.equal(seenRequest?.cache, "no-store");
  assert.equal(seenRequest?.body, null);
});

test("rejects cross-origin auth, inconsistent completion, and identifiers in the DTO", async () => {
  await assert.rejects(
    runLicenseExpiryInWorker({ apiBaseUrl: "https://api.example.test", authBaseUrl: "https://app.example.test" }),
    (error: unknown) => error instanceof LifecycleRunApiError && error.kind === "configuration",
  );
  await assert.rejects(
    runLicenseExpiryInWorker({
      apiBaseUrl: "https://app.example.test",
      authBaseUrl: "https://app.example.test",
      fetcher: async () => Response.json({ ...payload, status: "completed" }),
    }),
    (error: unknown) => error instanceof LifecycleRunApiError && error.kind === "invalid_response",
  );
  await assert.rejects(
    runLicenseExpiryInWorker({
      apiBaseUrl: "https://app.example.test",
      authBaseUrl: "https://app.example.test",
      fetcher: async () => Response.json({ ...payload, runId: "should-not-be-present" }),
    }),
    (error: unknown) => error instanceof LifecycleRunApiError && error.kind === "invalid_response",
  );
});

test("preserves Worker failures and does not fall back after an HTTP error", async () => {
  await assert.rejects(
    runLicenseExpiryInWorker({
      apiBaseUrl: "https://app.example.test",
      authBaseUrl: "https://app.example.test",
      fetcher: async () => Response.json({ error: "lifecycle_run_unavailable" }, { status: 503 }),
    }),
    (error: unknown) => error instanceof LifecycleRunApiError && error.kind === "http" && error.status === 503,
  );
});
