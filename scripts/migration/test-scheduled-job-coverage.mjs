import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { selectScheduledJobs } from "../../workers/api/src/scheduled-dispatch.ts";
import { validateScheduledJobCoverage, validateStagingBackupJobCoverage } from "./scheduled-job-coverage.mjs";

const deployed = JSON.parse(readFileSync(new URL("../../workers/api/wrangler.app-staging.jsonc", import.meta.url), "utf8"));
const backup = JSON.parse(readFileSync(new URL("../../workers/api/wrangler.backup-staging.jsonc", import.meta.url), "utf8"));
const monitor = JSON.parse(readFileSync(new URL("../../workers/api/wrangler.backup-monitor-staging.jsonc", import.meta.url), "utf8"));
const baseline = structuredClone(deployed);
delete baseline.vars.LICENSE_EXPIRY_BACKEND;
delete baseline.vars.NOTIFICATION_ARCHIVE_BACKEND;
delete baseline.vars.STRIPE_DISPATCH_BACKEND;
delete baseline.vars.BROADCAST_SEND_BACKEND;
function config(vars, crons = ["0 0 * * *"]) {
  return { ...baseline, vars: { ...baseline.vars, ...vars }, triggers: { crons } };
}

test("operational staging routes daily jobs and test Stripe dispatch without notification polling", () => {
  assert.deepEqual(validateScheduledJobCoverage(deployed), [
    { job: "license-expiry", cron: "0 0 * * *" },
    { job: "notification-archive", cron: "0 0 * * *" },
    { job: "stripe-webhook-dispatch", cron: "* * * * *" },
  ]);
  assert.deepEqual(selectScheduledJobs("0 0 * * *", deployed.vars), ["license-expiry", "notification-archive"]);
  assert.deepEqual(selectScheduledJobs("* * * * *", deployed.vars), ["stripe-webhook-dispatch"]);
  assert.equal(deployed.vars.STRIPE_MODE_POLICY, "test_only");
  assert.deepEqual(validateScheduledJobCoverage(baseline), []);
});

test("backup/monitor activation requires matching scope, transport admission and exact independent Crons", () => {
  validateStagingBackupJobCoverage(deployed, backup, monitor);
  const main = structuredClone(deployed), daily = structuredClone(backup), hourly = structuredClone(monitor);
  main.vars.STAGING_BACKUP_ALERT_BACKEND = "resend-v1";
  daily.vars.STAGING_BACKUP_SCHEDULE = "daily-v1"; daily.triggers.crons = ["5 0 * * *"];
  hourly.vars.STAGING_BACKUP_MONITOR = "hourly-v1"; hourly.triggers.crons = ["35 * * * *"];
  assert.deepEqual(validateStagingBackupJobCoverage(main, daily, hourly), [
    { job: "fanmark-backup-staging", cron: "5 0 * * *" },
    { job: "fanmark-backup-monitor-staging", cron: "35 * * * *" },
  ]);
  for (const change of [
    c => { c.daily.triggers.crons = []; },
    c => { c.main.vars.STAGING_BACKUP_ALERT_BACKEND = "disabled"; },
    c => { c.main.vars.STAGING_BACKUP_ADMISSION = "pending"; },
    c => { c.hourly.vars.RECOVERY_DRAIN_SCOPE_DIGEST = "a".repeat(64); },
    c => { c.hourly.vars.STAGING_BACKUP_SOURCE_IDS = "{}"; },
    c => { c.hourly.d1_databases = [{ binding: "AUTH_DB", database_id: "unowned" }]; },
    c => { c.hourly.services[0].service = "other-project"; },
  ]) {
    const c = structuredClone({ main, daily, hourly }); change(c);
    assert.throws(() => validateStagingBackupJobCoverage(c.main, c.daily, c.hourly), /staging_backup_/u);
  }
});

for (const [selector, job] of [
  ["STRIPE_DISPATCH_BACKEND", "stripe-webhook-dispatch"],
  ["BROADCAST_SEND_BACKEND", "broadcast-email-delivery"],
]) {
  test(`${job} activation fails with the daily-only alarm baseline`, () => {
    assert.throws(() => validateScheduledJobCoverage(config({ [selector]: "d1" })),
      { message: `scheduled_job_uncovered:${job}` });
  });
}

test("Stripe and broadcast share a minute trigger without restarting notification polling", () => {
  const candidate = config({ STRIPE_DISPATCH_BACKEND: "d1", BROADCAST_SEND_BACKEND: "d1" },
    ["0 0 * * *", "* * * * *"]);
  assert.deepEqual(validateScheduledJobCoverage(candidate), [
    { job: "stripe-webhook-dispatch", cron: "* * * * *" },
    { job: "broadcast-email-delivery", cron: "* * * * *" },
  ]);
  const selected = selectScheduledJobs("* * * * *", candidate.vars);
  assert.ok(selected.includes("stripe-webhook-dispatch"));
  assert.ok(selected.includes("broadcast-email-delivery"));
  assert.ok(!selected.includes("notification-events"));
});

test("receipt-only Stripe rehearsal and broadcast draft editing do not require a dispatcher", () => {
  assert.deepEqual(validateScheduledJobCoverage(config({ STRIPE_WEBHOOK_BACKEND: "d1" })), []);
});

test("enabling bulk send without its D1 draft backend is refused even with a minute trigger", () => {
  assert.throws(() => validateScheduledJobCoverage(config({
    BROADCAST_SEND_BACKEND: "d1", BROADCAST_EMAIL_BACKEND: undefined,
  }, ["* * * * *"])), { message: "broadcast_delivery_backend_missing" });
});

test("Cron notification fallback needs a minute trigger when no durable alarm is selected", () => {
  const vars = { NOTIFICATION_WAKE_BACKEND: undefined };
  assert.throws(() => validateScheduledJobCoverage(config(vars)),
    { message: "scheduled_job_uncovered:notification-events" });
  assert.deepEqual(validateScheduledJobCoverage(config(vars, ["* * * * *"])),
    [{ job: "notification-events", cron: "* * * * *" }]);
});

test("daily expiry and archival share the default daily trigger only when enabled", () => {
  const vars = { LICENSE_EXPIRY_BACKEND: "d1", NOTIFICATION_ARCHIVE_BACKEND: "d1" };
  assert.deepEqual(validateScheduledJobCoverage(config(vars)), [
    { job: "license-expiry", cron: "0 0 * * *" },
    { job: "notification-archive", cron: "0 0 * * *" },
  ]);
  assert.throws(() => validateScheduledJobCoverage(config(vars, [])),
    { message: "scheduled_job_uncovered:license-expiry" });
});

test("custom expiry/archive schedules must both be registered and route to their jobs", () => {
  const vars = {
    LICENSE_EXPIRY_BACKEND: "d1", LICENSE_EXPIRY_CRON: " 15 0 * * * ",
    NOTIFICATION_ARCHIVE_BACKEND: "d1", NOTIFICATION_ARCHIVE_CRON: "30 0 * * *",
  };
  assert.throws(() => validateScheduledJobCoverage(config(vars)),
    { message: "scheduled_job_uncovered:license-expiry" });
  assert.throws(() => validateScheduledJobCoverage(config(vars, ["15 0 * * *"])),
    { message: "scheduled_job_uncovered:notification-archive" });
  assert.deepEqual(validateScheduledJobCoverage(config(vars, ["15 0 * * *", "30 0 * * *"])), [
    { job: "license-expiry", cron: "15 0 * * *" },
    { job: "notification-archive", cron: "30 0 * * *" },
  ]);
});

test("malformed or duplicate trigger entries fail before job selection", () => {
  for (const crons of ["* * * * *", [null], [""], ["0 0 * * *", "0 0 * * *"]]) {
    assert.throws(() => validateScheduledJobCoverage(config({}, crons)),
      { message: "scheduled_crons_invalid" });
  }
});

test("the CLI exits unsuccessfully for an uncovered dispatcher before any remote operation", () => {
  const directory = mkdtempSync(join(tmpdir(), "fanmark-schedule-coverage-"));
  try {
    const fixture = join(directory, "config.json");
    writeFileSync(fixture, JSON.stringify(config({ STRIPE_DISPATCH_BACKEND: "d1" })), { mode: 0o600 });
    const result = spawnSync(process.execPath, ["--experimental-strip-types",
      fileURLToPath(new URL("./scheduled-job-coverage.mjs", import.meta.url)), fixture], { encoding: "utf8" });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /scheduled_job_uncovered:stripe-webhook-dispatch/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
