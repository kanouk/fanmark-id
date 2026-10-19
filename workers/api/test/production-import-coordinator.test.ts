import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import type { Env } from "../src/repository";
import { IMPORT_STATE_KEY } from "../src/production-import-coordinator";
import { inspectRecoveryWriters, claimRecoveryWriterFence, releaseRecoveryWriterFence, withRecoveryWriter } from "../src/recovery-writer-drain";

const runtime = env as unknown as Env;
const namespace = runtime.RECOVERY_DRAIN!;
const gate = () => namespace.get(namespace.idFromName("recovery-writers-v1"));
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const identity = { owner, manifestSha256: "a".repeat(64), incarnationsSha256: "b".repeat(64) };
const operation = { owner, operationId: "00000000-0000-4000-8000-000000000003", batchSha256: "c".repeat(64), store: "business" };
const call = (action: string, body: unknown) => gate().fetch("https://recovery-writer.internal/migration/" + action,
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const stored = () => runInDurableObject(gate(), async (_instance, ctx) => [...await ctx.storage.list()]);
beforeEach(async () => { await runInDurableObject(gate(), async (_instance, ctx) => { await ctx.storage.deleteAll(); }); });

it("independent operation inspection distinguishes missing, pending, dispatched and acknowledged without writes", async () => {
  const query = { owner, operationId: operation.operationId };
  expect(await (await call("operation", query)).json()).toMatchObject({ state: null, pending: null, acknowledged: null, dispatched: null });
  expect(await stored()).toEqual([]);
  await call("claim", identity);
  const image = { ...operation, store: "avatars" };
  await call("begin", image);
  let before = await stored();
  expect(await (await call("operation", query)).json()).toMatchObject({ pending: { store: "avatars" }, acknowledged: null, dispatched: null });
  expect(await stored()).toEqual(before);
  await call("dispatch", image);
  before = await stored();
  expect(await (await call("operation", query)).json()).toMatchObject({ pending: { store: "avatars" }, acknowledged: null, dispatched: { store: "avatars" } });
  expect(await stored()).toEqual(before);
  await call("acknowledge", image); // Its response may be lost to the importer.
  before = await stored();
  expect(await (await call("operation", query)).json()).toMatchObject({ pending: null, acknowledged: { store: "avatars" }, dispatched: { store: "avatars" } });
  expect((await call("operation", { ...query, owner: other })).status).toBe(409);
  expect((await call("operation", { ...query, operationId: "invalid" })).status).toBe(400);
  expect(await stored()).toEqual(before);
});

it("a corrupt durable operation receipt is never reported as acknowledged", async () => {
  await call("claim", identity); await call("begin", operation); await call("acknowledge", operation);
  await runInDurableObject(gate(), async (_instance, ctx) => {
    await ctx.storage.put("import-operation:" + operation.operationId, { operationId: other, batchSha256: operation.batchSha256, store: "business" });
  });
  const before = await stored();
  expect((await call("operation", { owner, operationId: operation.operationId })).status).toBe(409);
  expect(await stored()).toEqual(before);
});

it("read-only inspection leaves the native DO uninitialized; invalid inputs cannot claim", async () => {
  expect(await (await call("inspect", { owner })).json()).toMatchObject({ state: null, active: 0, fenceOwner: null });
  expect(await stored()).toEqual([]);
  for (const input of [null, {}, { ...identity, unexpected: true }, { ...identity, owner: "not-a-uuid" },
    { ...identity, manifestSha256: "invalid" }]) expect((await call("claim", input)).status).toBe(400);
  expect((await call("reset", { owner })).status).toBe(404);
  expect(await stored()).toEqual([]);
});

it("two independent callers cannot claim the same production stores", async () => {
  const results = await Promise.all([call("claim", identity), call("claim", { ...identity, owner: other })]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const winner = results[0].status === 200 ? owner : other;
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ owner: winner, active: 0, drained: true });
  const before = await stored();
  expect((await call("claim", { ...identity, owner: winner })).status).toBe(200);
  expect((await call("claim", { ...identity, owner: winner, incarnationsSha256: "d".repeat(64) })).status).toBe(409);
  expect(await stored()).toEqual(before);
  await expect(withRecoveryWriter(runtime, async () => { throw Error("must_not_run"); })).rejects.toThrow("recovery_writer_unavailable");
});

it("an existing writer must finish before claim; no false drain or early fence release", async () => {
  let finish!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const running = withRecoveryWriter(runtime, async () => { entered(); await waiting; });
  await ready;
  expect((await call("claim", identity)).status).toBe(409);
  finish(); await running;
  expect((await call("claim", identity)).status).toBe(200);
  await expect(releaseRecoveryWriterFence(runtime, owner)).rejects.toThrow("recovery_writer_unavailable");
  expect((await call("complete", { owner, readbackSha256: "d".repeat(64) })).status).toBe(409);
});

it("lost begin/write acknowledgements retain a pending operation across independent calls", async () => {
  expect((await call("claim", identity)).status).toBe(200);
  await call("begin", operation); // Deliberately discard the response.
  const before = await stored();
  expect((await call("begin", operation)).status).toBe(409);
  expect((await call("begin", { ...operation, operationId: other, store: "avatars" })).status).toBe(409);
  expect((await call("acknowledge", { ...operation, batchSha256: "e".repeat(64) })).status).toBe(409);
  expect((await call("complete", { owner, readbackSha256: "d".repeat(64) })).status).toBe(409);
  await expect(releaseRecoveryWriterFence(runtime, owner)).rejects.toThrow("recovery_writer_unavailable");
  expect(await (await call("inspect", { owner })).json()).toMatchObject({ state: {
    pending: { operationId: operation.operationId, batchSha256: operation.batchSha256, store: "business" }, acknowledged: 0,
  } });
  expect(await stored()).toEqual(before);
});

it("only one simultaneous batch is admitted, including batches for different stores", async () => {
  await call("claim", identity);
  const results = await Promise.all([call("begin", operation), call("begin", { ...operation, operationId: other, store: "auth" })]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
});

it("confirmed ACK prevents replay; all-store readback completion still retains the fence", async () => {
  await call("claim", identity); await call("begin", operation);
  await call("acknowledge", operation); // Simulate losing the ACK response as well.
  expect(await (await call("inspect", { owner })).json()).toMatchObject({ state: { pending: null, acknowledged: 1 } });
  expect((await call("begin", operation)).status).toBe(409);
  expect((await call("acknowledge", operation)).status).toBe(409);
  const next = { ...operation, operationId: other, store: "covers" };
  expect((await call("begin", next)).status).toBe(200);
  expect((await call("acknowledge", next)).status).toBe(200);
  expect((await call("complete", { owner, readbackSha256: "d".repeat(64) })).status).toBe(200);
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ owner, drained: true });
  expect((await call("begin", { ...operation, operationId: crypto.randomUUID() })).status).toBe(409);
  await expect(releaseRecoveryWriterFence(runtime, other)).rejects.toThrow("recovery_writer_unavailable");
  await releaseRecoveryWriterFence(runtime, owner);
  expect((await call("claim", identity)).status).toBe(409);
  await withRecoveryWriter(runtime, async () => {});
  // Normal backup/restore fences remain usable after the one-time import.
  await claimRecoveryWriterFence(runtime, other);
  await releaseRecoveryWriterFence(runtime, other);
  const entries = await stored();
  expect(entries.some(([key]) => key === IMPORT_STATE_KEY)).toBe(true);
  expect(entries.filter(([key]) => key.startsWith("import-operation:")).length).toBe(2);
});

it("corrupt scope/census fails closed and remains available for independent inspection", async () => {
  await call("claim", identity);
  await runInDurableObject(gate(), async (_instance, ctx) => { await ctx.storage.put("active", -1); });
  const before = await stored();
  expect((await call("begin", operation)).status).toBe(409);
  expect((await call("inspect", { owner })).status).toBe(409);
  expect(await stored()).toEqual(before);
});


it("a whole-import executor excludes another process with the same run identity", async () => {
  await call("claim", identity);
  const first = "eeeeeeee-1111-4111-8111-111111111111", second = "ffffffff-1111-4111-8111-111111111111";
  const responses = await Promise.all([call("acquire", { owner, executorId: first }), call("acquire", { owner, executorId: second })]);
  expect(responses.map(r => r.status).sort()).toEqual([200,409]);
  const executorId = responses[0].status === 200 ? first : second;
  const loser = executorId === first ? second : first;
  expect((await call("acquire", { owner, executorId })).status).toBe(409);
  expect((await call("begin", operation)).status).toBe(409);
  expect((await call("begin", { ...operation, executorId: loser })).status).toBe(409);
  expect((await call("begin", { ...operation, executorId })).status).toBe(200);
  expect((await call("acknowledge", operation)).status).toBe(409);
  expect((await call("yield", { owner, executorId, readbackSha256: "f".repeat(64) })).status).toBe(409);
  expect((await call("acknowledge", { ...operation, executorId })).status).toBe(200);
  expect((await call("yield", { owner, executorId, readbackSha256: "f".repeat(64) })).status).toBe(200);
  expect(await (await call("inspect", { owner })).json()).toMatchObject({ executorId: null, fenceOwner: owner, active: 0 });
  expect((await call("begin", { ...operation, operationId: other })).status).toBe(409);
  expect((await call("begin", { ...operation, operationId: other, executorId })).status).toBe(409);
  expect((await call("acquire", { owner, executorId: loser })).status).toBe(200);
  expect((await call("complete", { owner, readbackSha256: "d".repeat(64) })).status).toBe(409);
  expect((await call("complete", { owner, executorId: loser, readbackSha256: "d".repeat(64) })).status).toBe(200);
  expect(await inspectRecoveryWriters(runtime)).toMatchObject({ owner, active: 0, drained: true });
});

it("R2 dispatch follows the admitted operation without bypassing the executor", async () => {
  await call("claim", identity);
  const executorId = "eeeeeeee-1111-4111-8111-111111111111", image = { ...operation, store: "avatars" };
  await call("acquire", { owner, executorId });
  expect((await call("dispatch", image)).status).toBe(409);
  await call("begin", { ...image, executorId });
  expect((await call("dispatch", image)).status).toBe(200);
  expect((await call("dispatch", image)).status).toBe(409);
  expect((await call("acknowledge", image)).status).toBe(409);
  expect((await call("acknowledge", { ...image, executorId })).status).toBe(200);
});
