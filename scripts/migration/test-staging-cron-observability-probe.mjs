#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";

import { makeConfig, parseArgs, waitForProbeFetch } from "./staging-cron-observability-probe.mjs";

const guards = [
  "--run-live-staging-write",
  "--account-id",
  "bfc2890741f0b3fb236e2d755b6c9adc",
  "--confirm-synthetic-only",
  "--confirm-delete-created-resources",
];

test("live Cron probe requires explicit staging, synthetic-only, and cleanup guards", () => {
  const originalExitCode = process.exitCode;
  process.exitCode = 0;
  assert.throws(() => parseArgs(["--deploy"]), /staging_probe_guards_required/u);
  assert.equal(process.exitCode, 1);
  process.exitCode = originalExitCode;

  const options = parseArgs(["--deploy", ...guards]);
  assert.equal(options.mode, "deploy");
  assert.equal(options.confirmedSyntheticOnly, true);
  assert.equal(options.confirmedCleanup, true);
  assert.equal(options.suppliedAccountId, "bfc2890741f0b3fb236e2d755b6c9adc");
});

test("probe Worker config has persisted full-sample logs and no application bindings", () => {
  const config = makeConfig("fanmark-cron-observability-0123abcd", "2026-09-18");

  assert.equal(config.account_id, "bfc2890741f0b3fb236e2d755b6c9adc");
  assert.equal(config.workers_dev, true);
  assert.deepEqual(config.triggers.crons, ["* * * * *"]);
  assert.deepEqual(config.observability, {
    enabled: true,
    head_sampling_rate: 1,
    logs: { enabled: true, head_sampling_rate: 1, invocation_logs: true, persist: true },
  });
  assert.equal(config.d1_databases, undefined);
  assert.equal(config.r2_buckets, undefined);
  assert.equal(config.routes, undefined);
});

test("cleanup refuses names outside the generated probe namespace", () => {
  process.exitCode = 0;
  assert.throws(() => parseArgs([
    "--cleanup",
    ...guards,
    "--worker-name",
    "fanmark-app-staging",
  ]), /worker_name_outside_probe_scope/u);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test("probe fetch readback retries temporary workers.dev propagation failures", async () => {
  let attempts = 0;
  const status = await waitForProbeFetch("https://probe.workers.dev", "cron_probe_test", {
    request: async () => {
      attempts += 1;
      return attempts === 1
        ? Response.json({ error: "route_not_ready" }, { status: 503 })
        : Response.json({ probe: "cron_probe_test" });
    },
    delay: async () => {},
    timeoutMs: 10_000,
  });

  assert.equal(status, 200);
  assert.equal(attempts, 2);
});
