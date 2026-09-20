import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { access, constants, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import net from "node:net";
import { after, before, beforeEach, test } from "node:test";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const foundationSql = await readFile(join(projectRoot, "supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql"), "utf8");
const leaseSql = await readFile(join(projectRoot, "supabase/migrations/20260921100000_add_stripe_dispatch_leases.sql"), "utf8");
const projectionSql = await readFile(join(projectRoot, "supabase/migrations/20260921110000_add_stripe_invoice_projection.sql"), "utf8");
const configuredRuntimeRoot = process.env.FANMARK_PG17_RUNTIME_ROOT ?? "";
const runtimeEnabled = configuredRuntimeRoot.length > 0;
const skipReason = runtimeEnabled
  ? undefined
  : "set FANMARK_PG17_RUNTIME_ROOT to the pinned private PostgreSQL 17 runtime; this test never uses an external DSN";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SUBSCRIPTION_ROW_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "cus_pg17_concurrency";
const SUBSCRIPTION_ID = "sub_pg17_concurrency";
const API_VERSION = "2025-08-27.basil";
const acceptSql = `select * from public.accept_stripe_webhook_receipt($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`;
const claimSql = `select * from public.claim_stripe_webhook_dispatches($1::boolean, $2::integer, $3::integer)`;
const acquireFenceSql = `select * from public.acquire_stripe_customer_fence($1::uuid, $2::uuid, $3::boolean, $4::uuid, $5::bigint, $6::text, $7::integer)`;
const applyProjectionSql = `select * from public.apply_stripe_invoice_projection($1::uuid, $2::uuid, $3::boolean, $4::uuid, $5::bigint, $6::text, $7::text, $8::text, $9::text, $10::text, $11::uuid, $12::bigint, $13::text, $14::text, $15::text, $16::text, $17::timestamptz)`;

let runtime;
let Client;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runBinary(binary, args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let forceKillTimer;
    const timeout = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 2_000);
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 20_000) stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 20_000) stderr += String(chunk); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
      if (code === 0 && !timedOut) return resolve({ stdout, stderr });
      const reason = timedOut
        ? "timed out"
        : `${binary} exited with code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}`;
      const diagnostics = `${stderr}\n${stdout}`;
      reject(new Error(`${reason}: ${diagnostics.slice(-4_000)}`));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function noServerStatus(message) {
  return /no server (?:is )?running|does not appear to be running|PID file .* does not exist/i.test(message);
}

async function pgCtlStatus(state) {
  try {
    await runBinary(state.binaries.pgCtl, ["-D", state.dataDir, "status"], { timeoutMs: 2_000 });
    return "running";
  } catch (error) {
    return noServerStatus(error.message) ? "stopped" : "unknown";
  }
}

async function ownServerState(state) {
  try {
    const pidFile = await readFile(join(state.dataDir, "postmaster.pid"), "utf8");
    const pid = Number(pidFile.split(/\r?\n/, 1)[0]);
    if (!Number.isInteger(pid) || pid <= 0) return "unknown";
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return pgCtlStatus(state);
      return "unknown";
    }
    const processInfo = await runBinary("/bin/ps", ["-p", String(pid), "-o", "command="], { timeoutMs: 2_000 }).catch(() => null);
    if (!processInfo) return "unknown";
    const command = processInfo.stdout.trim();
    if (!command) return "unknown";
    return command.includes(state.dataDir) && command.includes("postgres") ? "running" : "unknown";
  } catch (error) {
    if (error.code !== "ENOENT") return "unknown";
    return pgCtlStatus(state);
  }
}

async function stopOwnServer(state) {
  let status = await ownServerState(state);
  if (status === "stopped") return true;
  if (status !== "running") return false;
  await runBinary(state.binaries.pgCtl, ["-D", state.dataDir, "-m", "fast", "-w", "stop"]).catch(() => {});
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    status = await ownServerState(state);
    if (status === "stopped") return true;
    if (status === "unknown") return false;
    await delay(50);
  }
  await runBinary(state.binaries.pgCtl, ["-D", state.dataDir, "-m", "immediate", "-w", "stop"]).catch(() => {});
  return (await ownServerState(state)) === "stopped";
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  const { port } = address;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function validateRuntimeRoot(runtimeRoot) {
  assert.ok(runtimeRoot.startsWith("/"), "FANMARK_PG17_RUNTIME_ROOT must be an absolute local path");
  const packageRoot = join(runtimeRoot, "node_modules/@embedded-postgres/darwin-arm64");
  const binaries = {
    initdb: join(packageRoot, "native/bin/initdb"),
    pgCtl: join(packageRoot, "native/bin/pg_ctl"),
    postgres: join(packageRoot, "native/bin/postgres"),
  };
  for (const binary of Object.values(binaries)) await access(binary, constants.X_OK);
  const pgModule = join(runtimeRoot, "node_modules/pg/lib/index.js");
  await access(pgModule, constants.R_OK);
  const version = await runBinary(binaries.postgres, ["--version"]);
  assert.match(version.stdout.trim(), /^postgres \(PostgreSQL\) 17\.10\b/);
  return { binaries, pgModule };
}

async function bootstrapDatabase(client) {
  await client.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create function auth.role() returns text language sql stable
      as $function$ select current_setting('request.jwt.claim.role', true) $function$;
    create table public.user_settings (
      user_id uuid primary key,
      stripe_customer_id text,
      plan_type text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index user_settings_stripe_customer_id_key
      on public.user_settings (stripe_customer_id)
      where stripe_customer_id is not null;
    create table public.user_subscriptions (
      id uuid primary key,
      user_id uuid not null,
      stripe_customer_id text not null,
      stripe_subscription_id text not null,
      product_id text not null,
      status text not null,
      current_period_start timestamptz,
      current_period_end timestamptz,
      cancel_at_period_end boolean not null default false,
      price_id text,
      amount integer,
      currency text,
      interval text,
      interval_count integer,
      payment_failure_at timestamptz,
      next_payment_attempt timestamptz,
      payment_failure_type text,
      updated_at timestamptz not null default now(),
      unique (user_id, stripe_subscription_id)
    );
  `);
  await client.query(foundationSql);
  await client.query(leaseSql);
  await client.query(projectionSql);
}

async function startRuntime() {
  const validated = await validateRuntimeRoot(configuredRuntimeRoot);
  const sandboxRoot = await mkdtemp(join(tmpdir(), "fanmark-pg17-concurrency-"));
  const dataDir = join(sandboxRoot, "data");
  const socketDir = join(sandboxRoot, "socket");
  await mkdir(socketDir);
  const password = randomBytes(24).toString("hex");
  const passwordFile = join(sandboxRoot, "password");
  const logFile = join(sandboxRoot, "postgres.log");
  await writeFile(passwordFile, `${password}\n`, { mode: 0o600 });
  const port = await findFreePort();
  const connectionConfig = {
    host: "127.0.0.1", port, database: "postgres", user: "postgres", password,
    connectionTimeoutMillis: 5_000, query_timeout: 15_000,
    application_name: "fanmark-pg17-concurrency",
  };
  const state = {
    ...validated, sandboxRoot, dataDir, socketDir, passwordFile, logFile, port,
    connectionConfig, startupAttempted: false, rootClient: null,
  };
  try {
    await runBinary(validated.binaries.initdb, [
      "-D", dataDir, "-U", "postgres", `--pwfile=${passwordFile}`,
      "--auth=scram-sha-256", "--no-locale", "--encoding=UTF8",
    ]);
    state.startupAttempted = true;
    await runBinary(validated.binaries.pgCtl, [
      "-D", dataDir, "-o", `-p ${port} -h 127.0.0.1 -k ${socketDir}`,
      "-l", logFile, "-w", "start",
    ]);
    const pgModule = await import(pathToFileURL(validated.pgModule).href);
    ({ Client } = pgModule.default ?? pgModule);
    assert.equal(typeof Client, "function", "the pinned pg module must export Client");
    const rootClient = new Client(connectionConfig);
    state.rootClient = rootClient;
    await rootClient.connect();
    const version = await rootClient.query(`
      select current_setting('server_version_num') as server_version_num,
             current_setting('server_version') as server_version,
             inet_server_addr()::text as server_address
    `);
    assert.match(version.rows[0].server_version_num, /^17\d{4}$/);
    assert.match(version.rows[0].server_version, /^17\./);
    assert.match(version.rows[0].server_address, /^127\.0\.0\.1(?:\/\d+)?$/);
    await bootstrapDatabase(rootClient);
    return state;
  } catch (error) {
    await state.rootClient?.end().catch(() => {});
    if (state.startupAttempted) {
      const stopped = await stopOwnServer(state);
      if (!stopped) {
        throw new Error(`PostgreSQL cleanup could not prove its own server stopped; private cluster preserved at ${sandboxRoot}`, { cause: error });
      }
    }
    await rm(sandboxRoot, { recursive: true, force: true });
    throw error;
  }
}

async function stopRuntime() {
  if (!runtime) return;
  await runtime.rootClient?.end().catch(() => {});
  if (runtime.startupAttempted) {
    const stopped = await stopOwnServer(runtime);
    if (!stopped) {
      throw new Error(`PostgreSQL cleanup could not prove its own server stopped; private cluster preserved at ${runtime.sandboxRoot}`);
    }
  }
  await rm(runtime.sandboxRoot, { recursive: true, force: true });
  runtime = undefined;
}

async function openServiceClient() {
  const client = new Client(runtime.connectionConfig);
  try {
    await client.connect();
    await client.query("set role service_role");
    await client.query("select set_config('request.jwt.claim.role', 'service_role', false)");
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

async function withServiceClient(callback) {
  const client = await openServiceClient();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function adminQuery(sql, params = []) {
  return runtime.rootClient.query(sql, params);
}

async function resetSyntheticState() {
  await adminQuery(`truncate billing_ingress.stripe_application_ledger, billing_ingress.stripe_sync_fences, billing_ingress.stripe_webhook_dispatches, billing_ingress.stripe_webhook_receipts cascade`);
  await adminQuery("delete from public.user_subscriptions");
  await adminQuery("delete from public.user_settings");
}

function receiptInput({
  eventId,
  eventType = "invoice.payment_succeeded",
  invoiceId = `in_${eventId}`,
  customerId = CUSTOMER_ID,
  subscriptionId = SUBSCRIPTION_ID,
} = {}) {
  const payload = {
    schema_version: 1,
    event: { id: eventId, type: eventType, created: 1_750_000_000, api_version: API_VERSION, livemode: true },
    object: { type: "invoice", id: invoiceId },
    branch: "invoice",
    reference: { object_type: "invoice", object_id: invoiceId },
    invoice: { id: invoiceId, customer_id: customerId, subscription_id: subscriptionId },
  };
  const serialized = JSON.stringify(payload);
  return {
    eventId, eventType, invoiceId, customerId, subscriptionId, payload,
    normalizedHash: sha256(serialized), rawHash: sha256(`raw:${serialized}`),
  };
}

async function acceptReceipt(client, input) {
  const result = await client.query(acceptSql, [
    input.eventId, true, input.eventType, "invoice", input.invoiceId, API_VERSION, 1,
    JSON.stringify(input.payload), input.normalizedHash, input.rawHash,
  ]);
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function claimDispatches(client, batchSize = 1, leaseSeconds = 30) {
  return (await client.query(claimSql, [true, batchSize, leaseSeconds])).rows;
}

async function acquireFence(client, dispatch, customerId = CUSTOMER_ID, leaseSeconds = 30) {
  const result = await client.query(acquireFenceSql, [
    dispatch.receipt_id, dispatch.dispatch_id, true, dispatch.lease_token,
    dispatch.claim_generation, customerId, leaseSeconds,
  ]);
  return result.rows[0] ?? null;
}

async function applyProjection(client, {
  dispatch, fence, sourceEventType, sourceInvoiceId,
  currentInvoiceId = sourceInvoiceId, customerId = CUSTOMER_ID,
  subscriptionId = SUBSCRIPTION_ID, attemptKey = `${sourceInvoiceId}:attempt:1`,
  outcome = "paid", invoiceStatus = "paid", paymentIntentStatus = "succeeded",
  nextPaymentAttempt = null,
}) {
  return client.query(applyProjectionSql, [
    dispatch.receipt_id, dispatch.dispatch_id, true, dispatch.lease_token,
    dispatch.claim_generation, customerId, subscriptionId, sourceInvoiceId,
    currentInvoiceId, attemptKey, fence.fence_token, fence.fence_generation,
    sourceEventType, outcome, invoiceStatus, paymentIntentStatus, nextPaymentAttempt,
  ]);
}

async function seedSubscription() {
  await adminQuery(`insert into public.user_settings (user_id, stripe_customer_id, plan_type) values ($1::uuid, $2, 'creator')`, [USER_ID, CUSTOMER_ID]);
  await adminQuery(`insert into public.user_subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, product_id, status) values ($1::uuid, $2::uuid, $3, $4, 'prod_creator', 'active')`, [SUBSCRIPTION_ROW_ID, USER_ID, CUSTOMER_ID, SUBSCRIPTION_ID]);
}

async function installLedgerDelayTrigger(seconds) {
  const delay = Number(seconds);
  assert.ok(Number.isFinite(delay) && delay > 0 && delay < 10);
  await adminQuery(`
    create or replace function public.pg17_delay_ledger_insert() returns trigger language plpgsql
    as $function$
    begin perform pg_sleep(${delay}); return new; end
    $function$;
    create trigger pg17_delay_ledger_insert before insert on billing_ingress.stripe_application_ledger
      for each row execute function public.pg17_delay_ledger_insert();
  `);
}

async function removeLedgerDelayTrigger() {
  await adminQuery(`drop trigger if exists pg17_delay_ledger_insert on billing_ingress.stripe_application_ledger; drop function if exists public.pg17_delay_ledger_insert();`);
}

async function installSubscriptionFailureTrigger() {
  await adminQuery(`
    create or replace function public.pg17_force_subscription_failure() returns trigger language plpgsql
    as $function$
    begin raise exception 'forced PostgreSQL 17 subscription rollback'; end
    $function$;
    create trigger pg17_force_subscription_failure before update on public.user_subscriptions
      for each row execute function public.pg17_force_subscription_failure();
  `);
}

async function removeSubscriptionFailureTrigger() {
  await adminQuery(`drop trigger if exists pg17_force_subscription_failure on public.user_subscriptions; drop function if exists public.pg17_force_subscription_failure();`);
}

async function stateFor(eventId = null) {
  const result = await adminQuery(`
    select r.status as receipt_status, d.status as dispatch_status, d.lease_token, d.lease_until,
           f.owner_token as fence_token, f.lease_until as fence_lease_until,
           (select count(*)::integer from billing_ingress.stripe_application_ledger) as ledger_count,
           s.payment_failure_at, s.next_payment_attempt, s.payment_failure_type
      from billing_ingress.stripe_webhook_receipts r
      join billing_ingress.stripe_webhook_dispatches d on d.receipt_id = r.id and d.livemode = r.livemode and d.stripe_event_id = r.stripe_event_id
      left join billing_ingress.stripe_sync_fences f on f.livemode = r.livemode and f.stripe_customer_id = $1
      left join public.user_subscriptions s on s.stripe_subscription_id = $2
     where ($3::text is null or r.stripe_event_id = $3)
     order by r.created_at
     limit 1
  `, [CUSTOMER_ID, SUBSCRIPTION_ID, eventId]);
  return result.rows[0] ?? null;
}

async function countRows(table) {
  const result = await adminQuery(`select count(*)::integer as count from ${table}`);
  return result.rows[0].count;
}

async function waitForLockBlock(waitingPid, blockingPid, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await adminQuery(`
      select state, wait_event_type,
             ($2::integer = any(pg_blocking_pids(pid))) as blocked_by_blocker
        from pg_stat_activity
       where pid = $1::integer
    `, [waitingPid, blockingPid]);
    const row = result.rows[0];
    if (row?.wait_event_type === "Lock" && row.blocked_by_blocker) return row;
    await delay(20);
  }
  throw new Error(`expected backend ${waitingPid} to wait on a lock held by ${blockingPid}`);
}

before(async () => {
  if (!runtimeEnabled) return;
  runtime = await startRuntime();
});

beforeEach(async () => {
  if (!runtime) return;
  await resetSyntheticState();
});

after(async () => {
  await stopRuntime();
});

test("PostgreSQL 17 separate connections converge duplicate receipt delivery", {
  skip: skipReason,
}, async () => {
  const input = receiptInput({ eventId: "evt_pg17_duplicate" });
  const first = await openServiceClient();
  const second = await openServiceClient();
  let secondResultPromise;
  try {
    await first.query("begin");
    const firstPid = (await first.query("select pg_backend_pid()")).rows[0].pg_backend_pid;
    const firstRow = await acceptReceipt(first, input);
    const secondPid = (await second.query("select pg_backend_pid()")).rows[0].pg_backend_pid;
    await second.query("begin");
    secondResultPromise = acceptReceipt(second, input);
    secondResultPromise.catch(() => {});
    await waitForLockBlock(secondPid, firstPid);
    await first.query("commit");
    const secondRow = await secondResultPromise;
    await second.query("commit");

    assert.notEqual(firstPid, secondPid);
    assert.equal(firstRow.outcome, "accepted");
    assert.equal(secondRow.outcome, "duplicate_nonterminal");
    assert.equal(firstRow.receipt_id, secondRow.receipt_id);
    assert.equal(firstRow.dispatch_id, secondRow.dispatch_id);
  } finally {
    await first.query("rollback").catch(() => {});
    if (secondResultPromise) await secondResultPromise.catch(() => {});
    await second.query("rollback").catch(() => {});
    await first.end();
    await second.end();
  }
  assert.equal(await countRows("billing_ingress.stripe_webhook_receipts"), 1);
  assert.equal(await countRows("billing_ingress.stripe_webhook_dispatches"), 1);
});

test("PostgreSQL 17 SKIP LOCKED claimants receive disjoint dispatches", {
  skip: skipReason,
}, async () => {
  const inputs = Array.from({ length: 4 }, (_, index) =>
    receiptInput({ eventId: `evt_pg17_claim_${index + 1}` }),
  );
  await withServiceClient(async (client) => {
    for (const input of inputs) await acceptReceipt(client, input);
  });

  const first = await openServiceClient();
  const second = await openServiceClient();
  try {
    await first.query("begin");
    const firstPid = (await first.query("select pg_backend_pid()")).rows[0].pg_backend_pid;
    const firstRows = await claimDispatches(first, 2);
    assert.equal(firstRows.length, 2);

    await second.query("begin");
    const secondPid = (await second.query("select pg_backend_pid()")).rows[0].pg_backend_pid;
    const secondRows = await claimDispatches(second, 2);
    assert.equal(secondRows.length, 2);

    const firstActivity = await adminQuery(`select state from pg_stat_activity where pid = $1::integer`, [firstPid]);
    assert.equal(firstActivity.rows[0].state, "idle in transaction");
    assert.notEqual(firstPid, secondPid);
    assert.equal(new Set(firstRows.map((row) => row.dispatch_id)).size, 2);
    assert.equal(new Set(secondRows.map((row) => row.dispatch_id)).size, 2);
    assert.equal(new Set([...firstRows, ...secondRows].map((row) => row.dispatch_id)).size, 4);

    await second.query("commit");
    await first.query("commit");
  } finally {
    await first.query("rollback").catch(() => {});
    await second.query("rollback").catch(() => {});
    await first.end();
    await second.end();
  }
  assert.equal(await countRows("billing_ingress.stripe_webhook_dispatches"), 4);
});

test("PostgreSQL 17 customer fence contention grants one owner", {
  skip: skipReason,
}, async () => {
  const inputs = [
    receiptInput({ eventId: "evt_pg17_fence_a", invoiceId: "in_pg17_fence_a" }),
    receiptInput({ eventId: "evt_pg17_fence_b", invoiceId: "in_pg17_fence_b" }),
  ];
  const dispatches = await withServiceClient(async (client) => {
    for (const input of inputs) await acceptReceipt(client, input);
    return claimDispatches(client, 2, 30);
  });
  assert.equal(dispatches.length, 2);
  const first = await openServiceClient();
  const second = await openServiceClient();
  let secondFencePromise;
  try {
    await first.query("begin");
    const firstPid = (await first.query("select pg_backend_pid()")).rows[0].pg_backend_pid;
    const firstFence = await acquireFence(first, dispatches[0], CUSTOMER_ID, 30);
    assert.ok(firstFence);
    await second.query("begin");
    const secondPid = (await second.query("select pg_backend_pid()")).rows[0].pg_backend_pid;
    secondFencePromise = acquireFence(second, dispatches[1], CUSTOMER_ID, 30);
    secondFencePromise.catch(() => {});
    await waitForLockBlock(secondPid, firstPid);
    await first.query("commit");
    const secondFence = await secondFencePromise;
    await second.query("commit");

    assert.notEqual(firstPid, secondPid);
    assert.ok(firstFence);
    assert.equal(secondFence, null);
    const fenceState = await adminQuery(`
      select owner_token, generation, lease_until > clock_timestamp() as lease_active
        from billing_ingress.stripe_sync_fences
       where livemode = true and stripe_customer_id = $1
`, [CUSTOMER_ID]);
    assert.equal(fenceState.rows.length, 1);
    assert.equal(fenceState.rows[0].owner_token, firstFence.fence_token);
    assert.equal(Number(fenceState.rows[0].generation), Number(firstFence.fence_generation));
    assert.equal(fenceState.rows[0].lease_active, true);
  } finally {
    await first.query("rollback").catch(() => {});
    if (secondFencePromise) await secondFencePromise.catch(() => {});
    await second.query("rollback").catch(() => {});
    await first.end();
    await second.end();
  }
});

test("PostgreSQL 17 rejects an expired holder at the final apply fence", {
  skip: skipReason,
}, async () => {
  await seedSubscription();
  const input = receiptInput({ eventId: "evt_pg17_expired_holder", invoiceId: "in_pg17_expired_holder" });
  const dispatch = await withServiceClient(async (client) => {
    await acceptReceipt(client, input);
    const rows = await claimDispatches(client, 1, 2);
    assert.equal(rows.length, 1);
    return rows[0];
  });
  const fence = await withServiceClient((client) => acquireFence(client, dispatch, CUSTOMER_ID, 2));
  assert.ok(fence);

  await installLedgerDelayTrigger(2.2);
  try {
    const error = await withServiceClient(async (client) => {
      try {
        await applyProjection(client, {
          dispatch,
          fence,
          sourceEventType: input.eventType,
          sourceInvoiceId: input.invoiceId,
        });
        return null;
      } catch (caught) {
        return caught;
      }
    });
    assert.ok(error);
    assert.equal(error.code, "P0001");
    assert.match(error.message, /lease expired at mutation boundary/);

    const state = await stateFor(input.eventId);
    assert.equal(state.receipt_status, "processing");
    assert.equal(state.dispatch_status, "processing");
    assert.equal(state.ledger_count, 0);
    assert.equal(state.payment_failure_at, null);
    assert.equal(state.fence_token, fence.fence_token);
  } finally {
    await removeLedgerDelayTrigger();
  }
});

test("PostgreSQL 17 rolls back ledger and terminal transitions on subscription failure", {
  skip: skipReason,
}, async () => {
  await seedSubscription();
  const input = receiptInput({ eventId: "evt_pg17_rollback", invoiceId: "in_pg17_rollback" });
  const dispatch = await withServiceClient(async (client) => {
    await acceptReceipt(client, input);
    const rows = await claimDispatches(client, 1, 30);
    assert.equal(rows.length, 1);
    return rows[0];
  });
  const fence = await withServiceClient((client) => acquireFence(client, dispatch, CUSTOMER_ID, 30));
  assert.ok(fence);

  await installSubscriptionFailureTrigger();
  try {
    const error = await withServiceClient(async (client) => {
      try {
        await applyProjection(client, {
          dispatch,
          fence,
          sourceEventType: input.eventType,
          sourceInvoiceId: input.invoiceId,
        });
        return null;
      } catch (caught) {
        return caught;
      }
    });
    assert.ok(error);
    assert.match(error.message, /forced PostgreSQL 17 subscription rollback/);

    const state = await stateFor(input.eventId);
    assert.equal(state.receipt_status, "processing");
    assert.equal(state.dispatch_status, "processing");
    assert.equal(state.ledger_count, 0);
    assert.equal(state.payment_failure_at, null);
    assert.equal(state.next_payment_attempt, null);
    assert.equal(state.payment_failure_type, null);
    assert.equal(state.fence_token, fence.fence_token);
  } finally {
    await removeSubscriptionFailureTrigger();
  }
});
