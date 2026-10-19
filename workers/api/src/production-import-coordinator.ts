import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./repository";
import { PRODUCTION_RUNTIME } from "./production-runtime-identity";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const NAME = "recovery-writers-v1";
const ORIGIN = "https://recovery-writer.internal";
export const IMPORT_STATE_KEY = "production-import-v1";
type Pending = { operationId: string; batchSha256: string; store: string };
export type ProductionImportState = {
  owner: string; manifestSha256: string; incarnationsSha256: string;
  pending: Pending | null; acknowledged: number; readbackSha256: string | null;
};
type Input = { owner: string; manifestSha256?: string; incarnationsSha256?: string;
  operationId?: string; batchSha256?: string; store?: string; readbackSha256?: string };
const shapes: Record<string, string> = {
  claim: "incarnationsSha256,manifestSha256,owner", inspect: "owner",
  begin: "batchSha256,operationId,owner,store", acknowledge: "batchSha256,operationId,owner,store",
  complete: "owner,readbackSha256", dispatch: "batchSha256,operationId,owner,store",
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}
function sameOperation(a: Pending, b: Input) {
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
  if (action !== "inspect" && env.CUTOVER_WRITE_FREEZE !== "receipt_only") return json(null, 409);
  let input: Input;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 1024) return json(null, 400);
    const text = await request.text();
    if (text.length > 1024) return json(null, 400);
    input = JSON.parse(text);
    if (!input || Object.keys(input).sort().join(",") !== shapes[action] || !UUID.test(input.owner)) return json(null, 400);
    if (action === "claim" && (!HASH.test(input.manifestSha256 ?? "") || !HASH.test(input.incarnationsSha256 ?? ""))) return json(null, 400);
    if (["begin", "acknowledge", "dispatch"].includes(action) && (!UUID.test(input.operationId ?? "") || !HASH.test(input.batchSha256 ?? "") ||
        !["auth", "master", "business", "avatars", "covers"].includes(input.store ?? ""))) return json(null, 400);
    if (action === "complete" && !HASH.test(input.readbackSha256 ?? "")) return json(null, 400);
  } catch { return json(null, 400); }
  return ctx.blockConcurrencyWhile(async () => ctx.storage.transaction(async storage => {
    let state = await storage.get<ProductionImportState>(IMPORT_STATE_KEY);
    const scope = await storage.get<string>("scope");
    const active = await storage.get<number>("active");
    const fence = await storage.get<{ owner: string; scope: string }>("fence");
    if (state && (!validState(state) || state.owner !== input.owner)) return json(null, 409);
    if ((scope !== undefined && scope !== PRODUCTION_RUNTIME.scope) ||
        (scope === undefined && (active !== undefined || fence !== undefined || state !== undefined)) ||
        (scope !== undefined && (!Number.isSafeInteger(active) || active! < 0))) return json(null, 409);
    if (action === "inspect") return json({ state: state ?? null, scope: PRODUCTION_RUNTIME.scope, active: active ?? 0,
      fenceOwner: fence?.owner ?? null });
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
    if (!state || !fence || state.readbackSha256 !== null) return json(null, 409);
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
