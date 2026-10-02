import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink, stat, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { reviewSourceAuthorization } from "./source-authorization-review.mjs";

const roles = ["anon", "authenticated", "service_role"];
const marker = "private-policy-or-function-constant-do-not-export";
function catalog() {
  return {
    observed_at: "2026-10-02T21:10:00Z",
    coverage: { public_tables: true, public_policies: true, public_function_acl: true,
      api_role_effective_privileges: true, function_definitions_and_types: true, relation_options: true },
    roles: roles.map(name => ({ name, superuser: false, inherit: true, bypass_rls: name === "service_role" })),
    tables: [{ name: "notifications", owner: "postgres", kind: "r", rls_enabled: true, rls_forced: false, options: [],
      effective_privileges: roles.map(role => ({ role, select: true, insert: false, update: true, delete: false })) },
    { name: "recent_active_fanmarks", owner: "postgres", kind: "v", rls_enabled: false, rls_forced: false, options: [],
      effective_privileges: roles.map(role => ({ role, select: true, insert: false, update: false, delete: false })) }],
    policies: [{ table: "notifications", name: "Owner select", permissive: "PERMISSIVE", roles: ["public"],
      command: "SELECT", using: `auth.uid() = user_id AND '${marker}' <> ''`, check: null }],
    functions: ["ordinary_function", "trigger", "event_trigger"].map((result, i) => ({
      name: `function_${i}`, identity_arguments: "", kind: "f", result: i === 0 ? "boolean" : result,
      definition: marker, owner: "postgres", security_definer: true,
      acl: [{ grantor: "postgres", grantee: "PUBLIC", privilege: "EXECUTE", grantable: false }],
      effective_execute: roles.map(role => ({ role, execute: true })),
    })),
  };
}
test("EXECUTE grants on triggers are separated from ordinary functions, without accepting RPC exposure", () => {
  const report = reviewSourceAuthorization(catalog());
  assert.deepEqual(report.counts.effectiveExecuteIncludingTriggers, { anon: 3, authenticated: 3, service_role: 3 });
  assert.deepEqual(report.counts.effectiveExecuteNonTriggers, { anon: 1, authenticated: 1, service_role: 1 });
  assert.equal(report.counts.triggerFunctions, 2);
  assert.equal(report.authorizationReconciled, false);
  assert.equal(report.deployable, false);
  assert.equal(report.roles.find(role => role.name === "service_role").bypassRls, true);
  assert.equal(report.tables.find(table => table.kind === "v").disposition, "view_owner_and_underlying_relations_review_required");
  assert.equal(report.tables.find(table => table.kind === "v").viewSecurityInvoker, false);
  assert.equal(report.counts.rlsEnabledTables, 1);
});
test("raw function bodies and policy expressions stay private; their changes alter the fingerprint", () => {
  const input = catalog(), first = reviewSourceAuthorization(input);
  assert.ok(!JSON.stringify(first).includes(marker));
  for (const change of [source => { source.policies[0].using += " AND false"; },
    source => { source.functions[0].definition += " changed"; }]) {
    const changed = structuredClone(input); change(changed);
    assert.notEqual(reviewSourceAuthorization(changed).authorizationFingerprint, first.authorizationFingerprint);
  }
});
test("catalog ordering and observation time do not affect the authorization fingerprint", () => {
  const input = catalog(), first = reviewSourceAuthorization(input);
  input.observed_at = "2026-10-03T00:00:00Z";
  for (const key of ["roles", "tables", "policies", "functions"]) input[key].reverse();
  input.tables.forEach(row => row.effective_privileges.reverse());
  input.functions.forEach(row => { row.effective_execute.reverse(); row.acl.reverse(); });
  assert.equal(reviewSourceAuthorization(input).authorizationFingerprint, first.authorizationFingerprint);
});
test("missing scope, API roles or effective privilege entries cannot silently imply denied access", () => {
  for (const key of Object.keys(catalog().coverage)) {
    const input = catalog(); delete input.coverage[key];
    assert.throws(() => reviewSourceAuthorization(input), /source_authorization_scope_incomplete/u);
  }
  for (const change of [source => source.roles.pop(), source => source.roles.push(source.roles[0]),
    source => { source.roles[0].bypass_rls = "false"; }]) {
    const input = catalog(); change(input);
    assert.throws(() => reviewSourceAuthorization(input), /source_authorization_roles_invalid/u);
  }
  for (const change of [source => source.tables[0].effective_privileges.pop(),
    source => { source.functions[0].effective_execute[0].execute = "true"; }]) {
    const input = catalog(); change(input);
    assert.throws(() => reviewSourceAuthorization(input), /source_authorization_role_privileges_invalid/u);
  }
});
test("duplicate and dangling policies, unknown commands and non-boolean RLS fail closed", () => {
  for (const change of [source => source.policies.push(source.policies[0]),
    source => { source.policies[0].table = "missing"; }, source => { source.policies[0].table = "recent_active_fanmarks"; },
    source => { source.policies[0].command = "UNKNOWN"; }, source => { delete source.policies[0].check; }]) {
    const input = catalog(); change(input);
    assert.throws(() => reviewSourceAuthorization(input), /source_authorization_policy_invalid/u);
  }
  const input = catalog(); input.tables[0].rls_enabled = null;
  assert.throws(() => reviewSourceAuthorization(input), /source_authorization_relation_invalid/u);
});
test("overloaded functions retain separate identity and duplicate signatures or ACL grants are rejected", () => {
  const input = catalog(); input.functions.push({ ...input.functions[0], identity_arguments: "id uuid" });
  assert.equal(reviewSourceAuthorization(input).counts.nonTriggerRoutines, 2);
  input.functions.push(structuredClone(input.functions[0]));
  assert.throws(() => reviewSourceAuthorization(input), /source_authorization_function_invalid/u);
  const duplicate = catalog(); duplicate.functions[0].acl.push(duplicate.functions[0].acl[0]);
  assert.throws(() => reviewSourceAuthorization(duplicate), /source_authorization_function_acl_invalid/u);
});
test("an empty function ACL remains distinct from default PUBLIC privileges and a procedure is not a trigger", () => {
  const input = catalog(); input.functions[0].acl = null;
  input.functions[0].effective_execute.forEach(grant => { grant.execute = false; });
  input.functions.push({ ...structuredClone(input.functions[0]), name: "maintenance_procedure", kind: "p", result: null });
  const report = reviewSourceAuthorization(input);
  assert.equal(report.counts.effectiveExecuteNonTriggers.anon, 0);
  assert.equal(report.functions.find(fn => fn.name === "maintenance_procedure").invocationKind, "procedure");
});
test("view security-invoker changes are recorded without claiming view authorization acceptance", () => {
  const input = catalog(), before = reviewSourceAuthorization(input);
  input.tables[1].options = ["security_invoker=true"];
  const after = reviewSourceAuthorization(input);
  assert.notEqual(after.authorizationFingerprint, before.authorizationFingerprint);
  assert.equal(after.tables.find(table => table.kind === "v").viewSecurityInvoker, true);
  assert.equal(after.authorizationReconciled, false);
});
test("CLI outputs private metadata and refuses aliased input overwrite", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fanmark-authorization-test-"));
  try {
    const input = path.join(dir, "source.json"), output = path.join(dir, "report.json");
    const bytes = JSON.stringify({ rows: [{ jsonb_build_object: JSON.stringify(catalog()) }] });
    await writeFile(input, bytes, { mode: 0o600 });
    const script = fileURLToPath(new URL("./source-authorization-review.mjs", import.meta.url));
    const run = destination => spawnSync(process.execPath, [script, "--catalog", input, "--output", destination], { encoding: "utf8" });
    assert.equal(run(output).status, 0);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.ok(!(await readFile(output, "utf8")).includes(marker));
    await symlink(dir, path.join(dir, "alias"));
    const refused = run(path.join(dir, "alias/source.json"));
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /source_authorization_paths_or_size_invalid/u);
    assert.equal(await readFile(input, "utf8"), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
