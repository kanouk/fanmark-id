import { describe, expect, it } from "vitest";
import worker, { handleRequest } from "../src/index";
import type { Env } from "../src/repository";
import { PRODUCTION_RUNTIME, PRODUCTION_STORE_IDS } from "../src/production-runtime-identity";
import { issueProductionOwnerAcceptance, productionOwnerAcceptanceAllowed,
  productionOwnerAcceptanceResponse } from "../src/production-owner-acceptance";
import { productionImportCommand } from "../src/production-import-coordinator";
import { productionR2ImportFetch } from "../src/production-r2-import-service";

function fixture() {
  const counts = { assets: 0, data: 0, inspect: 0, enter: 0, leave: 0, wake: 0 };
  let fenced = false, active = 0;
  const denied = () => { counts.data++; throw Error("datastore_must_not_be_touched"); };
  const namespace = { idFromName: () => "fixture", get: () => ({ fetch: async (input: string) => {
    const op = new URL(input).pathname.slice(1);
    if (op === "inspect") counts.inspect++;
    if (op === "enter") { counts.enter++; if (!fenced) active++; }
    if (op === "leave") { counts.leave++; active--; }
    return Response.json({ scope: PRODUCTION_RUNTIME.scope, active, initialized: true,
      owner: fenced ? "b6a4a64c-0667-4e6d-8040-1aa12e14cf27" : null, drained: fenced && active === 0 });
  } }) } as unknown as DurableObjectNamespace;
  const env: Env & { STAGING_BACKUP_SOURCE_IDS: string } = {
    BETTER_AUTH_URL: "https://fanmark.id", CUTOVER_WRITE_FREEZE: "receipt_only",
    PRODUCTION_OWNER_ACCEPTANCE_BACKEND: "owner-browser-v1", CF_VERSION_METADATA: { id: crypto.randomUUID() },
    D1_TOPOLOGY: "split", RECOVERY_DRAIN_BACKEND: "durable-object", RECOVERY_DRAIN: namespace,
    RECOVERY_DRAIN_SCOPE_DIGEST: PRODUCTION_RUNTIME.scope, STAGING_BACKUP_SOURCE_IDS: JSON.stringify(PRODUCTION_STORE_IDS),
    VERIFIED_ACCESS_SECRET: "a".repeat(64), AUTH_DB: { prepare: denied } as unknown as D1Database,
    FANMARK_DB: { prepare: denied } as unknown as D1Database, MASTER_DB: { prepare: denied } as unknown as D1Database,
    ASSETS: { fetch: async () => { counts.assets++; return new Response("private owner asset", { headers: { "cache-control": "public, max-age=3600" } }); } } as unknown as Fetcher,
    NOTIFICATION_WAKE_BACKEND: "durable-object", NOTIFICATION_WAKE: { idFromName: () => { counts.wake++; throw Error(); } } as unknown as DurableObjectNamespace,
  };
  const issue = () => issueProductionOwnerAcceptance(env, { runId: crypto.randomUUID(), expiresAt: Date.now() + 60_000 });
  const request = (token: string, path = "/", method = "GET", headers = {}) => new Request("https://fanmark.id" + path,
    { method, headers: { cookie: "__Host-fanmark-migration-owner=" + token, ...headers } });
  return { env, counts, issue, request, fence: () => { fenced = true; } };
}
describe("closed production owner acceptance", () => {
  it("default disabled and invalid/expired/version/key/host/duplicate-cookie tokens never reach a binding", async () => {
    const f = fixture(), g = await f.issue(), now = Date.now();
    for (const env of [{ ...f.env, PRODUCTION_OWNER_ACCEPTANCE_BACKEND: "disabled" },
      { ...f.env, VERIFIED_ACCESS_SECRET: "b".repeat(64) }, { ...f.env, CF_VERSION_METADATA: { id: crypto.randomUUID() } },
      { ...f.env, CUTOVER_WRITE_FREEZE: "mistyped" }, { ...f.env, RECOVERY_WRITE_FREEZE: "true" }]) {
      expect(await productionOwnerAcceptanceAllowed(f.request(g.token), env)).toBe(false);
    }
    expect(await productionOwnerAcceptanceAllowed(f.request(g.token), f.env, now + 120_000)).toBe(false);
    for (const request of [new Request("https://fanmark.id/"), f.request("forged"),
      f.request(g.token, "/", "GET", { cookie: "__Host-fanmark-migration-owner=" + g.token + "; __Host-fanmark-migration-owner=" + g.token }),
      new Request("https://evil.invalid/", { headers: { cookie: "__Host-fanmark-migration-owner=" + g.token } })]) {
      expect(await productionOwnerAcceptanceAllowed(request, f.env)).toBe(false);
    }
    for (const request of [new Request("https://fanmark.id/"), f.request("forged")]) expect((await worker.fetch(request, f.env)).status).toBe(503);
    expect(Object.values(f.counts).reduce((a, b) => a + b, 0)).toBe(0);
    for (const input of [{ runId: crypto.randomUUID(), expiresAt: now + 600_001 },
      { runId: "invalid", expiresAt: now + 1000 }, { runId: crypto.randomUUID(), expiresAt: now - 1 }])
      await expect(issueProductionOwnerAcceptance(f.env, input, now)).rejects.toThrow();
  });
  it("exchanges only exact-origin empty POST and supports Apple's form POST with a host-only private cookie", async () => {
    const f = fixture(), g = await f.issue();
    const grant = (changes: RequestInit = {}, path = "/api/migration/owner-session") => new Request("https://fanmark.id" + path,
      { method: "POST", headers: { authorization: "Bearer " + g.token, origin: "https://fanmark.id" }, ...changes });
    const response = await worker.fetch(grant(), f.env), cookie = response.headers.get("set-cookie")!;
    expect(response.status).toBe(204); expect(cookie).toContain("Secure; HttpOnly; SameSite=None; Max-Age=");
    expect(cookie).not.toContain("Domain="); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await productionOwnerAcceptanceAllowed(f.request(g.token, "/api/auth/callback/apple", "POST", { origin: "https://appleid.apple.com" }), f.env)).toBe(true);
    for (const request of [grant({ body: "x" }), grant({ method: "GET" }), grant({ headers: { authorization: "Bearer " + g.token, origin: "https://evil.invalid" } }), grant({}, "/api/migration/owner-session?x=1")])
      expect((await productionOwnerAcceptanceResponse(request, f.env))!.status).not.toBe(204);
    const bootstrap = await worker.fetch(new Request("https://fanmark.id/__migration/owner"), f.env);
    expect(bootstrap.status).toBe(200); expect(bootstrap.headers.get("content-security-policy")).toContain("script-src 'sha256-");
    expect(await bootstrap.text()).toContain("history.replaceState");
    expect(Object.values(f.counts).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it("only the admitted browser sees no-store assets, while recovery fences still close it", async () => {
    const f = fixture(), g = await f.issue();
    for (const entry of [worker.fetch, handleRequest]) {
      const response = await entry(f.request(g.token), f.env);
      expect(response.status).toBe(200); expect(await response.text()).toBe("private owner asset");
      expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("vary")).toContain("Cookie");
    }
    expect(f.counts.assets).toBe(2); expect(f.counts.inspect).toBe(1); expect(f.counts.data).toBe(0);
    expect((await worker.fetch(new Request("https://fanmark.id/"), f.env)).status).toBe(503);
    f.fence();expect((await worker.fetch(f.request(g.token), f.env)).status).toBe(503);
    expect(f.counts.assets).toBe(2); expect(f.counts.enter).toBe(0); expect(f.counts.wake).toBe(0);
  });
  it("private requests keep normal API/auth routing and writer enter/leave, without waking the dispatcher", async () => {
    const f = fixture(), g = await f.issue();
    const response = await worker.fetch(f.request(g.token, "/api/not-a-real-business-endpoint", "POST"), f.env);
    expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.counts.enter).toBe(1); expect(f.counts.leave).toBe(1); expect(f.counts.data).toBe(0); expect(f.counts.wake).toBe(0);
    expect((await worker.fetch(f.request(g.token, "/api/auth/get-session"), f.env)).status).not.toBe(200);
    expect(f.counts.wake).toBe(0);
    expect(f.env.CUTOVER_WRITE_FREEZE).toBe("receipt_only");
    await worker.scheduled({ cron: "* * * * *", scheduledTime: Date.now() } as ScheduledController,
      f.env, { waitUntil: () => { throw Error("scheduled_work_must_stay_closed"); } } as unknown as ExecutionContext);
    expect(f.counts.data).toBe(0); expect(f.counts.wake).toBe(0);
  });
  it("private acceptance cannot overlap import mutations or create a new import claim", async () => {
    const f = fixture(), blocked = () => { f.counts.data++; throw Error("import_must_remain_closed"); };
    const ctx = { id: { toString: () => "fixture" }, storage: { get: blocked, put: blocked } } as unknown as DurableObjectState;
    const response = await productionImportCommand(ctx, f.env,
      new Request("https://recovery-writer.internal/migration/claim", { method: "POST", body: "{}" }));
    expect(response.status).toBe(409);
    const r2 = await productionR2ImportFetch(new Request("https://production-import-r2.internal/object?store=avatars&key=x", {
      method: "PUT", headers: { "x-fanmark-import-runtime": f.env.CF_VERSION_METADATA!.id }, body: "x" }),
      { ...f.env, STORAGE_BACKEND: "r2", AVATARS_BUCKET: { put: blocked } as unknown as R2Bucket,
        COVER_IMAGES_BUCKET: { put: blocked } as unknown as R2Bucket });
    expect(r2.status).toBe(409); expect(f.counts.data).toBe(0);
  });
});

it('G5 Resend ingress keeps its signature check, normal writer guard and exact path; public pages stay closed',async()=>{
 const f=fixture();f.env.BROADCAST_EMAIL_BACKEND='d1';f.env.BROADCAST_WEBHOOK_BACKEND='d1';
 f.env.BROADCAST_WEBHOOK_SIGNING_SECRET='whsec_'+btoa('a'.repeat(32));
 const response=await worker.fetch(new Request('https://fanmark.id/api/webhooks/resend/broadcast-delivery',{method:'POST',body:'{}'}),f.env);
 expect(response.status).toBe(400);expect(await response.json()).toEqual({error:'invalid_webhook'});
 expect(f.counts.enter).toBe(1);expect(f.counts.leave).toBe(1);expect(f.counts.data).toBe(0);expect(f.counts.wake).toBe(0);
 for(const url of ['https://fanmark.id/','https://fanmark.id/api/webhooks/resend/broadcast-delivery?x=1','https://fanmark.id/api/webhooks/resend/broadcast-delivery/'])
  expect((await worker.fetch(new Request(url),f.env)).status).toBe(503);
 const disabled={...f.env,PRODUCTION_OWNER_ACCEPTANCE_BACKEND:'disabled'};
 expect((await worker.fetch(new Request('https://fanmark.id/api/webhooks/resend/broadcast-delivery',{method:'POST',body:'{}'}),disabled)).status).toBe(503);
 expect(f.counts.enter).toBe(1);expect(f.counts.data).toBe(0);
});
