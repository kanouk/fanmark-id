import { DurableObject } from "cloudflare:workers";
import type { Env } from "./repository";
import { recoveryWriterException, recoveryWriterTiming } from "./recovery-writer-diagnostics";
import { IMPORT_STATE_KEY, IMPORT_QUARANTINE_KEY, productionImportCommand, type ProductionImportState } from "./production-import-coordinator";

const ORIGIN = "https://recovery-writer.internal";
const NAME = "recovery-writers-v1";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const REVISION = /^[A-Za-z0-9:_-]{1,128}$/u;
const WRITER_KINDS = ["unknown", "http", "scheduled", "notification-wake", "notification-alarm", "master-publication"] as const;
export type RecoveryWriterKind = typeof WRITER_KINDS[number];
function validKind(value: unknown): value is RecoveryWriterKind {
  return typeof value === "string" && WRITER_KINDS.includes(value as RecoveryWriterKind);
}
type Fence = { owner: string; scope: string };
export type RecoveryWriterStatus = { owner: string | null; scope: string; active: number; drained: boolean };
type WriterTicket = { enteredAt: number; runtimeRevision: string | null; kind?: RecoveryWriterKind };
export type RecoveryWriterInspection = RecoveryWriterStatus & { initialized: boolean; tickets: {
  scanned: number; complete: boolean; legacy: number; attributed: number;
  oldestEnteredAt: number | null; runtimeRevisions: Record<string, number>; kinds: Record<string, number>;
} };

export class RecoveryWriterDrainError extends Error {
  constructor(readonly retryable = false, readonly readOnly = false) { super("recovery_writer_unavailable"); this.name = "RecoveryWriterDrainError"; }
}

export function recoveryWriterTrackingSelected(env: Env): boolean {
  const backend = env.RECOVERY_DRAIN_BACKEND?.trim();
  if (!backend) return false;
  if (backend !== "durable-object") throw new RecoveryWriterDrainError();
  return true;
}

function scopeFor(env: Env): string {
  if (!recoveryWriterTrackingSelected(env) || !HASH.test(env.RECOVERY_DRAIN_SCOPE_DIGEST ?? "") || !env.RECOVERY_DRAIN) {
    throw new RecoveryWriterDrainError();
  }
  return env.RECOVERY_DRAIN_SCOPE_DIGEST!;
}

async function command(env: Env, operation: string, id: string, kind: RecoveryWriterKind = "unknown"): Promise<RecoveryWriterStatus> {
  const scope = scopeFor(env);
  const stub = env.RECOVERY_DRAIN!.get(env.RECOVERY_DRAIN!.idFromName(NAME));
  const started = Date.now();
  let status: number | null = null, coordinatorRevision: string | null = null;
  let handlerMs: number | null = null;
  let failure: ReturnType<typeof recoveryWriterException> | null = null;
  try {
    const response = await stub.fetch(`${ORIGIN}/${operation}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, scope,
        ...(operation === "enter" ? { runtimeRevision: env.CF_VERSION_METADATA?.id ?? null, kind } : {}) }),
    });
    status = response.status;
    coordinatorRevision = response.headers.get("x-recovery-coordinator-revision");
    handlerMs = recoveryWriterTiming(response.headers.get("x-recovery-handler-ms"));
    if (response.status !== 200) throw new RecoveryWriterDrainError();
    const value = await response.json() as RecoveryWriterStatus;
    if (value.scope !== scope || !Number.isSafeInteger(value.active) || value.active < 0 ||
        (value.owner !== null && !UUID.test(value.owner)) ||
        value.drained !== (value.owner !== null && value.active === 0)) throw new RecoveryWriterDrainError();
    return value;
  } catch (error) {
    failure = recoveryWriterException(error);
    throw new RecoveryWriterDrainError(!failure.overloaded && (status === null || status >= 500));
  }
  finally {
    const elapsedMs = Date.now() - started;
    if (elapsedMs >= 1_000 || status !== 200) console.warn(JSON.stringify({
      event: "recovery-writer-command", operation, elapsedMs, status,
      coordinatorRevision: coordinatorRevision === "sqlite-sync-v1" ? coordinatorRevision : "unconfirmed",
      handlerMs, failure,
    }));
  }
}

async function leaveCompletedWriter(env: Env, id: string): Promise<void> {
  // Only this caller's settled operation can retry its idempotent leave. Never
  // replay enter/work or reconcile another caller's unresolved ticket here.
  for (let attempt = 0; ; attempt++) {
    try { await command(env, "leave", id); return; }
    catch (error) {
      if (attempt === 2 || (error instanceof RecoveryWriterDrainError && !error.retryable)) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}

/** Tickets never expire: a crashed or unacknowledged writer blocks capture rather than falsely draining. */
export async function withRecoveryWriter<T>(env: Env, operation: () => Promise<T>,
  context?: Pick<ExecutionContext, "waitUntil">, kind: RecoveryWriterKind = "unknown"): Promise<T> {
  if (!recoveryWriterTrackingSelected(env)) return operation();
  const id = crypto.randomUUID();
  const lifecycle = (async () => {
    // A lost enter response never permits the operation to run. Its ticket is retained.
    await command(env, "enter", id, kind);
    try { return await operation(); }
    finally { await leaveCompletedWriter(env, id); }
  })();
  // Register before awaiting enter: protect the complete lifecycle, including leave,
  // during the platform's limited disconnect grace. This is not a completion guarantee.
  context?.waitUntil(lifecycle.catch(() => {}));
  return lifecycle;
}

/** A sibling failure must not release the writer ticket while other tasks still mutate stores. */
export async function settleRecoveryWriterTasks(tasks: Promise<unknown>[]): Promise<void> {
  const outcomes = await Promise.allSettled(tasks);
  const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (failed) throw failed.reason;
}

/** Privileged binding-only operations. These are not exposed as public HTTP routes. */
export async function inspectRecoveryWriters(env: Env): Promise<RecoveryWriterInspection> {
  const status = await command(env, "inspect", crypto.randomUUID()) as RecoveryWriterInspection;
  if (typeof status.initialized !== "boolean" || (!status.initialized && (status.active !== 0 || status.owner !== null))) {
    throw new RecoveryWriterDrainError();
  }
  return status;
}

/** Only audited read-only handlers may use this admission; they never create a writer ticket. */
export async function withRecoveryRead<T>(env: Env, operation: () => Promise<T>): Promise<T> {
  if (!recoveryWriterTrackingSelected(env)) return operation();
  // A read admitted before claim may finish afterwards: it cannot change a
  // captured store. New reads still refuse the same fence as mutating requests.
  // Losing this read-only inspection's ACK cannot strand a persistent ticket.
  for (let attempt = 0; ; attempt++) {
    let status: RecoveryWriterInspection;
    try {
      // Wait for authoritative admission. A short internal deadline rejected
      // valid startup reads during coordinator latency; only actual failures retry.
      status = await inspectRecoveryWriters(env);
    } catch (error) {
      if (attempt !== 0 || !(error instanceof RecoveryWriterDrainError) || !error.retryable) {
        // Only this failed, side-effect-free admission may be retried by an
        // HTTP reader. Never advertise retryability for an uncertain writer ACK.
        if (error instanceof RecoveryWriterDrainError && error.retryable) throw new RecoveryWriterDrainError(true, true);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }
    if (status.owner !== null) throw new RecoveryWriterDrainError();
    return operation();
  }
}
export async function claimRecoveryWriterFence(env: Env, owner: string): Promise<RecoveryWriterStatus> {
  if (!UUID.test(owner)) throw new RecoveryWriterDrainError();
  return command(env, "claim", owner);
}
export async function assertRecoveryWriterFence(env: Env, owner: string): Promise<void> {
  const status = await command(env, "assert", owner);
  if (status.owner !== owner || !status.drained) throw new RecoveryWriterDrainError();
}
export async function releaseRecoveryWriterFence(env: Env, owner: string): Promise<void> {
  await command(env, "release", owner);
}

/** One SQLite DO fences new entries and persists the census across object restarts. */
export class RecoveryWriterCoordinator extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const started = Date.now();
    try { return await this.handleCommand(request, started); }
    catch (error) {
      // No URL, operation payload, ticket IDs, scope or raw error strings.
      console.error(JSON.stringify({ event: "recovery-writer-handler-failed",
        elapsedMs: Date.now() - started, failure: recoveryWriterException(error) }));
      throw error;
    }
  }

  private async handleCommand(request: Request, started: number): Promise<Response> {
    if (!this.env.RECOVERY_DRAIN || this.ctx.id.toString() !==
        this.env.RECOVERY_DRAIN.idFromName(NAME).toString()) return new Response(null, { status: 409 });
    const url = new URL(request.url);
    if (url.origin !== ORIGIN || url.search || request.method !== "POST" ||
        !["/enter", "/leave", "/inspect", "/claim", "/assert", "/release"].includes(url.pathname)) {
      return new Response(null, { status: 404 });
    }
    if (Number(request.headers.get("content-length") ?? 0) > 384) return new Response(null, { status: 400 });
    let input: { id: string; scope: string; runtimeRevision?: string | null; kind?: RecoveryWriterKind };
    try {
      const text = await request.text();
      if (text.length > 384) return new Response(null, { status: 400 });
      input = JSON.parse(text);
      const keys = Object.keys(input ?? {}).sort().join(",");
      if (!input || !(keys === "id,scope" || (url.pathname === "/enter" &&
          ["id,runtimeRevision,scope", "id,kind,runtimeRevision,scope"].includes(keys))) ||
          (input.kind !== undefined && !validKind(input.kind)) ||
          (input.runtimeRevision !== undefined && input.runtimeRevision !== null &&
            (typeof input.runtimeRevision !== "string" || !REVISION.test(input.runtimeRevision))) ||
          !UUID.test(input.id) || !HASH.test(input.scope) ||
          input.scope !== scopeFor(this.env)) return new Response(null, { status: 400 });
    } catch { return new Response(null, { status: 400 }); }
    // SQLite KV uses the existing keys and structured-clone values. Keep the
    // entire decision atomic without holding the input gate across disk flushes;
    // the normal output gate still waits for persistence before acknowledging.
    const result = this.ctx.storage.transactionSync(() => {
      const storage = this.ctx.storage.kv;
      const installedScope = storage.get<string>("scope");
      const storedActive = storage.get<number>("active");
      let active = storedActive ?? 0;
      if ((installedScope && (installedScope !== input.scope || storedActive === undefined)) ||
          !Number.isSafeInteger(active) || active < 0 ||
          (!installedScope && new Map(storage.list({ prefix: "writer:", limit: 1 })).size > 0)) {
        return { status: 409 };
      }
      const fence = storage.get<Fence>("fence");
      if (url.pathname === "/inspect") {
        if ((!installedScope && (storedActive !== undefined || fence !== undefined)) ||
            (fence && (fence.scope !== input.scope || !UUID.test(fence.owner)))) return { status: 409 };
        const owner = fence?.owner ?? null;
        // Legacy boolean tickets have no provenance. Preserve them and report that
        // limitation; timestamps and version IDs never authorize ticket removal.
        const entries = new Map(storage.list<true | WriterTicket>({ prefix: "writer:", limit: 1001 }));
        const tickets: RecoveryWriterInspection["tickets"] = { scanned: entries.size,
          complete: entries.size <= 1000, legacy: 0, attributed: 0, oldestEnteredAt: null,
          runtimeRevisions: Object.create(null) as Record<string, number>,
          kinds: Object.create(null) as Record<string, number> };
        for (const value of entries.values()) {
          if (value === true) { tickets.legacy++; tickets.kinds.unknown = (tickets.kinds.unknown ?? 0) + 1; continue; }
          if (!value || !Number.isSafeInteger(value.enteredAt) || value.enteredAt < 0 ||
              (value.runtimeRevision !== null &&
                (typeof value.runtimeRevision !== "string" || !REVISION.test(value.runtimeRevision))) ||
              (value.kind !== undefined && !validKind(value.kind))) return { status: 409 };
          tickets.attributed++;
          tickets.oldestEnteredAt = Math.min(tickets.oldestEnteredAt ?? value.enteredAt, value.enteredAt);
          const revision = value.runtimeRevision ?? "unavailable";
          tickets.runtimeRevisions[revision] = (tickets.runtimeRevisions[revision] ?? 0) + 1;
          const kind = value.kind ?? "unknown";
          tickets.kinds[kind] = (tickets.kinds[kind] ?? 0) + 1;
        }
        if (tickets.scanned > active || (tickets.complete && tickets.scanned !== active)) return { status: 409 };
        return { status: 200, body: { owner, scope: input.scope, active,
          drained: owner !== null && active === 0, initialized: installedScope !== undefined, tickets } };
      }
      const key = "writer:" + input.id;
      const entered = storage.get(key);
      if (url.pathname === "/enter") {
        if (fence || entered || active === Number.MAX_SAFE_INTEGER) return { status: 409 };
        active++;
        storage.put(key, { enteredAt: Date.now(), runtimeRevision: input.runtimeRevision ?? null,
          kind: input.kind ?? "unknown" });
      } else if (url.pathname === "/leave") {
        if (entered) {
          if (active === 0) return { status: 409 };
          storage.delete(key);
          active--;
        }
      } else if (url.pathname === "/claim") {
        if (fence && fence.owner !== input.id) return { status: 409 };
        storage.put("fence", { owner: input.id, scope: input.scope });
      } else if (url.pathname === "/assert") {
        if (fence?.owner !== input.id) return { status: 409 };
      } else if (url.pathname === "/release") {
        if (fence && fence.owner !== input.id) return { status: 409 };
        if (storage.get(IMPORT_QUARANTINE_KEY)) return {status: 409};
        const migration = storage.get<ProductionImportState>(IMPORT_STATE_KEY);
        if (migration && (migration.pending !== null ||
            typeof migration.readbackSha256 !== "string" || !HASH.test(migration.readbackSha256))) return { status: 409 };
        storage.delete("fence");
      }
      storage.put("scope", input.scope);
      storage.put("active", active);
      const owner = url.pathname === "/release" ? null : (storage.get<Fence>("fence"))?.owner ?? null;
      return { status: 200, body: { owner, scope: input.scope, active, drained: owner !== null && active === 0 } };
    });
    return new Response(result.body ? JSON.stringify(result.body) : null, {
      status: result.status, headers: { "content-type": "application/json", "cache-control": "no-store",
        "x-recovery-coordinator-revision": "sqlite-sync-v1",
        "x-recovery-handler-ms": String(Date.now() - started) },
    });
  }
}

/** Fresh staging namespace; never resets or imports the legacy census. */
export class RecoveryWriterCoordinatorV2 extends RecoveryWriterCoordinator {}

/** New five-store candidate; existing V1/V2 namespaces remain intact. */
export class RecoveryWriterCoordinatorV3 extends RecoveryWriterCoordinator {}
export class RecoveryWriterCoordinatorV4 extends RecoveryWriterCoordinator {}

/** Permanently sealed v1 namespace. Its storage and quarantine are retained. */
export class RecoveryWriterCoordinatorProduction extends RecoveryWriterCoordinator {
  override fetch(_request: Request): Promise<Response> {
    return Promise.resolve(new Response("production_cohort_v1_quarantined", {status: 410}));
  }
}
/** Retained v2 namespace and its terminal R2 pending/quarantine. */
export class RecoveryWriterCoordinatorProductionV2 extends RecoveryWriterCoordinator {
  override fetch(_request: Request): Promise<Response> {
    return Promise.resolve(new Response("production_cohort_v2_quarantined", {status: 410}));
  }
}
/** Fresh v3 namespace; neither quarantined import can reach these bindings. */
export class RecoveryWriterCoordinatorProductionV3 extends RecoveryWriterCoordinator {
  override fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/migration/")) return productionImportCommand(this.ctx, this.env, request);
    return super.fetch(request);
  }
}
