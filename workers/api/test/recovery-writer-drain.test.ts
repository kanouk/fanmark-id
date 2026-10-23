import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import worker from "../src/index";
import { assertRecoveryWriterFence, claimRecoveryWriterFence, releaseRecoveryWriterFence,
  inspectRecoveryWriters, settleRecoveryWriterTasks, withRecoveryRead, withRecoveryWriter } from "../src/recovery-writer-drain";
import type { Env } from "../src/repository";

const runtime = env as unknown as Env;
const namespace = runtime.RECOVERY_DRAIN!;
const gate = namespace.get(namespace.idFromName("recovery-writers-v1"));
const wake = runtime.NOTIFICATION_WAKE!.get(runtime.NOTIFICATION_WAKE!.idFromName("business-notification-events-v1"));
const db = runtime.FANMARK_DB!;
const owner = "00000000-0000-4000-8000-000000000001";
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeAll(async () => {
  await db.prepare("CREATE TABLE drain_fixture (id INTEGER PRIMARY KEY)").run();
  await db.prepare("CREATE TABLE system_settings (setting_key TEXT, setting_value TEXT, is_public INTEGER)").run();
  await db.prepare(`CREATE TABLE notification_worker_wake_state
    (singleton_id INTEGER PRIMARY KEY, requested_generation INTEGER, acknowledged_generation INTEGER)`).run();
});
beforeEach(async () => {
  await runInDurableObject(gate, async (_instance, state) => { await state.storage.deleteAll(); });
  await runInDurableObject(wake, async (_instance, state) => { await state.storage.deleteAlarm(); });
  await db.prepare("DELETE FROM drain_fixture").run();
  await db.prepare("INSERT OR REPLACE INTO notification_worker_wake_state VALUES (1, 1, 0)").run();
});

it("inspects the native census without initializing, fencing or changing writer state", async () => {
  const stored = () => runInDurableObject(gate, async (_instance, state) => [...await state.storage.list()]);
  expect(await stored()).toEqual([]);
  expect(await inspectRecoveryWriters(runtime)).toEqual({ owner: null, scope: runtime.RECOVERY_DRAIN_SCOPE_DIGEST,
    active: 0, drained: false, initialized: false, tickets: { scanned: 0, complete: true, legacy: 0,
      attributed: 0, oldestEnteredAt: null, runtimeRevisions: {}, kinds: {} } });
  expect(await stored()).toEqual([]);

  const entered = signal(), finish = signal();
  const work = withRecoveryWriter(runtime, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  const activeStorage = await stored();
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ owner: null, active: 1, drained: false, initialized: true });
  expect(await stored()).toEqual(activeStorage);
  await expect(inspectRecoveryWriters({ ...runtime, RECOVERY_DRAIN_SCOPE_DIGEST: "b".repeat(64) }))
    .rejects.toThrow("recovery_writer_unavailable");
  expect(await stored()).toEqual(activeStorage);
  finish.resolve(); await work;
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ owner: null, active: 0, drained: false, initialized: true });

  await claimRecoveryWriterFence(runtime, owner);
  const fencedStorage = await stored();
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ owner, active: 0, drained: true, initialized: true });
  expect(await stored()).toEqual(fencedStorage);
  await releaseRecoveryWriterFence(runtime, owner);
  await withRecoveryWriter(runtime, async () => { await db.prepare("INSERT INTO drain_fixture VALUES (5)").run(); });
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ owner: null, active: 0, drained: false });
  expect((await db.prepare("SELECT id FROM drain_fixture").all()).results).toEqual([{ id: 5 }]);
});

it("admits delayed static reads without a writer ticket and still tracks HTTP post-response writes", async () => {
  const httpEntered = signal(), httpFinish = signal();
  const http = worker.fetch(new Request("https://app.example.test/"), { ...runtime,
    ASSETS: { async fetch() { httpEntered.resolve(); await httpFinish.promise; return new Response("synthetic"); } } as unknown as Fetcher,
  });
  await httpEntered.promise;
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ active: 0, initialized: false });
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 0, drained: true });
  let lateAssetCalls = 0;
  const refused = await worker.fetch(new Request("https://app.example.test/assets/late.js"), { ...runtime,
    ASSETS: { async fetch() { lateAssetCalls++; return new Response("must not read"); } } as unknown as Fetcher,
  });
  expect(refused.status).toBe(503); expect(lateAssetCalls).toBe(0);
  httpFinish.resolve(); expect((await http).status).toBe(200);
  await assertRecoveryWriterFence(runtime, owner); await releaseRecoveryWriterFence(runtime, owner);

  const wakeEntered = signal(), wakeFinish = signal();
  const lifecycles: Promise<unknown>[] = [];
  const post = worker.fetch(new Request("https://app.example.test/api/unknown-synthetic-route", { method: "POST" }), {
    ...runtime, NOTIFICATION_WAKE: {
      idFromName: runtime.NOTIFICATION_WAKE!.idFromName.bind(runtime.NOTIFICATION_WAKE),
      get() { return { async fetch() {
        wakeEntered.resolve(); await wakeFinish.promise;
        await db.prepare("INSERT INTO drain_fixture VALUES (4)").run();
        return new Response(null, { status: 204 });
      } }; },
    } as unknown as DurableObjectNamespace,
  }, { waitUntil(work: Promise<unknown>) { lifecycles.push(work); } } as unknown as ExecutionContext);
  await wakeEntered.promise;
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 1, drained: false });
  expect(lifecycles).toHaveLength(1);
  expect((await db.prepare("SELECT count(*) AS n FROM drain_fixture").first())?.n).toBe(0);
  wakeFinish.resolve(); expect((await post).status).toBe(404);
  await Promise.all(lifecycles);
  await assertRecoveryWriterFence(runtime, owner);
  expect((await db.prepare("SELECT id FROM drain_fixture").first())?.id).toBe(4);
  await releaseRecoveryWriterFence(runtime, owner);
});

it("read admission holds the native scope/fence checks without initializing or removing tickets", async () => {
  const stored = () => runInDurableObject(gate, async (_instance, state) => [...await state.storage.list()]);
  let readCalls = 0;
  expect(await withRecoveryRead(runtime, async () => { readCalls++; return "read"; })).toBe("read");
  expect(await stored()).toEqual([]);
  await expect(withRecoveryRead({ ...runtime, RECOVERY_DRAIN_SCOPE_DIGEST: "b".repeat(64) }, async () => { readCalls++; }))
    .rejects.toThrow("recovery_writer_unavailable");
  expect(readCalls).toBe(1);
  const entered = signal(), finish = signal();
  const work = withRecoveryWriter(runtime, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  const beforeRead = await stored();
  await withRecoveryRead(runtime, async () => { readCalls++; });
  expect(await stored()).toEqual(beforeRead);
  await claimRecoveryWriterFence(runtime, owner);
  const fenced = await stored();
  await expect(withRecoveryRead(runtime, async () => { readCalls++; })).rejects.toThrow("recovery_writer_unavailable");
  expect(readCalls).toBe(2); expect(await stored()).toEqual(fenced);
  finish.resolve(); await work;
  await assertRecoveryWriterFence(runtime, owner);
  await releaseRecoveryWriterFence(runtime, owner);
});

it("public Master reads leave no tickets and freeze/configuration failures still refuse before reading", async () => {
  for (const path of ["/api/emoji/catalog", "/api/reference-masters/tiers"]) {
    const response = await worker.fetch(new Request(`https://app.example.test${path}`), runtime);
    expect(response.status).not.toBe(200); // This fixture has no configured Master, so no fallback is permitted.
    expect(await inspectRecoveryWriters(runtime)).toMatchObject({ active: 0, initialized: false });
  }
  let assetCalls = 0;
  for (const override of [{ RECOVERY_WRITE_FREEZE: "true" }, { RECOVERY_DRAIN_SCOPE_DIGEST: "b".repeat(64) }]) {
    const response = await worker.fetch(new Request("https://app.example.test/auth"), { ...runtime, ...override,
      ASSETS: { async fetch() { assetCalls++; return new Response("must not read"); } } as unknown as Fetcher,
    });
    expect(response.status).toBe(503);
  }
  expect(assetCalls).toBe(0);
});

it("fences HTTP, Cron and a real notification alarm while waiting for an existing native D1 writer", async () => {
  const entered = signal(), finish = signal();
  const work = withRecoveryWriter(runtime, async () => {
    entered.resolve(); await finish.promise;
    await db.prepare("INSERT INTO drain_fixture VALUES (1)").run();
  });
  await entered.promise;
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 1, drained: false, owner });
  await expect(assertRecoveryWriterFence(runtime, owner)).rejects.toThrow("recovery_writer_unavailable");
  let lateCalls = 0;
  await expect(withRecoveryWriter(runtime, async () => { lateCalls++; })).rejects.toThrow("recovery_writer_unavailable");
  expect(lateCalls).toBe(0);
  for (const [method, path] of [["GET", "/api/auth/get-session"], ["POST", "/api/stripe/webhook"]]) {
    const response = await worker.fetch(new Request(`https://app.example.test${path}`, { method }), runtime);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "recovery_writer_unavailable" });
  }
  let diagnostics = 0;
  await worker.scheduled({ cron: "* * * * *", scheduledTime: Date.now() } as ScheduledController,
    { ...runtime, SCHEDULED_DISPATCH_DIAGNOSTICS: "true",
      SCHEDULED_DISPATCH_DIAGNOSTICS_DB: { prepare() { diagnostics++; throw new Error("must_not_write"); } } as unknown as D1Database },
    { waitUntil() {} } as unknown as ExecutionContext);
  expect(diagnostics).toBe(0);
  expect((await wake.fetch("https://notification-wake.internal/wake", { method: "POST" })).status).toBe(503);
  await runInDurableObject(wake, async (_instance, state) => { await state.storage.setAlarm(Date.now() + 1000); });
  expect(await runDurableObjectAlarm(wake)).toBe(true);
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 1, drained: false });
  expect((await db.prepare("SELECT count(*) AS n FROM drain_fixture").first())?.n).toBe(0);
  finish.resolve(); await work;
  await assertRecoveryWriterFence(runtime, owner);
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 0, drained: true });
  await releaseRecoveryWriterFence(runtime, owner);
  await withRecoveryWriter(runtime, async () => { await db.prepare("INSERT INTO drain_fixture VALUES (2)").run(); });
  expect((await db.prepare("SELECT id FROM drain_fixture ORDER BY id").all()).results).toEqual([{ id: 1 }, { id: 2 }]);
});

it("keeps a ticket after an unknown enter acknowledgement and never ages it into a false empty census", async () => {
  let ticket = "", executions = 0;
  const lostAck = { ...runtime, RECOVERY_DRAIN: {
    idFromName: namespace.idFromName.bind(namespace),
    get(id: DurableObjectId) {
      const native = namespace.get(id);
      return { async fetch(input: string, init: RequestInit) {
        const response = await native.fetch(input, init);
        if (input.endsWith("/enter")) { ticket = JSON.parse(String(init.body)).id; throw new Error("synthetic_lost_ack"); }
        return response;
      } };
    },
  } as unknown as DurableObjectNamespace };
  await expect(withRecoveryWriter(lostAck, async () => { executions++; })).rejects.toThrow("recovery_writer_unavailable");
  expect(executions).toBe(0);
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 1, drained: false });
  await expect(releaseRecoveryWriterFence(runtime, "00000000-0000-4000-8000-000000000002"))
    .rejects.toThrow("recovery_writer_unavailable");
  await expect(assertRecoveryWriterFence(runtime, owner)).rejects.toThrow("recovery_writer_unavailable");
  // Only this known test ticket, whose operation demonstrably never started, is removed.
  expect((await gate.fetch("https://recovery-writer.internal/leave", { method: "POST",
    body: JSON.stringify({ id: ticket, scope: runtime.RECOVERY_DRAIN_SCOPE_DIGEST }) })).status).toBe(200);
  await assertRecoveryWriterFence(runtime, owner);
  await releaseRecoveryWriterFence(runtime, owner);
});

it("holds the writer through sibling failure until all background tasks have actually settled", async () => {
  const entered = signal(), finish = signal();
  const work = withRecoveryWriter(runtime, async () => {
    entered.resolve();
    await settleRecoveryWriterTasks([
      Promise.reject(new Error("synthetic_job_failed")),
      (async () => { await finish.promise; await db.prepare("INSERT INTO drain_fixture VALUES (3)").run(); })(),
    ]);
  });
  work.catch(() => {});
  await entered.promise;
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 1, drained: false });
  await expect(assertRecoveryWriterFence(runtime, owner)).rejects.toThrow("recovery_writer_unavailable");
  finish.resolve(); await expect(work).rejects.toThrow("synthetic_job_failed");
  await assertRecoveryWriterFence(runtime, owner);
  expect((await db.prepare("SELECT id FROM drain_fixture").first())?.id).toBe(3);
  await releaseRecoveryWriterFence(runtime, owner);
});

it("preserves two concurrent writer entries and refuses another scope or fence owner", async () => {
  const a = signal(), b = signal(), ea = signal(), eb = signal();
  const first = withRecoveryWriter(runtime, async () => { ea.resolve(); await a.promise; });
  const second = withRecoveryWriter(runtime, async () => { eb.resolve(); await b.promise; });
  await Promise.all([ea.promise, eb.promise]);
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 2, drained: false });
  await expect(claimRecoveryWriterFence({ ...runtime, RECOVERY_DRAIN_SCOPE_DIGEST: "b".repeat(64) }, owner))
    .rejects.toThrow("recovery_writer_unavailable");
  await expect(claimRecoveryWriterFence(runtime, "00000000-0000-4000-8000-000000000002"))
    .rejects.toThrow("recovery_writer_unavailable");
  a.resolve(); await first;
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 1, drained: false });
  b.resolve(); await second;
  await assertRecoveryWriterFence(runtime, owner);
  await releaseRecoveryWriterFence(runtime, owner);
});

it("registers enter, work and leave as one protected lifecycle before the enter acknowledgement", async () => {
  const entered = signal(), enterAck = signal(), leaveStarted = signal(), leaveAck = signal();
  const protectedWork: Promise<unknown>[] = [];
  let operations = 0, protectedFinished = false;
  const delayed = { ...runtime, RECOVERY_DRAIN: {
    idFromName: namespace.idFromName.bind(namespace),
    get(id: DurableObjectId) {
      const native = namespace.get(id);
      return { async fetch(input: string, init: RequestInit) {
        if (input.endsWith("/leave")) { leaveStarted.resolve(); await leaveAck.promise; }
        const response = await native.fetch(input, init);
        if (input.endsWith("/enter")) { entered.resolve(); await enterAck.promise; }
        return response;
      } };
    },
  } as unknown as DurableObjectNamespace };
  const caller = withRecoveryWriter(delayed, async () => {
    operations++;
    await db.prepare("INSERT INTO drain_fixture VALUES (8)").run();
  }, { waitUntil(promise) { protectedWork.push(promise); promise.then(() => { protectedFinished = true; }); } });
  expect(protectedWork).toHaveLength(1);
  await entered.promise;
  expect(operations).toBe(0);
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ active: 1 });
  enterAck.resolve(); await leaveStarted.promise;
  expect(operations).toBe(1); expect(protectedFinished).toBe(false);
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ active: 1 });
  leaveAck.resolve(); await protectedWork[0]; await caller;
  expect(protectedFinished).toBe(true);
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ active: 0 });
  expect((await db.prepare("SELECT id FROM drain_fixture").first())?.id).toBe(8);
});

it("reports legacy and attributed tickets without expiring, removing or exposing their IDs", async () => {
  const legacyId = "00000000-0000-4000-8000-000000000009";
  await runInDurableObject(gate, async (_instance, state) => {
    await state.storage.put({ scope: runtime.RECOVERY_DRAIN_SCOPE_DIGEST, active: 1,
      ["writer:" + legacyId]: true });
  });
  const entered = signal(), finish = signal(), revision = "00000000-0000-4000-8000-000000000010";
  const work = withRecoveryWriter({ ...runtime, CF_VERSION_METADATA: { id: revision } }, async () => {
    entered.resolve(); await finish.promise;
  });
  await entered.promise;
  const before = await runInDurableObject(gate, async (_instance, state) => [...await state.storage.list()]);
  const inspection = await inspectRecoveryWriters(runtime);
  expect(inspection).toMatchObject({ active: 2, tickets: { scanned: 2, complete: true, legacy: 1,
    attributed: 1, runtimeRevisions: { [revision]: 1 } } });
  expect(inspection.tickets.oldestEnteredAt).toBeTypeOf("number");
  expect(JSON.stringify(inspection)).not.toContain(legacyId);
  expect(await runInDurableObject(gate, async (_instance, state) => [...await state.storage.list()])).toEqual(before);
  finish.resolve(); await work;
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 1, drained: false });
  await expect(assertRecoveryWriterFence(runtime, owner)).rejects.toThrow("recovery_writer_unavailable");
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ tickets: { legacy: 1, attributed: 0 } });
});

it("retries only completed leave with fresh stubs after a transient failure before commit", async () => {
  let leaves = 0, stubs = 0, operations = 0;
  const retrying = { ...runtime, RECOVERY_DRAIN: {
    idFromName: namespace.idFromName.bind(namespace),
    get() { stubs++; return { async fetch(input: string, init: RequestInit) {
      if (input.endsWith('/leave') && ++leaves === 1) throw new Error('synthetic unavailable');
      return gate.fetch(input, init);
    } }; },
  } as unknown as DurableObjectNamespace };
  await withRecoveryWriter(retrying, async () => {
    operations++;
    await db.prepare('INSERT INTO drain_fixture VALUES (20)').run();
  }, undefined, 'http');
  expect(operations).toBe(1); expect(leaves).toBe(2); expect(stubs).toBe(3);
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ active: 0 });
  expect((await db.prepare('SELECT COUNT(*) n FROM drain_fixture WHERE id=20').first())?.n).toBe(1);
});

it("survives a lost leave acknowledgement without decrementing another still-running writer", async () => {
  const entered = signal(), finish = signal();
  const other = withRecoveryWriter(runtime, async () => { entered.resolve(); await finish.promise; }, undefined, 'scheduled');
  await entered.promise;
  let leaves = 0, operations = 0;
  const lostAck = { ...runtime, RECOVERY_DRAIN: {
    idFromName: namespace.idFromName.bind(namespace),
    get() { return { async fetch(input: string, init: RequestInit) {
      const response = await gate.fetch(input, init);
      if (input.endsWith('/leave') && ++leaves === 1) throw new Error('synthetic lost acknowledgement');
      return response;
    } }; },
  } as unknown as DurableObjectNamespace };
  await withRecoveryWriter(lostAck, async () => { operations++; }, undefined, 'http');
  expect(operations).toBe(1); expect(leaves).toBe(2);
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 1, drained: false });
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ tickets: { kinds: { scheduled: 1 } } });
  await expect(assertRecoveryWriterFence(runtime, owner)).rejects.toThrow('recovery_writer_unavailable');
  finish.resolve(); await other; await assertRecoveryWriterFence(runtime, owner);
});

it("bounds failed leave retries and keeps the unresolved ticket and backup refusal", async () => {
  let leaves = 0, operations = 0;
  const failed = { ...runtime, RECOVERY_DRAIN: {
    idFromName: namespace.idFromName.bind(namespace),
    get() { return { async fetch(input: string, init: RequestInit) {
      if (input.endsWith('/leave')) { leaves++; throw new Error('synthetic unavailable'); }
      return gate.fetch(input, init);
    } }; },
  } as unknown as DurableObjectNamespace };
  await expect(withRecoveryWriter(failed, async () => { operations++; }, undefined, 'notification-alarm'))
    .rejects.toThrow('recovery_writer_unavailable');
  expect(operations).toBe(1); expect(leaves).toBe(3);
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 1, drained: false });
  const before = await runInDurableObject(gate, async (_instance, state) => [...await state.storage.list()]);
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ tickets: { kinds: { 'notification-alarm': 1 } } });
  expect(await runInDurableObject(gate, async (_instance, state) => [...await state.storage.list()])).toEqual(before);
  await expect(assertRecoveryWriterFence(runtime, owner)).rejects.toThrow('recovery_writer_unavailable');
});

it("attributes older tickets to unknown and rejects invalid kind metadata without changing storage", async () => {
  const id = '00000000-0000-4000-8000-000000000011';
  await runInDurableObject(gate, async (_instance, state) => {
    await state.storage.put({ scope: runtime.RECOVERY_DRAIN_SCOPE_DIGEST, active: 1,
      ['writer:'+id]: { enteredAt: 1, runtimeRevision: 'old' } });
  });
  const before = await runInDurableObject(gate, async (_instance, state) => [...await state.storage.list()]);
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ active: 1, tickets: { kinds: { unknown: 1 } } });
  expect((await gate.fetch('https://recovery-writer.internal/enter', { method: 'POST', body: JSON.stringify({
    id: owner, scope: runtime.RECOVERY_DRAIN_SCOPE_DIGEST, runtimeRevision: 'new', kind: '/private/path' }) })).status).toBe(400);
  expect(await runInDurableObject(gate, async (_instance, state) => [...await state.storage.list()])).toEqual(before);
});

it("rejects a legacy object without changing its census when the binding points to a fresh object", async () => {
  await claimRecoveryWriterFence(runtime, owner);
  await runInDurableObject(gate, async (instance, state) => {
    const local = (instance as unknown as { env: Env }).env;
    const original = local.RECOVERY_DRAIN!;
    const before = [...await state.storage.list()];
    local.RECOVERY_DRAIN = { idFromName() { return original.idFromName("fresh-scope-object"); } } as unknown as DurableObjectNamespace;
    try {
      const response = await instance.fetch(new Request("https://recovery-writer.internal/inspect", {
        method: "POST", body: JSON.stringify({ id: owner, scope: runtime.RECOVERY_DRAIN_SCOPE_DIGEST }),
      }));
      expect(response.status).toBe(409);
      expect([...await state.storage.list()]).toEqual(before);
    } finally { local.RECOVERY_DRAIN = original; }
  });
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ owner, active: 0, drained: true });
  await releaseRecoveryWriterFence(runtime, owner);
});


it("admits only exact startup GETs as reads and keeps session, callbacks and writes tracked", async () => {
  const commands: string[] = [];
  const startupEnv: Env = { ...runtime, NOTIFICATION_WAKE_BACKEND: "", AUTH_BACKEND: "better-auth", AUTH_DB: db,
    BETTER_AUTH_URL: "https://app.example.test", BETTER_AUTH_SECRET: "synthetic-startup-secret-00000000000000000000",
    MAINTENANCE_SETTINGS_BACKEND: "d1", RECOVERY_DRAIN: {
      idFromName: namespace.idFromName.bind(namespace),
      get() { return { async fetch(input: string, init: RequestInit) {
        commands.push(new URL(input).pathname); return gate.fetch(input, init);
      } }; },
    } as unknown as DurableObjectNamespace };
  for (const path of ["/api/system/maintenance", "/api/auth/capabilities"]) {
    commands.length = 0;
    const response = await worker.fetch(new Request("https://app.example.test" + path), startupEnv);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(commands).toEqual(["/inspect"]);
    expect(await inspectRecoveryWriters(runtime)).toMatchObject({ active: 0, initialized: false });
  }
  for (const [path, method] of [["/api/auth/get-session", "GET"], ["/api/auth/callback/unknown", "GET"],
    ["/api/system/maintenance", "POST"], ["/api/auth/capabilities", "POST"],
    ["/api/system/maintenance/", "GET"]]) {
    commands.length = 0;
    await worker.fetch(new Request("https://app.example.test" + path, { method }), startupEnv);
    expect(commands).toEqual(["/enter", "/leave"]);
  }
  await claimRecoveryWriterFence(runtime, owner);
  for (const path of ["/api/system/maintenance", "/api/auth/capabilities"]) {
    commands.length = 0;
    const response = await worker.fetch(new Request("https://app.example.test" + path), startupEnv);
    expect(response.status).toBe(503); expect(commands).toEqual(["/inspect"]);
  }
  await assertRecoveryWriterFence(runtime, owner);
});

it("preserves async KV tickets through concurrent synchronous admission, inspection and drain", async () => {
  const legacy = "00000000-0000-4000-8000-000000000099";
  await runInDurableObject(gate, async (_instance, state) => {
    await state.storage.put({ scope: runtime.RECOVERY_DRAIN_SCOPE_DIGEST, active: 1, ["writer:" + legacy]: true });
  });
  const finish = signal();
  const entered = Array.from({ length: 32 }, () => signal());
  const operations = entered.map(ready => withRecoveryWriter(runtime, async () => {
    ready.resolve(); await finish.promise;
  }, undefined, "http"));
  await Promise.all(entered.map(ready => ready.promise));
  const reads = await Promise.all(Array.from({ length: 32 }, () => inspectRecoveryWriters(runtime)));
  for (const status of reads) expect(status).toMatchObject({ active: 33, tickets: { legacy: 1, kinds: { unknown: 1, http: 32 } } });
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 33, drained: false });
  await expect(withRecoveryWriter(runtime, async () => { throw Error("must not execute"); })).rejects.toThrow("recovery_writer_unavailable");
  finish.resolve(); await Promise.all(operations);
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ owner, active: 1, drained: false, tickets: { legacy: 1 } });
  // Only the owner of this fixture's settled legacy operation may remove it.
  await gate.fetch("https://recovery-writer.internal/leave", { method: "POST",
    body: JSON.stringify({ id: legacy, scope: runtime.RECOVERY_DRAIN_SCOPE_DIGEST }) });
  await assertRecoveryWriterFence(runtime, owner);
});


it("identifies the internal SQLite coordinator without exposing its marker on public startup responses", async () => {
  const direct = await gate.fetch("https://recovery-writer.internal/inspect", { method: "POST",
    body: JSON.stringify({ id: owner, scope: runtime.RECOVERY_DRAIN_SCOPE_DIGEST }) });
  expect(direct.status).toBe(200);
  expect(direct.headers.get("x-recovery-coordinator-revision")).toBe("sqlite-sync-v1");
  const response = await worker.fetch(new Request("https://app.example.test/api/system/maintenance"), {
    ...runtime, MAINTENANCE_SETTINGS_BACKEND: "d1",
  });
  expect(response.status).toBe(200);
  expect(response.headers.has("x-recovery-coordinator-revision")).toBe(false);
});


it("retries only a lost read inspection ACK with a fresh stub and keeps the census unchanged", async () => {
  let stubs = 0, inspections = 0, reads = 0;
  const before = await runInDurableObject(gate, async (_instance, state) => [...await state.storage.list()]);
  const retrying = { ...runtime, RECOVERY_DRAIN: {
    idFromName: namespace.idFromName.bind(namespace),
    get() { stubs++; return { async fetch(input: string, init: RequestInit) {
      expect(input.endsWith("/inspect")).toBe(true); expect(init.signal).toBeInstanceOf(AbortSignal);
      const response = await gate.fetch(input, init);
      if (++inspections === 1) throw Error("synthetic lost read ACK");
      return response;
    } }; },
  } as unknown as DurableObjectNamespace };
  await withRecoveryRead(retrying, async () => { reads++; }, 2_000);
  expect({ stubs, inspections, reads }).toEqual({ stubs: 2, inspections: 2, reads: 1 });
  expect(await runInDurableObject(gate, async (_instance, state) => [...await state.storage.list()])).toEqual(before);
});

it("rechecks the current fence on a read retry instead of using an earlier open result", async () => {
  let inspections = 0, reads = 0;
  const retrying = { ...runtime, RECOVERY_DRAIN: {
    idFromName: namespace.idFromName.bind(namespace),
    get() { return { async fetch(input: string, init: RequestInit) {
      const response = await gate.fetch(input, init);
      if (++inspections === 1) { await claimRecoveryWriterFence(runtime, owner); throw Error("synthetic lost read ACK"); }
      return response;
    } }; },
  } as unknown as DurableObjectNamespace };
  await expect(withRecoveryRead(retrying, async () => { reads++; })).rejects.toThrow("recovery_writer_unavailable");
  expect({ inspections, reads }).toEqual({ inspections: 2, reads: 0 });
  await assertRecoveryWriterFence(runtime, owner);
});

it("bounds a stalled read to its signal deadline then retries without executing the view twice", async () => {
  let inspections = 0, reads = 0;
  const retrying = { ...runtime, RECOVERY_DRAIN: {
    idFromName: namespace.idFromName.bind(namespace),
    get() { return { async fetch(input: string, init: RequestInit) {
      if (++inspections === 1) return new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(Error("synthetic stalled transport")), { once: true });
      });
      return gate.fetch(input, init);
    } }; },
  } as unknown as DurableObjectNamespace };
  await withRecoveryRead(retrying, async () => { reads++; }, 2_000);
  expect({ inspections, reads }).toEqual({ inspections: 2, reads: 1 });
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ active: 0, initialized: false });
});

it("does not retry an inconsistent read scope and stops repeated transport failures after two attempts", async () => {
  for (const failTransport of [false, true]) {
    let inspections = 0, reads = 0;
    const refusing = { ...runtime, RECOVERY_DRAIN_SCOPE_DIGEST: "b".repeat(64), RECOVERY_DRAIN: {
      idFromName: namespace.idFromName.bind(namespace),
      get() { return { async fetch(input: string, init: RequestInit) {
        inspections++; if (failTransport) throw Error("synthetic unavailable");
        return gate.fetch(input, init);
      } }; },
    } as unknown as DurableObjectNamespace };
    await expect(withRecoveryRead(refusing, async () => { reads++; })).rejects.toThrow("recovery_writer_unavailable");
    expect(inspections).toBe(failTransport ? 2 : 1); expect(reads).toBe(0);
  }
});


it("keeps fence and uncertain writer backoff while allowing one client retry of a failed read transport", async () => {
  let assetReads = 0;
  const failedTransport = { ...runtime, ASSETS: { async fetch() { assetReads++; return new Response("must not open"); } } as unknown as Fetcher,
    RECOVERY_DRAIN: { idFromName: namespace.idFromName.bind(namespace),
      get() { return { async fetch() { throw Error("synthetic unavailable"); } }; },
    } as unknown as DurableObjectNamespace };
  const transient = await worker.fetch(new Request("https://app.example.test/"), failedTransport);
  expect(transient.status).toBe(503); expect(transient.headers.has("retry-after")).toBe(false);
  expect(await transient.json()).toEqual({ error: "recovery_writer_unavailable" });
  const writer = await worker.fetch(new Request("https://app.example.test/api/auth/get-session"), failedTransport);
  expect(writer.status).toBe(503); expect(writer.headers.get("retry-after")).toBe("60");
  await claimRecoveryWriterFence(runtime, owner);
  const fenced = await worker.fetch(new Request("https://app.example.test/"), {
    ...runtime, ASSETS: failedTransport.ASSETS,
  });
  expect(fenced.status).toBe(503); expect(fenced.headers.get("retry-after")).toBe("60");
  expect(assetReads).toBe(0); await assertRecoveryWriterFence(runtime, owner);
});


it("keeps slow static admission alive so a service worker update can complete", async () => {
  let inspections = 0;
  const slow = { ...runtime, ASSETS: { async fetch() { return new Response("synthetic service worker"); } } as unknown as Fetcher,
    RECOVERY_DRAIN: { idFromName: namespace.idFromName.bind(namespace),
      get() { return { async fetch(input: string, init: RequestInit) {
        inspections++; expect(init.signal).toBeUndefined();
        await new Promise(resolve => setTimeout(resolve, 3_000));
        return gate.fetch(input, init);
      } }; },
    } as unknown as DurableObjectNamespace };
  const response = await worker.fetch(new Request("https://app.example.test/sw.js"), slow);
  expect(response.status).toBe(200); expect(await response.text()).toBe("synthetic service worker");
  expect(inspections).toBe(1);
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ active: 0, initialized: false });
});
