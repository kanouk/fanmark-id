import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { beforeAll, beforeEach, expect, it } from "vitest";
import worker from "../src/index";
import { assertRecoveryWriterFence, claimRecoveryWriterFence, releaseRecoveryWriterFence,
  inspectRecoveryWriters, settleRecoveryWriterTasks, withRecoveryWriter } from "../src/recovery-writer-drain";
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
      attributed: 0, oldestEnteredAt: null, runtimeRevisions: {} } });
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

it("keeps actual HTTP work and its awaited post-response wake in the census until they finish", async () => {
  const httpEntered = signal(), httpFinish = signal();
  const http = worker.fetch(new Request("https://app.example.test/"), { ...runtime,
    ASSETS: { async fetch() { httpEntered.resolve(); await httpFinish.promise; return new Response("synthetic"); } } as unknown as Fetcher,
  });
  await httpEntered.promise;
  expect(await claimRecoveryWriterFence(runtime, owner)).toMatchObject({ active: 1, drained: false });
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
