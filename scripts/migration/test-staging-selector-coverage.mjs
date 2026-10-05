import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isStagingNotificationWakeTarget } from "./staging-notification-wake-target.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const envTypes = readFileSync(new URL("../../src/vite-env.d.ts", import.meta.url), "utf8");
const stagingBuild = packageJson.scripts["build:cloudflare-staging"];
const sourceRoot = fileURLToPath(new URL("../../src", import.meta.url));
const workerSourceRoot = fileURLToPath(new URL("../../workers/api/src", import.meta.url));
const appStagingConfig = JSON.parse(readFileSync(new URL("../../workers/api/wrangler.app-staging.jsonc", import.meta.url), "utf8"));
const lifecycleProfileMigrations = [
  "workers/api/migrations-business/0000_business_schema_v4_staging.sql",
  "workers/api/migrations-business/0001_lifecycle_target_staging.sql",
  "workers/api/migrations-business/0002_lifecycle_generation_staging.sql",
  "workers/api/migrations-business/0003_credential_transform_staging.sql",
  "workers/api/migrations-business/0004_verified_access_staging.sql",
  "workers/api/migrations-business/0005_lottery_plan_journal_staging.sql",
  "workers/api/migrations-business/0017_lifecycle_generation_timestamp_precision.sql",
];

function lifecycleSchemaDigest() {
  return createHash("sha256").update(lifecycleProfileMigrations.map((relativePath) => {
    const bytes = readFileSync(new URL(`../../${relativePath}`, import.meta.url));
    return `${relativePath}:${createHash("sha256").update(bytes).digest("hex")}`;
  }).join("\n")).digest("hex");
}

function listTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(entryPath);
    return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
  });
}

function listWorkerSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listWorkerSourceFiles(entryPath);
    return /\.(?:mjs|ts)$/u.test(entry.name) ? [entryPath] : [];
  });
}

test("Cloudflare staging build explicitly selects every typed backend", () => {
  assert.equal(typeof stagingBuild, "string");

  const declaredSelectors = [...envTypes.matchAll(/readonly\s+(VITE_[A-Z0-9_]+_BACKEND)\??\s*:/gu)]
    .map((match) => match[1]);
  const sourceText = listTypeScriptFiles(sourceRoot)
    .filter((filePath) => path.basename(filePath) !== "vite-env.d.ts")
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("\n");
  const sourceSelectors = [...new Set([...sourceText.matchAll(/\b(VITE_[A-Z0-9_]+_BACKEND)\b/gu)].map((match) => match[1]))]
    .sort((left, right) => left.localeCompare(right));
  assert.deepEqual([...declaredSelectors].sort((left, right) => left.localeCompare(right)), sourceSelectors,
    "every backend selector consumed by frontend source must have an ImportMetaEnv declaration");

  const assignments = new Map(
    [...stagingBuild.matchAll(/\b(VITE_[A-Z0-9_]+_BACKEND)=([A-Za-z0-9_-]+)/gu)]
      .map((match) => [match[1], match[2]]),
  );
  assert.deepEqual([...assignments.keys()].sort((left, right) => left.localeCompare(right)), sourceSelectors,
    "the staging build must explicitly assign every consumed backend selector and no unknown selectors");

  const missing = declaredSelectors.filter((selector) => !assignments.has(selector));
  assert.deepEqual(missing, [], "staging must not silently use a selector's Supabase default");
  assert.ok(declaredSelectors.length > 0, "the frontend backend contract must remain discoverable");
  assert.ok([...assignments.values()].every((value) => ["worker", "supabase", "d1", "r2", "disabled"].includes(value)));

  const supabaseSelected = [...assignments.entries()].filter(([, value]) => value === "supabase").map(([name]) => name);
  assert.deepEqual(supabaseSelected, [], "Cloudflare staging must not route a typed backend back to Supabase");

  const nonWorker = [...assignments.entries()]
    .filter(([, value]) => value !== "worker")
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(nonWorker, [
    ["VITE_BROADCAST_SEND_BACKEND", "disabled"],
    ["VITE_BROADCAST_TEST_SEND_BACKEND", "disabled"],
    ["VITE_REFERENCE_MASTER_ADMIN_BACKEND", "d1"],
    ["VITE_STORAGE_BACKEND", "r2"],
  ], "only unconfigured broadcast delivery is disabled; reference masters and Storage use native adapters");
});

test("every typed frontend backend selector has an implementation reference", () => {
  const sourceFiles = listTypeScriptFiles(sourceRoot).filter((filePath) => path.basename(filePath) !== "vite-env.d.ts");
  const sourceText = sourceFiles.map((filePath) => readFileSync(filePath, "utf8")).join("\n");
  const declaredSelectors = [...envTypes.matchAll(/readonly\s+(VITE_[A-Z0-9_]+_BACKEND)\??\s*:/gu)]
    .map((match) => match[1]);
  const unused = declaredSelectors.filter((selector) => !sourceText.includes(selector));

  assert.deepEqual(unused, [], "declared selectors must be consumed by frontend source, not just named in the build");
});

test("the exact sequence-backed fanmark event bigint key stays internal to SQL", () => {
  const workerSources = listWorkerSourceFiles(workerSourceRoot).map((filePath) => ({
    filePath,
    text: readFileSync(filePath, "utf8"),
  }));
  const readPattern = /\b(?:FROM|JOIN|UPDATE|DELETE\s+FROM)\s+(?:(?:"public"|public)\s*\.\s*)?["`]?fanmark_events["`]?(?![A-Za-z0-9_])/giu;
  const insertPattern = /\bINSERT\s+INTO\s+(?:(?:"public"|public)\s*\.\s*)?["`]?fanmark_events["`]?(?![A-Za-z0-9_])/giu;
  const insertStatements = [];
  // These two exact SQL assertions inspect the integer event receipt inside
  // SQLite and project only `verified = 1`. Neither exports an event ID.
  // Any SQL change, including an added ID projection, requires a new review.
  const reviewedReceiptGuards = new Set([
    "5b82a0967a8aa519b36fcb5d1279cead439787f6258f6c7e9f41e2ce9c408973",
    "102f04631926bbc1c66f110a4f9164f26ce04fdd93ee7f007ea0d8c47caef9a4",
  ]);

  for (const { filePath, text } of workerSources) {
    for (const match of text.matchAll(readPattern)) {
      const templateStart = text.lastIndexOf("`", match.index);
      const templateEnd = text.indexOf("`", match.index);
      assert.ok(templateStart >= 0 && templateEnd > match.index, "event assertions must remain inspectable SQL templates");
      const sql = text.slice(templateStart + 1, templateEnd).replace(/\s+/gu, " ").trim();
      const digest = createHash("sha256").update(sql).digest("hex");
      assert.ok(reviewedReceiptGuards.has(digest), `${path.basename(filePath)} must not read the bigint event key into JavaScript`);
    }
    for (const match of text.matchAll(insertPattern)) {
      const templateStart = text.lastIndexOf("`", match.index);
      const templateEnd = text.indexOf("`", match.index);
      assert.ok(templateStart >= 0 && templateEnd > match.index, "event inserts must remain inspectable SQL templates");
      const sql = text.slice(match.index, templateEnd);
      assert.doesNotMatch(sql, /\bRETURNING\b/iu, "event inserts must not return the generated bigint ID");
      insertStatements.push(filePath);
    }
  }

  assert.ok(insertStatements.length > 0, "the Worker still records fanmark events through D1");
});

test("Paid staging enables bounded daily lifecycle and archive while inert rehearsals refuse it", () => {
  const vars = appStagingConfig.vars ?? {};
  assert.equal(vars.LIFECYCLE_RUN_BACKEND, "d1");
  assert.equal(vars.LICENSE_EXPIRY_TARGET_INCARNATION, "fanmark-business-staging-lifecycle-v1");
  assert.equal(vars.LICENSE_EXPIRY_SCHEMA_EXTENSION_DIGEST, lifecycleSchemaDigest());
  assert.equal(vars.LICENSE_EXPIRY_MAX_PAGES, "4");
  assert.equal(vars.LICENSE_EXPIRY_BACKEND, "d1");
  assert.equal(vars.NOTIFICATION_ARCHIVE_BACKEND, "d1");
  assert.equal(vars.NOTIFICATION_ARCHIVE_CRON, "0 0 * * *");
  assert.equal(appStagingConfig.limits.cpu_ms, 30000);
  assert.equal(vars.AUTH_SOCIAL_BACKEND, "better-auth");
  assert.equal(vars.AUTH_SOCIAL_PROVISIONING_BACKEND, "d1");
  assert.ok(!Object.keys(vars).some(key => /_OAUTH_CLIENT_(?:ID|SECRET)$/u.test(key)),
    "provider credentials belong in Worker secrets, not checked-in vars");
  for (const key of ["BROADCAST_SEND_BACKEND", "BROADCAST_TEST_SEND_BACKEND", "RESEND_API_KEY", "BROADCAST_TEST_RECIPIENT"]) {
    assert.equal(vars[key], undefined, "delivery credentials and test recipients remain outside checked-in configuration");
  }
  assert.equal(vars.AUTH_EMAIL_BACKEND, "resend");
  assert.equal(vars.RESEND_FROM_EMAIL, "fanmark.id staging <no-reply@fanmark.id>");
  assert.equal(vars.INVITATION_SIGNUP_BACKEND, "d1");
  for (const key of ["STRIPE_DISPATCH_BACKEND", "STRIPE_WEBHOOK_BACKEND", "STRIPE_PLAN_CHECKOUT_BACKEND",
    "STRIPE_PLAN_CHANGE_BACKEND", "STRIPE_CUSTOMER_PORTAL_BACKEND", "STRIPE_EXTENSION_CHECKOUT_BACKEND"]) {
    assert.equal(vars[key], "d1");
  }
  assert.equal(vars.STRIPE_MODE_POLICY, "test_only");
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_TEST", "STRIPE_SECRET_KEY_LIVE", "STRIPE_WEBHOOK_SECRET"]) {
    assert.equal(vars[key], undefined, "Stripe credentials belong in Worker secrets");
  }
  assert.equal(vars.LICENSE_EXPIRY_CRON, "0 0 * * *");
  assert.deepEqual(appStagingConfig.triggers.crons, ["0 0 * * *", "* * * * *"]);
  assert.equal(isStagingNotificationWakeTarget(appStagingConfig), false);
});
