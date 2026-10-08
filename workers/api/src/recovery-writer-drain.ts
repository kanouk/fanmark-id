import { DurableObject } from "cloudflare:workers";
import type { Env } from "./repository";

const ORIGIN = "https://recovery-writer.internal";
const NAME = "recovery-writers-v1";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const REVISION = /^[A-Za-z0-9:_-]{1,128}$/u;
type Fence = { owner: string; scope: string };
export type RecoveryWriterStatus = { owner: string | null; scope: string; active: number; drained: boolean };
type WriterTicket = { enteredAt: number; runtimeRevision: string | null };
export type RecoveryWriterInspection = RecoveryWriterStatus & { initialized: boolean; tickets: {
  scanned: number; complete: boolean; legacy: number; attributed: number;
  oldestEnteredAt: number | null; runtimeRevisions: Record<string, number>;
} };

export class RecoveryWriterDrainError extends Error {
  constructor() { super("recovery_writer_unavailable"); this.name = "RecoveryWriterDrainError"; }
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

async function command(env: Env, operation: string, id: string): Promise<RecoveryWriterStatus> {
  const scope = scopeFor(env);
  const stub = env.RECOVERY_DRAIN!.get(env.RECOVERY_DRAIN!.idFromName(NAME));
  try {
    const response = await stub.fetch(`${ORIGIN}/${operation}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, scope,
        ...(operation === "enter" ? { runtimeRevision: env.CF_VERSION_METADATA?.id ?? null } : {}) }),
    });
    if (response.status !== 200) throw new RecoveryWriterDrainError();
    const value = await response.json() as RecoveryWriterStatus;
    if (value.scope !== scope || !Number.isSafeInteger(value.active) || value.active < 0 ||
        (value.owner !== null && !UUID.test(value.owner)) ||
        value.drained !== (value.owner !== null && value.active === 0)) throw new RecoveryWriterDrainError();
    return value;
  } catch { throw new RecoveryWriterDrainError(); }
}

/** Tickets never expire: a crashed or unacknowledged writer blocks capture rather than falsely draining. */
export async function withRecoveryWriter<T>(env: Env, operation: () => Promise<T>,
  context?: Pick<ExecutionContext, "waitUntil">): Promise<T> {
  if (!recoveryWriterTrackingSelected(env)) return operation();
  const id = crypto.randomUUID();
  const lifecycle = (async () => {
    // A lost enter response never permits the operation to run. Its ticket is retained.
    await command(env, "enter", id);
    try { return await operation(); }
    finally { await command(env, "leave", id); }
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
    const url = new URL(request.url);
    if (url.origin !== ORIGIN || url.search || request.method !== "POST" ||
        !["/enter", "/leave", "/inspect", "/claim", "/assert", "/release"].includes(url.pathname)) {
      return new Response(null, { status: 404 });
    }
    if (Number(request.headers.get("content-length") ?? 0) > 384) return new Response(null, { status: 400 });
    let input: { id: string; scope: string; runtimeRevision?: string | null };
    try {
      const text = await request.text();
      if (text.length > 384) return new Response(null, { status: 400 });
      input = JSON.parse(text);
      const keys = Object.keys(input ?? {}).sort().join(",");
      if (!input || !(keys === "id,scope" || (url.pathname === "/enter" && keys === "id,runtimeRevision,scope")) ||
          (input.runtimeRevision !== undefined && input.runtimeRevision !== null &&
            (typeof input.runtimeRevision !== "string" || !REVISION.test(input.runtimeRevision))) ||
          !UUID.test(input.id) || !HASH.test(input.scope) ||
          input.scope !== scopeFor(this.env)) return new Response(null, { status: 400 });
    } catch { return new Response(null, { status: 400 }); }
    return this.ctx.blockConcurrencyWhile(async () => {
      const result = await this.ctx.storage.transaction(async storage => {
        const installedScope = await storage.get<string>("scope");
        const storedActive = await storage.get<number>("active");
        let active = storedActive ?? 0;
        if ((installedScope && (installedScope !== input.scope || storedActive === undefined)) ||
            !Number.isSafeInteger(active) || active < 0 ||
            (!installedScope && (await storage.list({ prefix: "writer:", limit: 1 })).size > 0)) {
          return { status: 409 };
        }
        const fence = await storage.get<Fence>("fence");
        if (url.pathname === "/inspect") {
          if ((!installedScope && (storedActive !== undefined || fence !== undefined)) ||
              (fence && (fence.scope !== input.scope || !UUID.test(fence.owner)))) return { status: 409 };
          const owner = fence?.owner ?? null;
          // Legacy boolean tickets have no provenance. Preserve them and report that
          // limitation; timestamps and version IDs never authorize ticket removal.
          const entries = await storage.list<true | WriterTicket>({ prefix: "writer:", limit: 1001 });
          const tickets: RecoveryWriterInspection["tickets"] = { scanned: entries.size,
            complete: entries.size <= 1000, legacy: 0, attributed: 0, oldestEnteredAt: null,
            runtimeRevisions: Object.create(null) as Record<string, number> };
          for (const value of entries.values()) {
            if (value === true) { tickets.legacy++; continue; }
            if (!value || !Number.isSafeInteger(value.enteredAt) || value.enteredAt < 0 ||
                (value.runtimeRevision !== null &&
                  (typeof value.runtimeRevision !== "string" || !REVISION.test(value.runtimeRevision)))) return { status: 409 };
            tickets.attributed++;
            tickets.oldestEnteredAt = Math.min(tickets.oldestEnteredAt ?? value.enteredAt, value.enteredAt);
            const revision = value.runtimeRevision ?? "unavailable";
            tickets.runtimeRevisions[revision] = (tickets.runtimeRevisions[revision] ?? 0) + 1;
          }
          if (tickets.scanned > active || (tickets.complete && tickets.scanned !== active)) return { status: 409 };
          return { status: 200, body: { owner, scope: input.scope, active,
            drained: owner !== null && active === 0, initialized: installedScope !== undefined, tickets } };
        }
        const key = "writer:" + input.id;
        const entered = await storage.get(key);
        if (url.pathname === "/enter") {
          if (fence || entered || active === Number.MAX_SAFE_INTEGER) return { status: 409 };
          active++;
          await storage.put(key, { enteredAt: Date.now(), runtimeRevision: input.runtimeRevision ?? null });
        } else if (url.pathname === "/leave") {
          if (entered) {
            if (active === 0) return { status: 409 };
            await storage.delete(key);
            active--;
          }
        } else if (url.pathname === "/claim") {
          if (fence && fence.owner !== input.id) return { status: 409 };
          await storage.put("fence", { owner: input.id, scope: input.scope });
        } else if (url.pathname === "/assert") {
          if (fence?.owner !== input.id) return { status: 409 };
        } else if (url.pathname === "/release") {
          if (fence && fence.owner !== input.id) return { status: 409 };
          await storage.delete("fence");
        }
        await storage.put({ scope: input.scope, active });
        const owner = url.pathname === "/release" ? null : (await storage.get<Fence>("fence"))?.owner ?? null;
        return { status: 200, body: { owner, scope: input.scope, active, drained: owner !== null && active === 0 } };
      });
      return new Response(result.body ? JSON.stringify(result.body) : null, {
        status: result.status, headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    });
  }
}
