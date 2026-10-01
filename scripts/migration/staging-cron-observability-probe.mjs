#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workerRoot = path.join(repoRoot, "workers/api");
const wranglerCli = path.join(workerRoot, "node_modules/wrangler/bin/wrangler.js");
const appConfigPath = path.join(workerRoot, "wrangler.app-staging.jsonc");
const probeRoot = path.join(os.tmpdir(), "fanmark-staging-cron-probes");
const accountId = "bfc2890741f0b3fb236e2d755b6c9adc";
const profile = "fanmark-staging-inapp";
const workerPrefix = "fanmark-cron-observability-";

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
  throw new Error(code);
}

export function parseArgs(argv) {
  const result = {
    mode: null,
    workerName: null,
    confirmedWrite: false,
    confirmedSyntheticOnly: false,
    confirmedCleanup: false,
    suppliedAccountId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--deploy") result.mode = "deploy";
    else if (argument === "--cleanup") result.mode = "cleanup";
    else if (argument === "--run-live-staging-write") result.confirmedWrite = true;
    else if (argument === "--confirm-synthetic-only") result.confirmedSyntheticOnly = true;
    else if (argument === "--confirm-delete-created-resources") result.confirmedCleanup = true;
    else if (argument === "--account-id") result.suppliedAccountId = argv[++index] ?? null;
    else if (argument === "--worker-name") result.workerName = argv[++index] ?? null;
    else fail("usage_invalid");
  }
  if (!result.mode || !result.confirmedWrite || !result.confirmedSyntheticOnly ||
      !result.confirmedCleanup || result.suppliedAccountId !== accountId) {
    fail("staging_probe_guards_required");
  }
  if ((result.mode === "cleanup") !== Boolean(result.workerName)) fail("worker_name_required_for_cleanup_only");
  if (result.mode === "cleanup" && !/^fanmark-cron-observability-[a-f0-9]{8}$/u.test(result.workerName)) {
    fail("worker_name_outside_probe_scope");
  }
  return result;
}

function runWrangler(args, { cwd, configPath = appConfigPath, timeout = 180_000 } = {}) {
  const result = spawnSync(process.execPath, [
    wranglerCli,
    ...args,
    "--config",
    configPath,
    "--profile",
    profile,
  ], {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write((result.stdout ?? "").slice(-4_000));
    process.stderr.write((result.stderr ?? "").slice(-4_000));
    fail("wrangler_probe_operation_failed");
  }
  return result.stdout ?? "";
}

export function makeConfig(workerName, compatibilityDate) {
  return {
    name: workerName,
    main: "index.mjs",
    compatibility_date: compatibilityDate,
    account_id: accountId,
    workers_dev: true,
    triggers: { crons: ["* * * * *"] },
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      logs: {
        enabled: true,
        head_sampling_rate: 1,
        invocation_logs: true,
        persist: true,
      },
    },
  };
}

export async function waitForProbeFetch(url, marker, {
  request = fetch,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMs = 60_000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const response = await request(url, { signal: AbortSignal.timeout(5_000) });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.probe === marker) return response.status;
    } catch {
      // A fresh workers.dev route may take a short time to become reachable.
    }
    if (Date.now() + 1_000 > deadline) break;
    await delay(1_000);
  }
  fail("probe_fetch_readback_failed");
}

async function deployProbe() {
  const appConfig = JSON.parse(await readFile(appConfigPath, "utf8"));
  const authHost = new URL(appConfig.vars?.BETTER_AUTH_URL).hostname;
  const workersDevSuffix = authHost.split(".").slice(1).join(".");
  if (!workersDevSuffix.endsWith("workers.dev")) fail("staging_workers_dev_suffix_invalid");

  const suffix = randomBytes(4).toString("hex");
  const workerName = `${workerPrefix}${suffix}`;
  const workerDir = path.join(probeRoot, workerName);
  const configPath = path.join(workerDir, "wrangler.jsonc");
  const marker = `cron_probe_${suffix}`;
  await mkdir(workerDir, { recursive: true, mode: 0o700 });
  const source = `export default {
  async fetch() {
    return Response.json({ probe: ${JSON.stringify(marker)} });
  },
  async scheduled(controller) {
    console.log({
      probe: ${JSON.stringify(marker)},
      kind: "scheduled",
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    });
  },
};
`;
  await writeFile(path.join(workerDir, "index.mjs"), source, { mode: 0o600, flag: "wx" });
  await writeFile(configPath, `${JSON.stringify(makeConfig(workerName, appConfig.compatibility_date), null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });

  const state = { workerName, workerDir, configPath, accountId, marker };
  const statePath = path.join(probeRoot, `${workerName}.json`);
  await writeFile(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });

  try {
    runWrangler(["deploy"], { cwd: workerDir, configPath });
    const url = `https://${workerName}.${workersDevSuffix}`;
    const fetchReadback = await waitForProbeFetch(url, marker);
    process.stdout.write(`${JSON.stringify({
      status: "deployed",
      workerName,
      url,
      cron: "* * * * *",
      observability: "enabled_with_persisted_invocation_and_custom_logs",
      fetchReadback,
      marker,
      statePath,
      cleanupCommand: `node scripts/migration/staging-cron-observability-probe.mjs --cleanup --worker-name ${workerName} --run-live-staging-write --account-id ${accountId} --confirm-synthetic-only --confirm-delete-created-resources`,
      next: "Query Workers Logs for this worker and marker after the Cron propagation window, then run cleanupCommand.",
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`The disposable Worker may have been created; inspect it before retrying. Worker: ${workerName}. State: ${statePath}.\n`);
    throw error;
  }
}

async function cleanupProbe(workerName) {
  const statePath = path.join(probeRoot, `${workerName}.json`);
  const state = JSON.parse(await readFile(statePath, "utf8"));
  if (state.workerName !== workerName || state.accountId !== accountId ||
      !state.workerDir.startsWith(`${probeRoot}${path.sep}`)) {
    fail("probe_state_scope_invalid");
  }
  runWrangler(["delete", workerName, "--force"]);
  await rm(state.workerDir, { recursive: true, force: true });
  await rm(statePath, { force: true });
  process.stdout.write(`${JSON.stringify({ status: "deleted", workerName, accountId }, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(probeRoot, { recursive: true, mode: 0o700 });
  if (options.mode === "deploy") await deployProbe();
  else await cleanupProbe(options.workerName);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
