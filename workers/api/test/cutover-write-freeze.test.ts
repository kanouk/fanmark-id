import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker, { handleRequest } from "../src/index";
import {
  blocksRequestDuringCutoverFreeze,
  cutoverWriteFreezeState,
  shouldPauseScheduledJobsForCutover,
} from "../src/cutover-write-freeze";
import type { Env } from "../src/repository";

const runtimeEnv = env as unknown as Env;

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
});
