import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, symlink, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { reviewSourceRuntime, linkSourceRuntimeCounterparts } from "./source-runtime-review.mjs";

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


function traceFor(report) {
  return { schemaVersion: 1, runtimeFingerprint: report.runtimeFingerprint,
    functionsCount: report.functions.length, fullRuntimeReconciled: false, converterDeployable: false,
    functions: report.functions.map(fn => ({ ...fn, counterpartSemanticApprovalInferred: false,
      counterpart: { location: "docs/migration/object-map.md", actor: "named application path",
        boundaryAndEvidence: "documented correspondence " + privateMarker, remainingBoundary: "provider and operations remain" } })) };
}

test("manual correspondence is linked without accepting pending semantics or exposing its prose", () => {
  const report = reviewSourceRuntime(catalog()), linked = linkSourceRuntimeCounterparts(report, traceFor(report));
  assert.equal(linked.counterpartTrace.functionCount, 2);
  assert.equal(linked.counterpartTrace.missingFunctionCount, 0);
  assert.deepEqual(linked.counts, report.counts);
  assert.equal(linked.functions[0].disposition, report.functions[0].disposition);
  assert.ok(linked.functions.every(fn => fn.counterpart.identityAndDefinitionMatched && !fn.counterpart.semanticApprovalInferred));
  assert.equal(linked.fullRuntimeReconciled, false); assert.equal(linked.deployable, false);
  assert.ok(!JSON.stringify(linked).includes(privateMarker));
  const reordered = traceFor(report); reordered.functions.reverse();
  assert.deepEqual(linkSourceRuntimeCounterparts(report, reordered), linked);
});

test("changed definitions, overloads, attributes or bindings cannot inherit a manual counterpart", () => {
  const report = reviewSourceRuntime(catalog());
  for (const [name, value] of [["definitionSha256", "0".repeat(64)], ["identityArguments", "candidate text"],
    ["result", "text"], ["language", "sql"], ["securityDefiner", false], ["volatility", "i"], ["bindingCount", 99]]) {
    const trace = traceFor(report); trace.functions[0][name] = value;
    assert.throws(() => linkSourceRuntimeCounterparts(report, trace), /source_runtime_counterpart_definition_mismatch/u, name);
  }
  const changed = catalog(); changed.trigger_bindings[0].enabled = "D";
  assert.throws(() => linkSourceRuntimeCounterparts(reviewSourceRuntime(changed), traceFor(report)), /source_runtime_counterpart_scope_mismatch/u);
});

test("incomplete, duplicate, unbounded or approval-bearing counterpart traces fail closed", () => {
  const report = reviewSourceRuntime(catalog());
  for (const mutate of [t => t.functions.pop(), t => t.functions.push(t.functions[0]),
    t => t.fullRuntimeReconciled = true, t => t.converterDeployable = true, t => t.functionsCount = 99]) {
    const trace = traceFor(report); mutate(trace);
    assert.throws(() => linkSourceRuntimeCounterparts(report, trace), /source_runtime_counterpart_scope_mismatch/u);
  }
  const duplicate = traceFor(report); duplicate.functions[1] = duplicate.functions[0];
  assert.throws(() => linkSourceRuntimeCounterparts(report, duplicate), /source_runtime_counterpart_duplicate/u);
  for (const mutate of [t => t.functions[0].counterpart.remainingBoundary = "",
    t => t.functions[0].counterpart.location = "a".repeat(16001), t => t.functions[0].counterpartSemanticApprovalInferred = true]) {
    const trace = traceFor(report); mutate(trace);
    assert.throws(() => linkSourceRuntimeCounterparts(report, trace), /source_runtime_counterpart_invalid/u);
  }
});

test("CLI consumes the optional trace and refuses its output alias without overwriting it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fanmark-source-link-test-"));
  try {
    const input = path.join(dir, "source.json"), tracePath = path.join(dir, "trace.json"), output = path.join(dir, "review.json");
    const traceBytes = JSON.stringify(traceFor(reviewSourceRuntime(catalog())));
    await writeFile(input, JSON.stringify(catalog()), { mode: 0o600 });
    await writeFile(tracePath, traceBytes, { mode: 0o600 });
    const script = fileURLToPath(new URL("./source-runtime-review.mjs", import.meta.url));
    const run = destination => spawnSync(process.execPath, [script, "--catalog", input, "--output", destination,
      "--counterparts", tracePath], { encoding: "utf8" });
    assert.equal(run(output).status, 0);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    const linked = JSON.parse(await readFile(output, "utf8")); assert.equal(linked.counterpartTrace.functionCount, 2);
    assert.ok(!JSON.stringify(linked).includes(privateMarker));
    const refused = run(tracePath); assert.equal(refused.status, 1);
    assert.match(refused.stderr, /source_runtime_paths_or_size_invalid/u);
    assert.equal(await readFile(tracePath, "utf8"), traceBytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
