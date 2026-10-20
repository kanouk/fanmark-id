import assert from "node:assert/strict";
import { access, constants, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import net from "node:net";
import { after, before, test } from "node:test";

import { createPsqlSession, exportSnapshot } from "../../../scripts/migration/snapshot-export.mjs";
import { verifySnapshot } from "../../../scripts/migration/snapshot-verify.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaReadinessSql = await readFile(join(projectRoot, "scripts/migration/schema-readiness.sql"), "utf8");
const configuredRuntimeRoot = process.env.FANMARK_PG17_RUNTIME_ROOT ?? "";
const runtimeEnabled = configuredRuntimeRoot.length > 0;
const skipReason = runtimeEnabled
  ? undefined
  : "set FANMARK_PG17_RUNTIME_ROOT to the pinned private PostgreSQL 17 runtime; this test never uses an external DSN";
const psqlPath = "/opt/homebrew/opt/libpq/bin/psql";

let Client;
let runtime;
let baselineCatalog;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
      if (settled) return;
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2_000);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { if (stdout.length < 20_000) stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { if (stderr.length < 20_000) stderr += String(chunk); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimer);
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
      reject(new Error(`${reason}: ${`${stderr}\n${stdout}`.slice(-4_000)}`));
    });
  });
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function validateRuntimeRoot(runtimeRoot) {
  assert.ok(runtimeRoot.startsWith("/"), "FANMARK_PG17_RUNTIME_ROOT must be absolute");
  const packageRoot = join(runtimeRoot, "node_modules/@embedded-postgres/darwin-arm64");
  const binaries = {
    initdb: join(packageRoot, "native/bin/initdb"),
    pgCtl: join(packageRoot, "native/bin/pg_ctl"),
    postgres: join(packageRoot, "native/bin/postgres"),
  };
  for (const binary of Object.values(binaries)) await access(binary, constants.X_OK);
  await access(psqlPath, constants.X_OK);
  const pgModule = join(runtimeRoot, "node_modules/pg/lib/index.js");
  await access(pgModule, constants.R_OK);
  const version = await runBinary(binaries.postgres, ["--version"]);
  assert.match(version.stdout.trim(), /^postgres \(PostgreSQL\) 17\.10\b/);
  return { binaries, pgModule };
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
  await runBinary(state.binaries.pgCtl, ["-D", state.dataDir, "-m", "fast", "-w", "stop"], { timeoutMs: 10_000 }).catch(() => {});
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    status = await ownServerState(state);
    if (status === "stopped") return true;
    if (status === "unknown") return false;
    await delay(50);
  }
  await runBinary(state.binaries.pgCtl, ["-D", state.dataDir, "-m", "immediate", "-w", "stop"], { timeoutMs: 10_000 }).catch(() => {});
  return (await ownServerState(state)) === "stopped";
}

async function startRuntime() {
  const validated = await validateRuntimeRoot(configuredRuntimeRoot);
  const sandboxRoot = await mkdtemp(join(tmpdir(), "fanmark-pg17-snapshot-"));
  const dataDir = join(sandboxRoot, "data");
  const socketDir = join(sandboxRoot, "socket");
  await mkdir(socketDir);
  const password = randomBytes(24).toString("hex");
  const passwordFile = join(sandboxRoot, "password");
  const logFile = join(sandboxRoot, "postgres.log");
  await writeFile(passwordFile, `${password}\n`, { mode: 0o600 });
  const port = await findFreePort();
  const connectionConfig = {
    host: "127.0.0.1",
    port,
    database: "postgres",
    user: "postgres",
    password,
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    application_name: "fanmark-pg17-snapshot",
  };
  const state = { ...validated, sandboxRoot, dataDir, socketDir, passwordFile, logFile, port, connectionConfig, startupAttempted: false, rootClient: null };
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
    assert.equal(typeof Client, "function");
    state.rootClient = new Client(connectionConfig);
    await state.rootClient.connect();
    const version = await state.rootClient.query("select current_setting('server_version_num') as n, current_setting('server_version') as v");
    assert.match(version.rows[0].n, /^17\d{4}$/);
    assert.match(version.rows[0].v, /^17\./);
    await createSyntheticSchema(state.rootClient);
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

async function createSyntheticSchema(client) {
  await client.query(`
    create type public.snapshot_mood as enum ('alpha', 'β');
    create table public.snapshot_pg_rows (
      id uuid not null primary key,
      label text not null,
      payload jsonb,
      happened_at timestamptz,
      tags text[]
    );
    create table public.snapshot_pg_composite (
      first_id uuid not null,
      second_id bigint not null,
      label text,
      primary key (first_id, second_id)
    );
    insert into public.snapshot_pg_rows (id, label, payload, happened_at, tags) values
      ('a0000000-0000-4000-8000-000000000001', '東京🍣', '{"n":123.4500,"word":"🍃"}', '2024-02-29 12:34:56.123456+09', array['a', '🍃']),
      ('b0000000-0000-4000-8000-000000000002', 'second', 'null', '2024-03-01 00:00:00+00', '{}'),
      ('c0000000-0000-4000-8000-000000000003', 'third', null, null, null);
    insert into public.snapshot_pg_composite (first_id, second_id, label) values
      ('a0000000-0000-4000-8000-000000000001', 9, 'nine'),
      ('a0000000-0000-4000-8000-000000000001', 10, 'ten'),
      ('b0000000-0000-4000-8000-000000000002', 1, 'one');
  `);
}

async function readCatalog(client) {
  const results = await client.query(schemaReadinessSql);
  const resultList = Array.isArray(results) ? results : [results];
  const catalogResult = resultList.find((result) => result?.rows?.length === 1 && Object.keys(result.rows[0]).length === 1);
  assert.ok(catalogResult, "schema-readiness.sql must return one catalog row");
  const value = Object.values(catalogResult.rows[0])[0];
  assert.equal(typeof value, "object");
  return value;
}

function setLibpqEnvironment(config) {
  const names = ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.PGHOST = config.host;
  process.env.PGPORT = String(config.port);
  process.env.PGDATABASE = config.database;
  process.env.PGUSER = config.user;
  process.env.PGPASSWORD = config.password;
  delete process.env.PGSERVICE;
  delete process.env.PGSERVICEFILE;
  return () => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  };
}

function makeSessionFactory() {
  return async ({ role, timeoutMs }) => createPsqlSession({
    psqlPath,
    role,
    commandTimeoutMs: timeoutMs,
  });
}

async function makeOutputDirectory(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await rm(directory, { recursive: true, force: true });
  return directory;
}

before(async () => {
  if (runtimeEnabled) runtime = await startRuntime();
});

after(async () => {
  await stopRuntime();
});

test("PostgreSQL 17 psql transport exports a repeatable multitable UTF-8 snapshot", {
  skip: skipReason,
}, async () => {
  const restoreEnvironment = setLibpqEnvironment(runtime.connectionConfig);
  const catalog = await readCatalog(runtime.rootClient);
  baselineCatalog = structuredClone(catalog);
  const outputDir = await makeOutputDirectory("fanmark-pg17-snapshot-output-");
  const writer = new Client(runtime.connectionConfig);
  await writer.connect();
  let beginReadyResolve;
  let beginReadyReject;
  const beginReady = new Promise((resolve, reject) => {
    beginReadyResolve = resolve;
    beginReadyReject = reject;
  });
  let exportPromise;
  try {
    const sessionFactory = async (options) => {
      const session = await makeSessionFactory()(options);
      const originalBegin = session.begin.bind(session);
      session.begin = async (...args) => {
        try {
          const metadata = await originalBegin(...args);
          beginReadyResolve();
          return metadata;
        } catch (error) {
          beginReadyReject(error);
          throw error;
        }
      };
      return session;
    };
    exportPromise = exportSnapshot({
      catalog,
      outputDir,
      sessionFactory,
      role: "postgres",
      schemaReadinessSql,
      fetchSize: 2,
      timeoutMs: 20_000,
      maxRowBytes: 4 * 1024 * 1024,
    });
    let beginTimeout;
    try {
      await Promise.race([
        beginReady,
        new Promise((_, reject) => {
          beginTimeout = setTimeout(() => reject(new Error("snapshot transaction did not start")), 10_000);
        }),
      ]);
    } finally {
      clearTimeout(beginTimeout);
    }
    await writer.query("begin");
    await writer.query(`insert into public.snapshot_pg_rows (id, label) values ($1, $2)`, ["d0000000-0000-4000-8000-000000000004", "writer-after-snapshot"]);
    await writer.query("commit");
    const result = await exportPromise;
    const verified = await verifySnapshot(result.manifestPath);
    assert.equal(verified.valid, true);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    const rowsEntry = manifest.tables.find((entry) => entry.table === "snapshot_pg_rows");
    const compositeEntry = manifest.tables.find((entry) => entry.table === "snapshot_pg_composite");
    assert.equal(rowsEntry.rowCount, "3", "writer committed after BEGIN and is excluded from the repeatable snapshot");
    assert.equal(compositeEntry.rowCount, "3");
    const currentCount = await runtime.rootClient.query("select count(*)::text as count from public.snapshot_pg_rows");
    assert.equal(currentCount.rows[0].count, "4");
    const rowsText = await readFile(join(outputDir, rowsEntry.file), "utf8");
    assert.match(rowsText, /東京🍣/);
    assert.doesNotMatch(rowsText, /writer-after-snapshot/);
    const compositeText = await readFile(join(outputDir, compositeEntry.file), "utf8");
    const compositeRecords = compositeText.trimEnd().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(compositeRecords.map((record) => record.primaryKey[1]), ["10", "9", "1"]);

    const failureDir = await makeOutputDirectory("fanmark-pg17-snapshot-failure-");
    const driftedCatalog = structuredClone(catalog);
    const labelColumn = driftedCatalog.columns.find((column) => column.table_name === "snapshot_pg_rows" && column.column_name === "label");
    labelColumn.column_name = "drifted_label";
    await assert.rejects(
      exportSnapshot({
        catalog: driftedCatalog,
        outputDir: failureDir,
        sessionFactory: makeSessionFactory(),
        role: "postgres",
        schemaReadinessSql,
        fetchSize: 2,
        timeoutMs: 20_000,
      }),
      (error) => error.code === "source_catalog_fingerprint_mismatch",
    );
    const failedStatus = JSON.parse(await readFile(join(failureDir, "snapshot.status.json"), "utf8"));
    assert.equal(failedStatus.status, "failed");
    assert.equal(failedStatus.errorCode, "source_catalog_fingerprint_mismatch");
    await assert.rejects(readFile(join(failureDir, "snapshot.manifest.json")));
    assert.deepEqual(await readdir(join(failureDir, "tables")), []);
    await rm(failureDir, { recursive: true, force: true });
  } finally {
    await exportPromise?.catch(() => {});
    await writer.end().catch(() => {});
    await rm(outputDir, { recursive: true, force: true });
    restoreEnvironment();
  }
});

test("PostgreSQL scope preflight rejects partition and inheritance relations before rows", {
  skip: skipReason,
}, async () => {
  assert.ok(baselineCatalog, "the ordinary export test must establish the synthetic catalog first");
  const restoreEnvironment = setLibpqEnvironment(runtime.connectionConfig);
  try {
    await runtime.rootClient.query(`
      create table public.snapshot_pg_partitioned (
        id bigint not null,
        label text not null,
        primary key (id)
      ) partition by range (id);
      create table public.snapshot_pg_partitioned_early
        partition of public.snapshot_pg_partitioned for values from (1) to (100);
    `);
    const partitionOutput = await makeOutputDirectory("fanmark-pg17-partition-rejection-");
    await assert.rejects(
      exportSnapshot({
        catalog: baselineCatalog,
        outputDir: partitionOutput,
        sessionFactory: makeSessionFactory(),
        role: "postgres",
        schemaReadinessSql,
        fetchSize: 2,
        timeoutMs: 20_000,
      }),
      (error) => error.code === "source_partition_or_inheritance_scope_unsupported",
    );
    const partitionStatus = JSON.parse(await readFile(join(partitionOutput, "snapshot.status.json"), "utf8"));
    assert.equal(partitionStatus.errorCode, "source_partition_or_inheritance_scope_unsupported");
    await assert.rejects(readFile(join(partitionOutput, "snapshot.manifest.json")));
    assert.deepEqual(await readdir(join(partitionOutput, "tables")), []);
    await rm(partitionOutput, { recursive: true, force: true });

    await runtime.rootClient.query(`
      create schema snapshot_private_parent;
      create table snapshot_private_parent.base_row (
        id uuid not null,
        label text not null
      );
      create table public.snapshot_pg_inherited (
        primary key (id)
      ) inherits (snapshot_private_parent.base_row);
    `);
    const inheritanceOutput = await makeOutputDirectory("fanmark-pg17-inheritance-rejection-");
    await assert.rejects(
      exportSnapshot({
        catalog: baselineCatalog,
        outputDir: inheritanceOutput,
        sessionFactory: makeSessionFactory(),
        role: "postgres",
        schemaReadinessSql,
        fetchSize: 2,
        timeoutMs: 20_000,
      }),
      (error) => error.code === "source_partition_or_inheritance_scope_unsupported",
    );
    const inheritanceStatus = JSON.parse(await readFile(join(inheritanceOutput, "snapshot.status.json"), "utf8"));
    assert.equal(inheritanceStatus.errorCode, "source_partition_or_inheritance_scope_unsupported");
    await assert.rejects(readFile(join(inheritanceOutput, "snapshot.manifest.json")));
    assert.deepEqual(await readdir(join(inheritanceOutput, "tables")), []);
    await rm(inheritanceOutput, { recursive: true, force: true });
  } finally {
    restoreEnvironment();
  }
});
