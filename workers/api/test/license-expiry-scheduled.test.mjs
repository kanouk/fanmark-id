import assert from "node:assert/strict";
import { test } from "node:test";

import {
  runScheduledLicenseExpiry,
  ScheduledLicenseExpiryError,
} from "../src/license-expiry-scheduled.mjs";

const TARGET_INCARNATION = "fanmark-business-staging-incarnation-1";
const SCHEMA_DIGEST = "a".repeat(64);
const SCHEDULED_TIME = Date.parse("2026-09-24T12:34:56.123Z");

function environment(overrides = {}) {
  return {
    LICENSE_EXPIRY_BACKEND: "d1",
    LICENSE_EXPIRY_TARGET_INCARNATION: TARGET_INCARNATION,
    LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST: SCHEMA_DIGEST,
    D1_TOPOLOGY: "split",
    ...overrides,
  };
}

function fakeDatabase({ openRuns = [], openFinalizationRuns = [], setting = "14", settingRows, onQuery } = {}) {
  return {
    batch() {},
    prepare(query) {
      return {
        async all() {
          onQuery?.(query);
          if (query.includes("FROM license_expiry_runs")) return { results: openRuns };
          if (query.includes("FROM license_grace_finalization_runs")) return { results: openFinalizationRuns };
          if (query.includes("FROM system_settings")) {
            return { results: settingRows ?? [{ setting_value: setting }] };
          }
          throw new Error("unexpected query");
        },
      };
    },
  };
}

function fakeRepositoryFactory(captured, summaryOverrides = {}) {
  return (bindings) => {
    captured.push(bindings);
    return {
      async runActiveToGrace() {
        return {
          runId: bindings.runId,
          capturedNow: bindings.capturedNow,
          gracePeriodDays: bindings.gracePeriodDays,
          candidateCount: 0,
          processed: 0,
          conflicts: 0,
          status: "completed",
          pagesProcessed: 0,
          results: [],
          ...summaryOverrides,
        };
      },
    };
  };
}

function fakeFinalizationRepositoryFactory(captured, summaryOverrides = {}) {
  return (bindings) => {
    captured.push(bindings);
    return {
      async runExpiredGraceFinalization() {
        return {
          runId: bindings.runId,
          capturedNow: bindings.capturedNow,
          candidateCount: 0,
          processed: 0,
          conflicts: 0,
          status: "completed",
          pagesProcessed: 0,
          results: [],
          ...summaryOverrides,
        };
      },
    };
  };
}

test("scheduled job is disabled unless explicitly selected", async () => {
  let queried = false;
  const result = await runScheduledLicenseExpiry({
    scheduledTime: SCHEDULED_TIME,
      env: {},
      database: fakeDatabase({ onQuery: () => { queried = true; } }),
      finalizationRepositoryFactory: fakeFinalizationRepositoryFactory([]),
  });
  assert.deepEqual(result, { status: "disabled" });
  assert.equal(queried, false);
});

test("scheduled job requires split D1 and target-profile identity", async () => {
  await assert.rejects(
    runScheduledLicenseExpiry({
      scheduledTime: SCHEDULED_TIME,
      env: environment({ D1_TOPOLOGY: "legacy" }),
      database: fakeDatabase(),
      finalizationRepositoryFactory: fakeFinalizationRepositoryFactory([]),
    }),
    (error) => error instanceof ScheduledLicenseExpiryError && error.code === "split_d1_required",
  );

  await assert.rejects(
    runScheduledLicenseExpiry({
      scheduledTime: SCHEDULED_TIME,
      env: environment({ LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST: "unknown" }),
      database: fakeDatabase(),
      finalizationRepositoryFactory: fakeFinalizationRepositoryFactory([]),
    }),
    (error) => error instanceof ScheduledLicenseExpiryError && error.code === "schema_extension_digest_unavailable",
  );
});

test("new scheduled runs use canonical UTC time and stable UUID identity", async () => {
  const runs = [];
  const finalizations = [];
  for (let index = 0; index < 2; index += 1) {
    await runScheduledLicenseExpiry({
      scheduledTime: SCHEDULED_TIME,
      env: environment({ LICENSE_EXPIRY_MAX_PAGES: "7" }),
      database: fakeDatabase(),
      repositoryFactory: fakeRepositoryFactory(runs),
      finalizationRepositoryFactory: fakeFinalizationRepositoryFactory(finalizations),
    });
  }

  assert.equal(runs.length, 2);
  assert.equal(runs[0].capturedNow, "2026-09-24T12:34:56.123000Z");
  assert.equal(runs[0].runId, runs[1].runId);
  assert.match(runs[0].runId, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
  assert.equal(runs[0].gracePeriodDays, 14);
  assert.equal(runs[0].maxPages, 7);
  assert.equal(finalizations.length, 2);
  assert.equal(finalizations[0].runId, finalizations[1].runId);
  assert.notEqual(finalizations[0].runId, runs[0].runId);
  assert.equal(finalizations[0].maxPages, 7);
});

test("an open run resumes with its original captured time and grace period", async () => {
  const runs = [];
  const finalizations = [];
  const database = fakeDatabase({
    openRuns: [{
      run_id: "00000000-0000-4000-8000-000000000123",
      target_incarnation: TARGET_INCARNATION,
      schema_extension_digest: SCHEMA_DIGEST,
      captured_now: "2026-09-23T12:34:56.000000Z",
      grace_period_days: 9,
    }],
    setting: "14",
  });
  await runScheduledLicenseExpiry({
    scheduledTime: SCHEDULED_TIME,
    env: environment(),
    database,
    repositoryFactory: fakeRepositoryFactory(runs),
    finalizationRepositoryFactory: fakeFinalizationRepositoryFactory(finalizations),
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].runId, "00000000-0000-4000-8000-000000000123");
  assert.equal(runs[0].capturedNow, "2026-09-23T12:34:56.000000Z");
  assert.equal(runs[0].gracePeriodDays, 9);
  assert.equal(finalizations[0].capturedNow, "2026-09-23T12:34:56.000000Z");
});

test("ambiguous open runs fail closed and malformed settings preserve the one-day fallback", async () => {
  const openRun = {
    run_id: "00000000-0000-4000-8000-000000000123",
    target_incarnation: TARGET_INCARNATION,
    schema_extension_digest: SCHEMA_DIGEST,
    captured_now: "2026-09-23T12:34:56.000000Z",
    grace_period_days: 9,
  };
  await assert.rejects(
    runScheduledLicenseExpiry({
      scheduledTime: SCHEDULED_TIME,
      env: environment(),
      database: fakeDatabase({ openRuns: [openRun, { ...openRun, run_id: "00000000-0000-4000-8000-000000000124" }] }),
      repositoryFactory: fakeRepositoryFactory([]),
      finalizationRepositoryFactory: fakeFinalizationRepositoryFactory([]),
    }),
    (error) => error instanceof ScheduledLicenseExpiryError && error.code === "multiple_open_runs",
  );

  const runs = [];
  const finalizations = [];
  await runScheduledLicenseExpiry({
    scheduledTime: SCHEDULED_TIME,
    env: environment(),
    database: fakeDatabase({ setting: "invalid" }),
    repositoryFactory: fakeRepositoryFactory(runs),
    finalizationRepositoryFactory: fakeFinalizationRepositoryFactory(finalizations),
  });
  assert.equal(runs[0].gracePeriodDays, 1);

  const prefixParsed = [];
  await runScheduledLicenseExpiry({
    scheduledTime: SCHEDULED_TIME,
    env: environment(),
    database: fakeDatabase({ setting: "14 days" }),
    repositoryFactory: fakeRepositoryFactory(prefixParsed),
    finalizationRepositoryFactory: fakeFinalizationRepositoryFactory([]),
  });
  assert.equal(prefixParsed[0].gracePeriodDays, 14);
});

test("resumes an open grace-finalization run with its original identity and timestamp", async () => {
  const finalizations = [];
  const openRun = {
    run_id: "00000000-0000-4000-8000-000000000223",
    target_incarnation: TARGET_INCARNATION,
    schema_extension_digest: SCHEMA_DIGEST,
    captured_now: "2026-09-22T12:34:56.000000Z",
  };
  await runScheduledLicenseExpiry({
    scheduledTime: SCHEDULED_TIME,
    env: environment(),
    database: fakeDatabase({ openFinalizationRuns: [openRun] }),
    repositoryFactory: fakeRepositoryFactory([]),
    finalizationRepositoryFactory: fakeFinalizationRepositoryFactory(finalizations),
  });
  assert.equal(finalizations.length, 1);
  assert.equal(finalizations[0].runId, openRun.run_id);
  assert.equal(finalizations[0].capturedNow, openRun.captured_now);
});

test("shares the invocation page budget between active-to-grace and grace finalization", async () => {
  const activeRuns = [];
  const finalizations = [];
  await runScheduledLicenseExpiry({
    scheduledTime: SCHEDULED_TIME,
    env: environment({ LICENSE_EXPIRY_MAX_PAGES: "4" }),
    database: fakeDatabase(),
    repositoryFactory: fakeRepositoryFactory(activeRuns, { pagesProcessed: 3 }),
    finalizationRepositoryFactory: fakeFinalizationRepositoryFactory(finalizations),
  });
  assert.equal(activeRuns[0].maxPages, 4);
  assert.equal(finalizations[0].maxPages, 1);
});

test("does not start grace finalization while active-to-grace remains resumable", async () => {
  const finalizations = [];
  const result = await runScheduledLicenseExpiry({
    scheduledTime: SCHEDULED_TIME,
    env: environment(),
    database: fakeDatabase(),
    repositoryFactory: fakeRepositoryFactory([], {
      status: "running",
      pagesProcessed: 4,
    }),
    finalizationRepositoryFactory: fakeFinalizationRepositoryFactory(finalizations),
  });
  assert.equal(result.status, "running");
  assert.equal(result.graceFinalization.status, "deferred_active_to_grace_running");
  assert.equal(finalizations.length, 0);
});
