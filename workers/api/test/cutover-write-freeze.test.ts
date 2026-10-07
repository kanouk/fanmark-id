import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker, { handleRequest } from "../src/index";
import {
  blocksRequestDuringCutoverFreeze,
  cutoverWriteFreezeState,
  shouldPauseScheduledJobsForCutover,
} from "../src/cutover-write-freeze";
import type { Env } from "../src/repository";
import { shouldFreezeRecoveryWrites } from "../src/recovery-write-freeze";

const runtimeEnv = env as unknown as Env;

describe("recovery write freeze at the real Worker entrypoints", () => {
  it("blocks auth/session GETs, provider receipts, public routes and post-response wakes before any binding access", async () => {
    let accesses = 0;
    const denied = () => { accesses++; throw new Error("frozen_binding_access"); };
    const database = { prepare: denied } as unknown as D1Database;
    const assets = { fetch: denied } as unknown as Fetcher;
    const wake = { get: denied, idFromName: denied } as unknown as DurableObjectNamespace;
    const ctx = { waitUntil: denied } as unknown as ExecutionContext;
    for (const selector of ["true", "mistyped"]) {
      const frozen: Env = { ...runtimeEnv, RECOVERY_WRITE_FREEZE: selector, CUTOVER_WRITE_FREEZE: "false",
        FANMARK_DB: database, AUTH_DB: database, MASTER_DB: database, ASSETS: assets,
        NOTIFICATION_WAKE: wake, NOTIFICATION_WAKE_BACKEND: "durable-object" };
      for (const [method, path] of [
        ["POST", "/api/auth/sign-in/email"], ["GET", "/api/auth/get-session"],
        ["GET", "/api/auth/callback/google"], ["POST", "/api/stripe/webhook"],
        ["POST", "/api/webhooks/resend/broadcast-delivery"], ["GET", "/api/emoji/catalog"],
        ["GET", "/ogp/example"], ["GET", "/"], ["HEAD", "/"], ["OPTIONS", "/api/auth/sign-in/email"],
      ]) {
        const response = await worker.fetch(new Request(`https://app.example.test${path}`, { method }), frozen, ctx);
        expect(response.status).toBe(503);
        expect(response.headers.get("retry-after")).toBe("60");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ error: "recovery_write_freeze" });
      }
    }
    expect(accesses).toBe(0);
    expect(shouldFreezeRecoveryWrites(undefined)).toBe(false);
    expect(shouldFreezeRecoveryWrites("false")).toBe(false);
  });

  it("pauses Cron before diagnostic writes or background tasks on every configured schedule", async () => {
    let accesses = 0;
    const denied = () => { accesses++; throw new Error("frozen_scheduled_write"); };
    const database = { prepare: denied } as unknown as D1Database;
    const frozen = { ...runtimeEnv, RECOVERY_WRITE_FREEZE: "true", SCHEDULED_DISPATCH_DIAGNOSTICS: "true",
      SCHEDULED_DISPATCH_DIAGNOSTICS_DB: database, FANMARK_DB: database, AUTH_DB: database };
    for (const cron of ["* * * * *", "0 0 * * *", "0 1 * * *"]) {
      await worker.scheduled({ cron, scheduledTime: Date.now() } as ScheduledController,
        frozen, { waitUntil: denied } as unknown as ExecutionContext);
    }
    expect(accesses).toBe(0);
  });
});

describe("cutover write freeze", () => {
  it("defaults off, enables only on true, and fails closed for an unknown value", () => {
    expect(cutoverWriteFreezeState(undefined)).toBe("disabled");
    expect(cutoverWriteFreezeState("false")).toBe("disabled");
    expect(cutoverWriteFreezeState(" TRUE ")).toBe("enabled");
    expect(cutoverWriteFreezeState("enabled")).toBe("invalid");
    expect(shouldPauseScheduledJobsForCutover(undefined)).toBe(false);
    expect(shouldPauseScheduledJobsForCutover("enabled")).toBe(true);
  });

  it("blocks API writes, including administrative writes, while preserving narrow cutover traffic", () => {
    expect(blocksRequestDuringCutoverFreeze("POST", "/api/fanmarks/register", "true")).toBe(true);
    expect(blocksRequestDuringCutoverFreeze("PATCH", "/api/admin/system-settings/maintenance", "true")).toBe(true);
    expect(blocksRequestDuringCutoverFreeze("POST", "/api/auth/sign-up/email", "true")).toBe(true);
    expect(blocksRequestDuringCutoverFreeze("GET", "/api/auth/callback/google", "true")).toBe(true);

    expect(blocksRequestDuringCutoverFreeze("OPTIONS", "/api/auth/sign-in/email", "true")).toBe(false);
    expect(blocksRequestDuringCutoverFreeze("GET", "/api/auth/get-session", "true")).toBe(false);
    expect(blocksRequestDuringCutoverFreeze("POST", "/api/auth/sign-in/email", "true")).toBe(false);
    expect(blocksRequestDuringCutoverFreeze("POST", "/api/auth/two-factor/verify-totp", "true")).toBe(false);
    expect(blocksRequestDuringCutoverFreeze("POST", "/api/auth/two-factor/verify-backup-code", "true")).toBe(false);
    expect(blocksRequestDuringCutoverFreeze("POST", "/api/auth/sign-out", "true")).toBe(false);
    expect(blocksRequestDuringCutoverFreeze("POST", "/api/stripe/webhook", "true")).toBe(false);
    expect(blocksRequestDuringCutoverFreeze("OPTIONS", "/api/fanmarks/register", "true")).toBe(false);
    expect(blocksRequestDuringCutoverFreeze("GET", "/api/emoji/catalog", "true")).toBe(false);
  });

  it("blocks the public signup writer before any route handler runs", async () => {
    const response = await handleRequest(new Request("https://api.example.test/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "synthetic@example.test" }),
    }), {
      ...runtimeEnv,
      CUTOVER_WRITE_FREEZE: "true",
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "cutover_write_freeze" });
  });

  it("keeps the webhook receipt route reachable while blocking admin mutations", async () => {
    const frozenEnv = {
      ...runtimeEnv,
      CUTOVER_WRITE_FREEZE: "true",
      STRIPE_WEBHOOK_BACKEND: undefined,
    };
    const webhook = await handleRequest(new Request("https://api.example.test/api/stripe/webhook", {
      method: "POST",
      body: "{}",
    }), frozenEnv);
    expect(webhook.status).toBe(404);
    expect(await webhook.json()).toEqual({ error: "not_found" });

    const adminWrite = await handleRequest(new Request("https://api.example.test/api/admin/system-settings/maintenance", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maintenance_mode: false }),
    }), frozenEnv);
    expect(adminWrite.status).toBe(503);
    expect(await adminWrite.json()).toEqual({ error: "cutover_write_freeze" });
  });

  it("allows administrator sign-in traffic but blocks account creation", async () => {
    const frozenEnv = {
      ...runtimeEnv,
      CUTOVER_WRITE_FREEZE: "true",
      AUTH_BACKEND: undefined,
    };
    const signIn = await handleRequest(new Request("https://api.example.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "synthetic-admin@example.test", password: "unused" }),
    }), frozenEnv);
    expect(signIn.status).toBe(503);
    expect(await signIn.json()).toEqual({ error: "auth_unavailable" });

    const signUp = await handleRequest(new Request("https://api.example.test/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "synthetic-user@example.test" }),
    }), frozenEnv);
    expect(signUp.status).toBe(503);
    expect(await signUp.json()).toEqual({ error: "cutover_write_freeze" });
  });

  it("skips every scheduled job while frozen or misconfigured", async () => {
    const controller = { cron: "* * * * *", scheduledTime: 1 } as ScheduledController;
    let waitUntilCalls = 0;
    const ctx = { waitUntil: () => { waitUntilCalls += 1; } } as unknown as ExecutionContext;

    await worker.scheduled!(controller, { ...runtimeEnv, CUTOVER_WRITE_FREEZE: "true" }, ctx);
    await worker.scheduled!(controller, { ...runtimeEnv, CUTOVER_WRITE_FREEZE: "typo" }, ctx);

    expect(waitUntilCalls).toBe(0);
  });

  it("records Cron receipt and freeze state only through the explicit diagnostics binding", async () => {
    const events: Array<{ sql: string; values: unknown[] }> = [];
    const diagnosticsDatabase = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              run: async () => {
                events.push({ sql, values });
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const controller = { cron: "* * * * *", scheduledTime: 1_791_232_200_000 } as ScheduledController;
    const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

    await worker.scheduled!(controller, {
      ...runtimeEnv,
      CUTOVER_WRITE_FREEZE: "true",
      SCHEDULED_DISPATCH_DIAGNOSTICS: "true",
      SCHEDULED_DISPATCH_DIAGNOSTICS_DB: diagnosticsDatabase,
    }, ctx);

    expect(events.map(({ values }) => values[3])).toEqual(["received", "paused"]);
    expect(events.every(({ sql }) => sql.includes("migration_scheduled_dispatch_diagnostics"))).toBe(true);
    expect(JSON.parse(String(events[1]?.values[5]))).toEqual({ code: "cutover_write_freeze" });
  });

  it("records the selected Stripe job and its completion without enabling Stripe dispatch", async () => {
    const events: Array<{ values: unknown[] }> = [];
    const diagnosticsDatabase = {
      prepare() {
        return {
          bind(...values: unknown[]) {
            return {
              run: async () => {
                events.push({ values });
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const controller = { cron: "* * * * *", scheduledTime: 1_791_232_200_000 } as ScheduledController;
    const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;

    await worker.scheduled!(controller, {
      ...runtimeEnv,
      CUTOVER_WRITE_FREEZE: "false",
      SCHEDULED_DISPATCH_DIAGNOSTICS: "true",
      SCHEDULED_DISPATCH_DIAGNOSTICS_DB: diagnosticsDatabase,
      NOTIFICATION_PROCESSOR_BACKEND: undefined,
      STRIPE_DISPATCH_BACKEND: undefined,
      BROADCAST_EMAIL_BACKEND: undefined,
      BROADCAST_SEND_BACKEND: undefined,
    }, ctx);

    const stages = events.map(({ values }) => `${values[3]}:${values[4]}`);
    expect(stages).toContain("received:");
    expect(stages).toContain("selected:");
    expect(stages).toContain("job_started:stripe-webhook-dispatch");
    expect(stages).toContain("job_completed:stripe-webhook-dispatch");
    const selected = events.find(({ values }) => values[3] === "selected");
    expect(JSON.parse(String(selected?.values[5]))).toEqual({
      selectedJobs: ["notification-events", "stripe-webhook-dispatch"],
    });
    const completed = events.find(({ values }) => values[3] === "job_completed");
    expect(JSON.parse(String(completed?.values[5]))).toMatchObject({
      status: "disabled",
      claimed: 0,
      applied: 0,
    });
  });
});
