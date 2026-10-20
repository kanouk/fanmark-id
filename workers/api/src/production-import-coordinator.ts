import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./repository";
import { PRODUCTION_RUNTIME } from "./production-runtime-identity";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const NAME = "recovery-writers-v1";
const ORIGIN = "https://recovery-writer.internal";
export const IMPORT_STATE_KEY = "production-import-v1";
export const IMPORT_EXECUTOR_KEY = "production-import-executor-v1";
export const IMPORT_QUARANTINE_KEY = "production-import-quarantine-v1";
type Quarantine = { owner: string; proofSha256: string; stateSha256: string; executorId: string | null };
type Cancelled = Pending & { executorId: string; proofSha256: string; stateSha256: string };
type Pending = { operationId: string; batchSha256: string; store: string };
export type ProductionImportState = {
  owner: string; manifestSha256: string; incarnationsSha256: string;
  pending: Pending | null; acknowledged: number; readbackSha256: string | null;
};
type Input = { owner: string; manifestSha256?: string; incarnationsSha256?: string;
  operationId?: string; batchSha256?: string; store?: string; readbackSha256?: string; executorId?: string | null; acknowledged?: number;
  stateSha256?: string; proofSha256?: string };
const shapes: Record<string, string> = {
  claim: "incarnationsSha256,manifestSha256,owner", inspect: "owner",
  operation: "operationId,owner", acquire: "executorId,owner", yield: "executorId,owner,readbackSha256",
  recover: "acknowledged,executorId,owner,readbackSha256",
  "recover-auth": "batchSha256,executorId,operationId,owner,readbackSha256,store",
  begin: "batchSha256,operationId,owner,store", acknowledge: "batchSha256,operationId,owner,store",
  complete: "owner,readbackSha256", dispatch: "batchSha256,operationId,owner,store",
  quarantine: "executorId,owner,proofSha256,stateSha256",
  "cancel-undispatched-r2": "batchSha256,executorId,operationId,owner,proofSha256,stateSha256,store",
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}
function sameOperation(a: Pending, b: Pick<Input, "operationId" | "batchSha256" | "store">) {
  return a.operationId === b.operationId && a.batchSha256 === b.batchSha256 && a.store === b.store;
}
function validState(value: ProductionImportState) {
  return UUID.test(value.owner) && HASH.test(value.manifestSha256) && HASH.test(value.incarnationsSha256) &&
    Number.isSafeInteger(value.acknowledged) && value.acknowledged >= 0 &&
    (value.readbackSha256 === null || HASH.test(value.readbackSha256)) &&
    (value.pending === null || (UUID.test(value.pending.operationId) && HASH.test(value.pending.batchSha256) &&
      ["auth", "master", "business", "avatars", "covers"].includes(value.pending.store))) &&
    !(value.pending && value.readbackSha256);
}

/** Runs in the existing production writer DO: admission and the writer fence
 * share one atomic transaction. No lease expires and no ambiguous write retries.
 * Only hashes/IDs are stored here; never SQL, credentials or user records.
 */
export async function productionImportCommand(ctx: DurableObjectState, env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.slice("/migration/".length);
  if (url.origin !== ORIGIN || url.search || request.method !== "POST" || !Object.hasOwn(shapes, action)) return json(null, 404);
  if (env.RECOVERY_DRAIN_SCOPE_DIGEST !== PRODUCTION_RUNTIME.scope || env.RECOVERY_DRAIN_BACKEND !== "durable-object" ||
      !env.RECOVERY_DRAIN || ctx.id.toString() !== env.RECOVERY_DRAIN.idFromName(NAME).toString()) return json(null, 409);
  // Inspection stays available after opening the application. New import
  // operations are admitted only while the application is explicitly closed.
  if (!["inspect", "operation"].includes(action) && (env.CUTOVER_WRITE_FREEZE !== "receipt_only" ||
      (env.PRODUCTION_OWNER_ACCEPTANCE_BACKEND && env.PRODUCTION_OWNER_ACCEPTANCE_BACKEND !== "disabled"))) return json(null, 409);
  let input: Input;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 1024) return json(null, 400);
    const text = await request.text();
    if (text.length > 1024) return json(null, 400);
    input = JSON.parse(text);
    if (!input || !UUID.test(input.owner)) return json(null, 400);
    const keys = Object.keys(input).sort().join(",");
    const optionalExecutor = ["begin", "acknowledge", "complete"].includes(action) &&
      keys === [...shapes[action].split(","), "executorId"].sort().join(",");
    if (keys !== shapes[action] && !optionalExecutor) return json(null, 400);
    if ((Object.hasOwn(input, "executorId") || ["acquire", "yield"].includes(action)) &&
        !(action === "quarantine" && input.executorId === null) && !UUID.test(input.executorId ?? "")) return json(null, 400);
    if (["quarantine", "cancel-undispatched-r2"].includes(action) && (!HASH.test(input.stateSha256 ?? "") || !HASH.test(input.proofSha256 ?? ""))) return json(null, 400);
    if (action === "claim" && (!HASH.test(input.manifestSha256 ?? "") || !HASH.test(input.incarnationsSha256 ?? ""))) return json(null, 400);
    if (action === "operation" && !UUID.test(input.operationId ?? "")) return json(null, 400);
    if (["begin", "acknowledge", "dispatch", "recover-auth", "cancel-undispatched-r2"].includes(action) && (!UUID.test(input.operationId ?? "") || !HASH.test(input.batchSha256 ?? "") ||
        !["auth", "master", "business", "avatars", "covers"].includes(input.store ?? ""))) return json(null, 400);
    if (["complete", "yield", "recover", "recover-auth"].includes(action) && !HASH.test(input.readbackSha256 ?? "")) return json(null, 400);
    if (action === "recover" && (!Number.isSafeInteger(input.acknowledged) || input.acknowledged! < 0)) return json(null, 400);
  } catch { return json(null, 400); }
  return ctx.blockConcurrencyWhile(async () => ctx.storage.transaction(async storage => {
    let state = await storage.get<ProductionImportState>(IMPORT_STATE_KEY);
    const executorId = await storage.get<string>(IMPORT_EXECUTOR_KEY);
    const executionRequired = await storage.get<boolean>("production-import-execution-required-v1");
    const quarantine = await storage.get<Quarantine>(IMPORT_QUARANTINE_KEY);
    if (quarantine && (!state || quarantine.owner !== state.owner || !HASH.test(quarantine.proofSha256) ||
        !HASH.test(quarantine.stateSha256) || (quarantine.executorId !== null && !UUID.test(quarantine.executorId)))) return json(null, 409);
    if (executionRequired !== undefined && (executionRequired !== true || !state)) return json(null, 409);
    if (executorId !== undefined && (!UUID.test(executorId) || !state)) return json(null, 409);
    const scope = await storage.get<string>("scope");
    const active = await storage.get<number>("active");
    const fence = await storage.get<{ owner: string; scope: string }>("fence");
    if (state && (!validState(state) || state.owner !== input.owner)) return json(null, 409);
    if ((scope !== undefined && scope !== PRODUCTION_RUNTIME.scope) ||
        (scope === undefined && (active !== undefined || fence !== undefined || state !== undefined)) ||
        (scope !== undefined && (!Number.isSafeInteger(active) || active! < 0))) return json(null, 409);
    if (action === "inspect") return json({ state: state ?? null, scope: PRODUCTION_RUNTIME.scope, active: active ?? 0,
      executorId: executorId ?? null, fenceOwner: fence?.owner ?? null, ...(quarantine ? {quarantine} : {}) });
    if (action === "operation") {
      const acknowledged = await storage.get<Pending>("import-operation:" + input.operationId);
      const dispatched = await storage.get<Pending>("import-dispatch:" + input.operationId);
      const cancelled = await storage.get<Cancelled>("import-cancelled:" + input.operationId);
      const pending = state?.pending && state.pending.operationId === input.operationId ? state.pending : null;
      const valid = (row: Pending) => UUID.test(row.operationId) && row.operationId === input.operationId &&
        HASH.test(row.batchSha256) && ["auth", "master", "business", "avatars", "covers"].includes(row.store);
      if (cancelled && (!state || !valid(cancelled) || !["avatars", "covers"].includes(cancelled.store) ||
          !UUID.test(cancelled.executorId) || !HASH.test(cancelled.proofSha256) || !HASH.test(cancelled.stateSha256) ||
          pending || acknowledged || dispatched)) return json(null, 409);
      if ((acknowledged && (!state || state.acknowledged < 1 || !valid(acknowledged) || pending)) ||
          (dispatched && (!state || !valid(dispatched) || !["avatars", "covers"].includes(dispatched.store) ||
            !(acknowledged ?? pending) || !sameOperation(dispatched, (acknowledged ?? pending)!)))) return json(null, 409);
      return json({ state: state ?? null, scope: PRODUCTION_RUNTIME.scope, active: active ?? 0,
        executorId: executorId ?? null, fenceOwner: fence?.owner ?? null, operationId: input.operationId,
        pending, acknowledged: acknowledged ?? null, dispatched: dispatched ?? null, ...(cancelled ? {cancelled} : {}), ...(quarantine ? {quarantine} : {}) });
    }
    // Terminal: preserve every pending/ACK/dispatch record, executor and fence.
    // No clear/retry/release operation is provided for quarantined resources.
    if (quarantine) return json(null, 409);
    if ((active ?? 0) !== 0 || (await storage.list({ prefix: "writer:", limit: 1 })).size ||
        (fence && (fence.owner !== input.owner || fence.scope !== PRODUCTION_RUNTIME.scope))) return json(null, 409);
    if (action === "claim") {
      if (state) {
        if (state.manifestSha256 !== input.manifestSha256 || state.incarnationsSha256 !== input.incarnationsSha256 ||
            state.readbackSha256 !== null || !fence) return json(null, 409);
      } else {
        state = { owner: input.owner, manifestSha256: input.manifestSha256!, incarnationsSha256: input.incarnationsSha256!,
          pending: null, acknowledged: 0, readbackSha256: null };
        await storage.put({ scope: PRODUCTION_RUNTIME.scope, active: 0,
          fence: { owner: input.owner, scope: PRODUCTION_RUNTIME.scope }, [IMPORT_STATE_KEY]: state });
      }
      return json(state);
    }
    if (action === "quarantine") {
      if (!state || !fence || (executorId ?? null) !== input.executorId) return json(null, 409);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(state)));
      const stateSha256 = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,"0")).join("");
      if (stateSha256 !== input.stateSha256) return json(null, 409);
      const proof: Quarantine = {owner: input.owner, proofSha256: input.proofSha256!, stateSha256, executorId: executorId ?? null};
      await storage.put(IMPORT_QUARANTINE_KEY, proof);
      return json({state, scope: PRODUCTION_RUNTIME.scope, active: 0, fenceOwner: fence.owner, executorId: executorId ?? null, quarantine: proof});
    }
    if (!state || !fence || state.readbackSha256 !== null) return json(null, 409);
    if (action === "acquire") {
      // A whole-run owner never expires. Lost acquire responses and crashes
      // require inspection; even the same executor ID cannot reacquire.
      if (executorId !== undefined || state.pending || await storage.get("production-import-executor-used:" + input.executorId)) return json(null, 409);
      await storage.put({ [IMPORT_EXECUTOR_KEY]: input.executorId!, "production-import-execution-required-v1": true,
        ["production-import-executor-used:" + input.executorId]: true });
      return json({ ...state, executorId: input.executorId });
    }
    if (executionRequired && executorId === undefined && ["begin", "acknowledge", "complete"].includes(action)) return json(null, 409);
    if (["begin", "acknowledge", "complete", "yield", "recover", "recover-auth", "cancel-undispatched-r2"].includes(action) &&
        (executorId ?? null) !== (input.executorId ?? null)) return json(null, 409);
    // Atomic dispatch/cancel arbitration. A permanent tombstone is written
    // before pending is cleared; a delayed original request can never dispatch.
    // Dispatched outcomes, D1 writes and quarantined cohorts cannot use this path.
    if (action === "cancel-undispatched-r2") {
      if (!executorId || !["avatars", "covers"].includes(input.store ?? "") ||
          !state.pending || !sameOperation(state.pending, input) ||
          await storage.get("import-operation:" + input.operationId) ||
          await storage.get("import-dispatch:" + input.operationId) ||
          await storage.get("import-cancelled:" + input.operationId)) return json(null, 409);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(state)));
      const stateSha256 = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,"0")).join("");
      if (stateSha256 !== input.stateSha256) return json(null, 409);
      const cancelled: Cancelled = {...state.pending, executorId, stateSha256, proofSha256: input.proofSha256!};
      await storage.put("import-cancelled:" + input.operationId, cancelled);
      state.pending = null;
      await storage.put(IMPORT_STATE_KEY, state);
      return json({state, cancelled, scope: PRODUCTION_RUNTIME.scope, active: 0, fenceOwner: fence.owner, executorId});
    }
    if (["begin", "dispatch", "acknowledge"].includes(action) &&
        await storage.get("import-cancelled:" + input.operationId)) return json(null, 409);
    if (action === "recover-auth") {
      // Only the first, single-transaction Auth stage. The private recovery
      // operator checks the dead executor, exact batch and full Auth readback.
      // Keep ownership and the fence until local ACK repair also succeeds.
      if (!executorId || state.acknowledged !== 0 || input.store !== "auth" ||
          !state.pending || !sameOperation(state.pending, input) ||
          await storage.get("import-operation:" + input.operationId)) return json(null, 409);
      await storage.put("import-operation:" + input.operationId, state.pending);
      await storage.put("production-import-auth-recovery:" + input.operationId, {
        executorId, readbackSha256: input.readbackSha256!, batchSha256: input.batchSha256!,
      });
      state.pending = null; state.acknowledged = 1;
      await storage.put(IMPORT_STATE_KEY, state);
      return json(state);
    }
    if (action === "recover") {
      // The operator has verified an exited local executor and independently
      // checked its completed prefix. CAS excludes a late begin/ACK or another
      // recovery. No pending provider outcome can be cleared by this command.
      if (!executorId || state.pending || state.acknowledged !== input.acknowledged) return json(null, 409);
      await storage.put("production-import-recovery:" + executorId, {
        executorId, readbackSha256: input.readbackSha256!, acknowledged: state.acknowledged,
      });
      await storage.delete(IMPORT_EXECUTOR_KEY);
      return json({ ...state, executorId: null });
    }
    if (action === "yield") {
      if (!executorId || state.pending || state.acknowledged === 0) return json(null, 409);
      await storage.put("production-import-checkpoint-v1", { executorId, readbackSha256: input.readbackSha256!, acknowledged: state.acknowledged });
      await storage.delete(IMPORT_EXECUTOR_KEY);
      // Yield only the executor. The migration fence and operation history stay.
      return json({ ...state, executorId: null });
    }
    if (action === "begin") {
      // Repeating an operation UUID, even after a successful ACK, never grants
      // permission to send the associated provider write again.
      if (state.pending || await storage.get("import-operation:" + input.operationId) || state.acknowledged >= 100000) return json(null, 409);
      state.pending = { operationId: input.operationId!, batchSha256: input.batchSha256!, store: input.store! };
    } else if (action === "dispatch") {
      if (!state.pending || !sameOperation(state.pending, input) || !["avatars", "covers"].includes(input.store ?? "") ||
          await storage.get("import-dispatch:" + input.operationId)) return json(null, 409);
      await storage.put("import-dispatch:" + input.operationId, state.pending);
    } else if (action === "acknowledge") {
      if (!state.pending || !sameOperation(state.pending, input)) return json(null, 409);
      await storage.put("import-operation:" + input.operationId, state.pending);
      state.pending = null; state.acknowledged++;
    } else if (action === "complete") {
      if (state.pending || state.acknowledged === 0) return json(null, 409);
      state.readbackSha256 = input.readbackSha256!;
      // Keep the fence: a separate, deliberate release follows independent
      // all-store verification and the remaining cutover checks.
    }
    await storage.put(IMPORT_STATE_KEY, state);
    return json(state);
  }));
}

/** No public route and no arbitrary SQL/data RPC. A temporary operator binding
 * can only claim/inspect this journal. Store transports remain separate.
 */
export class ProductionImportCoordinatorService extends WorkerEntrypoint<Env> {
  async command(action: string, input: Input) {
    if (!Object.hasOwn(shapes, action) || this.env.RECOVERY_DRAIN_SCOPE_DIGEST !== PRODUCTION_RUNTIME.scope || !this.env.RECOVERY_DRAIN) {
      throw new Error("production_import_coordinator_unavailable");
    }
    const stub = this.env.RECOVERY_DRAIN.get(this.env.RECOVERY_DRAIN.idFromName(NAME));
    const response = await stub.fetch(`${ORIGIN}/migration/${action}`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (response.status !== 200) throw new Error("production_import_coordinator_refused");
    return response.json();
  }
}
