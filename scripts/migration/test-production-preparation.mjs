import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createPreparationReport, configPath, policyPath, readPreparationReport, reportPath } from "./production-preparation-audit.mjs";
import { checkStripeHandoff } from "./stripe-handoff-check.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(root + path);
function audit(change = () => {}) {
  const config = JSON.parse(read(configPath)), policy = JSON.parse(read(policyPath));
  change(config, policy);
  return createPreparationReport({ config, policy, read, list: (path) => readdirSync(root + path) });
}
test("saved inventory matches current config, migration files and critical implementation", () => {
  assert.deepEqual(readPreparationReport(), JSON.parse(read(reportPath)));
  assert.equal(audit().productionReady, false);
  assert.equal(audit().deployable, false);
});
test("new variables, sections, store bindings and changed schema selectors require review", () => {
  for (const [change, message] of [
    [(c) => { c.vars.NEW_BACKEND = "d1"; }, /unreviewed_config_variable/],
    [(c) => { c.routes = ["fanmark.id/*"]; }, /unreviewed_config_section/],
    [(c) => { c.d1_databases[0].binding = "OTHER_DB"; }, /unreviewed_d1_binding/],
    [(c) => { c.d1_databases[1].migrations_pattern = "migrations/*.sql"; }, /unreviewed_schema_selector/],
    [(c) => { c.r2_buckets.push({ binding: "OTHER_BUCKET" }); }, /unreviewed_r2_binding/],
    [(c, p) => { p.variableGroups.extra = ["AUTH_BACKEND"]; }, /duplicate_variable_policy/],
  ]) assert.throws(() => audit(change), message);
});
test("inventory contains names and hashes, never configured values or staging IDs", () => {
  const report = audit((c) => {
    for (const key of Object.keys(c.vars)) c.vars[key] = "SENSITIVE_SENTINEL";
    c.account_id = "SENSITIVE_SENTINEL";
    c.d1_databases.forEach((d) => { d.database_id = "SENSITIVE_SENTINEL"; });
    c.r2_buckets.forEach((b) => { b.bucket_name = "SENSITIVE_SENTINEL"; });
  });
  assert.ok(!JSON.stringify(report).includes("SENSITIVE_SENTINEL"));
  assert.ok(report.schemas.every((schema) => schema.productionId === null));
});
test("migration file changes alter the inventory, missing files and unsafe paths fail", () => {
  const config = JSON.parse(read(configPath)), policy = JSON.parse(read(policyPath));
  const changed = createPreparationReport({ config, policy,
    read: (p) => p.endsWith(".sql") ? Buffer.concat([read(p), Buffer.from("\n-- changed")]) : read(p),
    list: (p) => readdirSync(root + p) });
  assert.notDeepEqual(changed.schemas, audit().schemas);
  assert.throws(() => audit((c, p) => { p.schemas.AUTH_DB.files.push("missing.sql"); }), /schema_file_missing/);
  assert.throws(() => audit((c, p) => { p.implementationFiles.push("../../.env"); }), /unsafe_inventory_path/);
  assert.throws(() => createPreparationReport({ config, policy, read,
    list: (p) => p === "workers/api/migrations" ? [...readdirSync(root + p), "0002_new_unreviewed.sql"] : readdirSync(root + p) }), /unreviewed_schema_selection/);
});

const sha = (digit) => digit.repeat(64);
function projection() {
  return { format: "fanmark-stripe-handoff-v1", boundaryId: sha("a"), captureComplete: true,
    dispatcherPaused: true, inFlight: 0,
    receipts: [
      { livemode: true, eventId: "evt_old", payloadSha256: sha("b"), state: "applied", effectKeys: ["extension:cs_old"], proofSha256: sha("c") },
      { livemode: true, eventId: "evt_pending", payloadSha256: sha("d"), state: "pending", effectKeys: [], proofSha256: null },
    ], effects: [{ livemode: true, effectKey: "extension:cs_old", state: "applied", proofSha256: sha("e") }] };
}
test("handoff comparison works in both directions without promoting to production readiness", () => {
  const source = projection(), target = projection(); target.receipts.reverse();
  for (const [a, b] of [[source, target], [target, source]]) {
    const result = checkStripeHandoff(a, b);
    assert.equal(result.projectionMatches, true);
    assert.equal(result.productionReady, false);
    assert.equal(result.effects.sourceCount, 1);
  }
});
test("receipt loss, late extra receipts, payload and applied-state drift block a match", () => {
  for (const change of [
    (p) => { p.receipts.pop(); },
    (p) => { p.receipts.push({ ...p.receipts[1], eventId: "evt_late" }); },
    (p) => { p.receipts[0].payloadSha256 = sha("f"); },
    (p) => { p.receipts[0].state = "pending"; p.receipts[0].proofSha256 = null; },
    (p) => { p.effects[0].proofSha256 = sha("f"); },
  ]) { const target = projection(); change(target); assert.equal(checkStripeHandoff(projection(), target).projectionMatches, false); }
});
test("unknown effects, processing, unproved terminal states and incomplete boundary fail closed", () => {
  for (const change of [
    (p) => { p.inFlight = 1; }, (p) => { p.inFlight = null; },
    (p) => { p.dispatcherPaused = false; }, (p) => { p.captureComplete = false; },
    (p) => { p.boundaryId = sha("f"); },
    (p) => { p.receipts[0].state = "processing"; },
    (p) => { p.effects[0].state = "unknown"; },
    (p) => { p.receipts[0].proofSha256 = null; },
    (p) => { p.receipts[0].effectKeys = []; },
    (p) => { p.effects = []; },
    (p) => { p.effects[0].livemode = false; },
    (p) => { p.receipts[0].state = "ignored"; },
    (p) => { p.receipts.push(p.receipts[0]); },
    (p) => { p.effects.push(p.effects[0]); },
    (p) => { p.effects.push({ ...p.effects[0], effectKey: "extension:cs_orphan" }); },
    (p) => { p.receipts[0].rawPayload = "private"; },
  ]) { const target = projection(); change(target); assert.throws(() => checkStripeHandoff(projection(), target)); }
});
test("different event IDs may reference the same applied session; live/test remain separate", () => {
  const p = projection();
  p.receipts.push({ ...p.receipts[0], eventId: "evt_duplicate_delivery" });
  p.receipts.push({ ...p.receipts[0], livemode: false });
  p.effects.push({ ...p.effects[0], livemode: false });
  assert.equal(checkStripeHandoff(p, structuredClone(p)).projectionMatches, true);
  assert.equal(p.effects.length, 2);
});

test("CLI signals mismatch and malformed private input without printing IDs, payloads or env secrets", () => {
  const directory = mkdtempSync(join(tmpdir(), "fanmark-handoff-test-"));
  try {
    const source = join(directory, "source.json"), destination = join(directory, "destination.json");
    const run = () => spawnSync(process.execPath, [root + "scripts/migration/stripe-handoff-check.mjs",
      "--source", source, "--destination", destination], {
      cwd: directory, encoding: "utf8", env: { ...process.env, STRIPE_SECRET_KEY: "SECRET_SENTINEL" },
    });
    const p = projection();
    writeFileSync(source, JSON.stringify(p), { mode: 0o600 });
    writeFileSync(destination, JSON.stringify(p), { mode: 0o600 });
    assert.equal(run().status, 0);
    p.receipts.pop(); writeFileSync(destination, JSON.stringify(p));
    const mismatch = run();
    assert.equal(mismatch.status, 1);
    assert.equal(JSON.parse(mismatch.stdout).receipts.missing, 1);
    assert.ok(!mismatch.stdout.includes("evt_"));
    writeFileSync(destination, 'MALFORMED_PRIVATE_PAYLOAD');
    const invalid = run();
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, "");
    assert.equal(invalid.stderr.trim(), "stripe_handoff_projection_invalid_or_unresolved");
    assert.ok(!JSON.stringify(invalid).includes("SECRET_SENTINEL"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
