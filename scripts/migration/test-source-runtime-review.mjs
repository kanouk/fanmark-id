import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, symlink, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { reviewSourceRuntime } from "./source-runtime-review.mjs";

const display = JSON.parse(await readFile(new URL("./fixtures/source-runtime-inactive-display-name.json", import.meta.url), "utf8"));
const privateMarker = "private-function-body-must-not-appear-in-report";
const authBinding = { table_schema: "auth", table_name: "users", name: "on_auth_user_created",
  function_schema: "public", function_name: "handle_new_user", function_identity_arguments: "", enabled: "O",
  definition: `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user(); -- ${privateMarker}` };
function catalog() { return {
  observed_at: "2026-10-02T19:45:33.736244+00:00",
  coverage: { public_functions: true, public_table_triggers: true, all_schema_public_function_triggers: true, public_function_event_triggers: true },
  functions: [structuredClone(display), { name: "handle_new_user", identity_arguments: "", result: "trigger", definition: privateMarker,
    language: "plpgsql", security_definer: true, volatility: "v" }],
  trigger_bindings: [structuredClone(authBinding)], event_trigger_bindings: [],
}; }
const displayReview = source => reviewSourceRuntime(source).functions.find(fn => fn.name === "validate_display_name");

test("exact unbound source trigger definition is classified without installing it or accepting the runtime", () => {
  const result = reviewSourceRuntime(catalog());
  assert.equal(displayReview(catalog()).disposition, "reviewed_unbound_trigger_definition");
  assert.equal(result.counts.reviewedUnboundTriggerDefinitions, 1);
  assert.equal(result.counts.externalTriggerBindings, 1);
  assert.equal(result.fullRuntimeReconciled, false);
  assert.equal(result.deployable, false);
  assert.equal(result.functions.find(fn => fn.name === "handle_new_user").disposition, "runtime_review_required");
  assert.ok(!JSON.stringify(result).includes(privateMarker));
  assert.ok(!JSON.stringify(result).includes("CREATE OR REPLACE FUNCTION"));
});
test("public-table-only coverage cannot claim absence of Auth or other external triggers", () => {
  for (const key of ["all_schema_public_function_triggers", "public_function_event_triggers"]) {
    const input = catalog(); delete input.coverage[key];
    assert.throws(() => reviewSourceRuntime(input), /source_runtime_scope_incomplete/u);
  }
  const input = catalog(); input.trigger_bindings = [];
  assert.throws(() => reviewSourceRuntime(input), /source_runtime_auth_binding_missing/u);
});
test("new bindings in external schemas, including disabled bindings, invalidate inactive classification", () => {
  for (const enabled of ["O", "A", "R", "D"]) {
    const input = catalog(); input.trigger_bindings.push({ ...authBinding, table_schema: "storage", table_name: "objects",
      name: "new_display_validation", function_name: "validate_display_name", enabled });
    assert.equal(displayReview(input).disposition, "runtime_review_required");
    assert.equal(displayReview(input).bindingCount, 1);
  }
});
test("an event trigger binding also prevents inactive classification", () => {
  const input = catalog(); input.event_trigger_bindings.push({ name: "new_event_binding", event: "ddl_command_end",
    function_schema: "public", function_name: "validate_display_name", function_identity_arguments: "", enabled: "O" });
  assert.equal(displayReview(input).disposition, "runtime_review_required");
});
test("changed body, return type, or overloaded arguments never inherit the old reviewed disposition", () => {
  for (const changes of [{ definition: display.definition + "\n-- changed" }, { result: "text" }, { identity_arguments: "name text" },
    { security_definer: true }, { volatility: "s" }]) {
    const input = catalog(); Object.assign(input.functions[0], changes);
    assert.equal(displayReview(input).disposition, "runtime_review_required");
  }
});
test("unknown unbound trigger functions remain pending", () => {
  const input = catalog(); input.functions.push({ name: "new_trigger", identity_arguments: "", result: "trigger", definition: privateMarker,
    language: "plpgsql", security_definer: false, volatility: "v" });
  assert.equal(reviewSourceRuntime(input).functions.find(fn => fn.name === "new_trigger").disposition, "runtime_review_required");
});
test("duplicate identities and malformed or dangling bindings fail closed", () => {
  const duplicate = catalog(); duplicate.functions.push(structuredClone(duplicate.functions[0]));
  assert.throws(() => reviewSourceRuntime(duplicate), /source_runtime_function_invalid/u);
  const missing = catalog(); missing.functions.pop();
  assert.throws(() => reviewSourceRuntime(missing), /source_runtime_binding_function_missing/u);
  const malformed = catalog(); malformed.trigger_bindings[0].enabled = "unknown";
  assert.throws(() => reviewSourceRuntime(malformed), /source_runtime_binding_invalid/u);
  const duplicateBinding = catalog(); duplicateBinding.trigger_bindings.push(structuredClone(authBinding));
  assert.throws(() => reviewSourceRuntime(duplicateBinding), /source_runtime_trigger_invalid/u);
});
test("runtime fingerprint is stable across observation time and catalog ordering but changes with binding state", () => {
  const first = reviewSourceRuntime(catalog());
  const input = catalog(); input.observed_at = "2026-10-03T00:00:00Z"; input.functions.reverse();
  assert.equal(reviewSourceRuntime(input).runtimeFingerprint, first.runtimeFingerprint);
  input.trigger_bindings[0].enabled = "D";
  assert.notEqual(reviewSourceRuntime(input).runtimeFingerprint, first.runtimeFingerprint);
});
test("CLI writes a private value-free report and rejects input/output aliases without truncating evidence", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fanmark-source-review-test-"));
  try {
    const input = path.join(dir, "source.json"), output = path.join(dir, "review.json");
    const bytes = JSON.stringify({ rows: [{ jsonb_build_object: catalog() }] });
    await writeFile(input, bytes, { mode: 0o600 });
    const script = fileURLToPath(new URL("./source-runtime-review.mjs", import.meta.url));
    const run = destination => spawnSync(process.execPath, [script, "--catalog", input, "--output", destination], { encoding: "utf8" });
    assert.equal(run(output).status, 0);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.ok(!(await readFile(output, "utf8")).includes(privateMarker));
    const alias = path.join(dir, "alias"); await symlink(dir, alias);
    const refused = run(path.join(alias, "source.json"));
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /source_runtime_paths_or_size_invalid/u);
    assert.equal(await readFile(input, "utf8"), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
