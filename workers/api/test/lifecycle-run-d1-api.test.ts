import { describe, expect, it } from "vitest";
import {
  handleLifecycleRunRequest,
  type LifecycleRunAdminAuthorizer,
} from "../src/lifecycle-run-d1-api";
import type { Env } from "../src/repository";

const businessDatabase = {} as D1Database;
const baseEnv: Env = {
  AUTH_BACKEND: "better-auth",
  CORS_ALLOWED_ORIGINS: "https://app.example.test",
  D1_TOPOLOGY: "split",
  FANMARK_DB: businessDatabase,
  LIFECYCLE_RUN_BACKEND: "d1",
};

const allowAdmin: LifecycleRunAdminAuthorizer = async () => ({
  userId: "synthetic-admin",
  sessionId: "synthetic-session",
});
const denyAdmin: LifecycleRunAdminAuthorizer = async (_request, headers) =>
  new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers });

const summary = {
  runId: "private-run-id",
  capturedNow: "2026-09-27T00:00:00.000000Z",
  gracePeriodDays: 30,
  candidateCount: 4,
  processed: 3,
  conflicts: 1,
  status: "completed" as const,
  pagesProcessed: 1,
  pagesLimit: 4,
  graceFinalization: {
    runId: "private-finalization-id",
    capturedNow: "2026-09-27T00:00:00.000000Z",
    candidateCount: 7,
    processed: 6,
    conflicts: 1,
    status: "completed" as const,
    pagesProcessed: 2,
    results: [{ licenseId: "private-license-id", ownerEmail: "private@example.test" }],
  },
};

function request(
  init: RequestInit = { method: "POST" },
  requestEnv: Env = baseEnv,
  authorizeAdmin: LifecycleRunAdminAuthorizer = allowAdmin,
  run: typeof import("../src/license-expiry-scheduled.mjs").runScheduledLicenseExpiry = async () => summary,
): Promise<Response | null> {
  return handleLifecycleRunRequest(
    new Request("https://api.example.test/api/admin/license-expiry/run", init),
    requestEnv,
    authorizeAdmin,
    { now: (() => { let calls = 0; return () => 1000 + calls++ * 125; })(), run },
  );
}

describe("D1 manual lifecycle run API", () => {
  it("runs the existing lifecycle core against business D1 and returns aggregate-only results", async () => {
    let receivedOptions: Parameters<typeof import("../src/license-expiry-scheduled.mjs").runScheduledLicenseExpiry>[0] | undefined;
    const response = await request({ method: "POST", headers: { Origin: "https://app.example.test" } }, baseEnv, allowAdmin,
      async (options) => { receivedOptions = options; return summary; });

    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("access-control-allow-origin")).toBe("https://app.example.test");
    expect(receivedOptions?.database).toBe(businessDatabase);
    expect(receivedOptions?.scheduledTime).toBe(1000);
    expect(receivedOptions?.env.LICENSE_EXPIRY_BACKEND).toBe("d1");
    expect(baseEnv.LICENSE_EXPIRY_BACKEND).toBeUndefined();
    const body = await response?.text();
    expect(JSON.parse(body ?? "null")).toEqual({
      schemaVersion: 1,
      status: "completed",
      activeToGrace: { status: "completed", candidateCount: 4, processed: 3, conflicts: 1, pagesProcessed: 1 },
      graceFinalization: { status: "completed", candidateCount: 7, processed: 6, conflicts: 1, pagesProcessed: 2 },
      pagesLimit: 4,
      elapsedMs: 125,
    });
    expect(body).not.toContain("private-run-id");
    expect(body).not.toContain("private-finalization-id");
    expect(body).not.toContain("private-license-id");
    expect(body).not.toContain("private@example.test");
  });

  it("requires admin authorization and rejects unsafe request shapes before execution", async () => {
    let runCount = 0;
    const run = async () => { runCount += 1; return summary; };
    expect((await request({ method: "POST" }, baseEnv, denyAdmin, run))?.status).toBe(403);
    expect((await request({ method: "POST", body: "{}", headers: { "content-type": "application/json" } }, baseEnv, allowAdmin, run))?.status).toBe(400);
    expect((await request({ method: "GET" }, baseEnv, allowAdmin, run))?.status).toBe(405);
    expect((await request({ method: "POST", headers: { Origin: "https://evil.example" } }, baseEnv, allowAdmin, run))?.status).toBe(403);
    expect((await handleLifecycleRunRequest(
      new Request("https://api.example.test/api/admin/license-expiry/run?force=1", { method: "POST" }),
      baseEnv,
      allowAdmin,
      { run },
    ))?.status).toBe(404);
    expect(runCount).toBe(0);
  });

  it("accepts a zero-byte POST body stream and still rejects payload bytes", async () => {
    let runCount = 0;
    const run = async () => { runCount += 1; return summary; };
    const emptyStream = await request({ method: "POST", body: new Uint8Array(0) }, baseEnv, allowAdmin, run);
    expect(emptyStream?.status).toBe(200);

    const payload = await request({ method: "POST", body: "x" }, baseEnv, allowAdmin, run);
    expect(payload?.status).toBe(400);
    expect(runCount).toBe(1);
  });

  it("fails closed unless the manual selector, Better Auth, split topology, and business D1 are configured", async () => {
    let runCount = 0;
    const run = async () => { runCount += 1; return summary; };
    expect((await request({ method: "POST" }, { ...baseEnv, LIFECYCLE_RUN_BACKEND: undefined }, allowAdmin, run))?.status).toBe(503);
    expect((await request({ method: "POST" }, { ...baseEnv, LIFECYCLE_RUN_BACKEND: "supabase" }, allowAdmin, run))?.status).toBe(500);
    expect((await request({ method: "POST" }, { ...baseEnv, D1_TOPOLOGY: "legacy" }, allowAdmin, run))?.status).toBe(500);
    expect((await request({ method: "POST" }, { ...baseEnv, FANMARK_DB: undefined }, allowAdmin, run))?.status).toBe(500);
    expect((await request({ method: "POST" }, { ...baseEnv, AUTH_BACKEND: undefined }, allowAdmin, run))?.status).toBe(503);
    expect(runCount).toBe(0);
  });

  it("sanitizes runtime failures and preserves bounded continuation status", async () => {
    const failed = await request({ method: "POST" }, baseEnv, allowAdmin, async () => {
      throw new Error("private database detail");
    });
    expect(failed?.status).toBe(503);
    expect(await failed?.json()).toEqual({ error: "lifecycle_run_failed" });

    const inProgress = await request({ method: "POST" }, baseEnv, allowAdmin, async () => ({
      ...summary,
      status: "running" as const,
      graceFinalization: { status: "deferred_active_to_grace_running" as const },
    }));
    expect(inProgress?.status).toBe(200);
    expect(await inProgress?.json()).toMatchObject({
      status: "in_progress",
      activeToGrace: { status: "running" },
      graceFinalization: { status: "deferred_active_to_grace_running" },
    });
  });
});
