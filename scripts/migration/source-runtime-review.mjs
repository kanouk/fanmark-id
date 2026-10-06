import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, unlink, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COVERAGE = ["public_functions", "public_table_triggers", "all_schema_public_function_triggers", "public_function_event_triggers"];
const REVIEWED_UNBOUND = new Map([
  ["log_profile_cache_access", "c6f638475a8ec48dd0751e69bbab35566abc99e0afdb466aabfe474df3cbcd51"],
  ["log_waitlist_access", "9db34d104d15c6adee8d02b5db3f83435d1c6183e1b7182b595fcda791be5672"],
  ["sync_public_profile_cache", "04ae72969504489c3c2f3b71d82fb597e11bfc820e1fbc272fc0c4bbf679b18c"],
  ["validate_display_name", "e2a4293a7111d2e8ebc90b5db51acd8b555096efee742707c6f820e9645a22a5"],
]);
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");
const identity = value => JSON.stringify([value.name, value.identity_arguments]);
const text = value => typeof value === "string" && value.length > 0;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function fail(code) { throw new Error(code); }

export function reviewSourceRuntime(catalog) {
  if (!catalog || COVERAGE.some(key => catalog.coverage?.[key] !== true)) fail("source_runtime_scope_incomplete");
  if (!text(catalog.observed_at) || !Number.isFinite(Date.parse(catalog.observed_at)) ||
      !Array.isArray(catalog.functions) || !catalog.functions.length ||
      !Array.isArray(catalog.trigger_bindings) || !Array.isArray(catalog.event_trigger_bindings)) {
    fail("source_runtime_catalog_invalid");
  }
  const identities = new Set();
  for (const fn of catalog.functions) {
    if (!text(fn.name) || typeof fn.identity_arguments !== "string" || !text(fn.result) || !text(fn.definition) ||
        !text(fn.language) || typeof fn.security_definer !== "boolean" || !["i", "s", "v"].includes(fn.volatility) ||
        identities.has(identity(fn))) fail("source_runtime_function_invalid");
    identities.add(identity(fn));
  }
  const bindings = [...catalog.trigger_bindings, ...catalog.event_trigger_bindings];
  for (const binding of bindings) {
    if (!text(binding.name) || !text(binding.function_schema) || !text(binding.function_name) ||
        typeof binding.function_identity_arguments !== "string" || !["O", "A", "R", "D"].includes(binding.enabled)) {
      fail("source_runtime_binding_invalid");
    }
    if (binding.function_schema === "public" && !identities.has(JSON.stringify([
      binding.function_name, binding.function_identity_arguments,
    ]))) fail("source_runtime_binding_function_missing");
  }
  const triggerIdentities = new Set();
  for (const binding of catalog.trigger_bindings) {
    const key = JSON.stringify([binding.table_schema, binding.table_name, binding.name]);
    if (!text(binding.table_schema) || !text(binding.table_name) || !text(binding.definition) || triggerIdentities.has(key)) {
      fail("source_runtime_trigger_invalid");
    }
    triggerIdentities.add(key);
  }
  const eventIdentities = new Set();
  for (const binding of catalog.event_trigger_bindings) {
    if (!text(binding.event) || eventIdentities.has(binding.name)) fail("source_runtime_event_trigger_invalid");
    eventIdentities.add(binding.name);
  }
  // This known external binding prevents a public-table-only snapshot from
  // incorrectly treating the Auth provisioning function as an unused trigger.
  if (!catalog.trigger_bindings.some(binding => binding.table_schema === "auth" && binding.table_name === "users" &&
      binding.name === "on_auth_user_created" && binding.function_schema === "public" &&
      binding.function_name === "handle_new_user" && binding.function_identity_arguments === "")) {
    fail("source_runtime_auth_binding_missing");
  }

  const functions = catalog.functions.map(fn => {
    const definitionSha256 = hash(fn.definition);
    const bound = bindings.filter(binding => binding.function_schema === "public" &&
      binding.function_name === fn.name && binding.function_identity_arguments === fn.identity_arguments);
    const reviewed = fn.identity_arguments === "" && REVIEWED_UNBOUND.has(fn.name);
    const inactive = reviewed && fn.result === "trigger" && fn.language === "plpgsql" && fn.volatility === "v" &&
      fn.security_definer === (fn.name !== "validate_display_name") && bound.length === 0 &&
      definitionSha256 === REVIEWED_UNBOUND.get(fn.name);
    return {
      name: fn.name, identityArguments: fn.identity_arguments, result: fn.result, definitionSha256,
      language: fn.language, securityDefiner: fn.security_definer, volatility: fn.volatility,
      disposition: inactive ? "reviewed_unbound_trigger_definition" : "runtime_review_required",
      bindingCount: bound.length,
      reason: inactive ? "Exact reviewed trigger definition has no registered binding in any captured schema. Do not install a new trigger."
        : reviewed ? "Definition/type/arguments or registered bindings differ from the reviewed inactive baseline."
          : "No automatic counterpart acceptance; reconcile function behavior and authorization.",
    };
  }).sort((a, b) => compare(identity({ name: a.name, identity_arguments: a.identityArguments }),
    identity({ name: b.name, identity_arguments: b.identityArguments })));
  const triggerBindings = catalog.trigger_bindings.map(binding => ({
    tableSchema: binding.table_schema, tableName: binding.table_name, name: binding.name,
    functionSchema: binding.function_schema, functionName: binding.function_name,
    identityArguments: binding.function_identity_arguments, enabled: binding.enabled,
    definitionSha256: hash(binding.definition), disposition: "runtime_review_required",
  })).sort((a, b) => compare(JSON.stringify([a.tableSchema, a.tableName, a.name]), JSON.stringify([b.tableSchema, b.tableName, b.name])));
  const eventTriggerBindings = catalog.event_trigger_bindings.map(binding => ({
    name: binding.name, event: binding.event, enabled: binding.enabled,
    functionSchema: binding.function_schema, functionName: binding.function_name,
    identityArguments: binding.function_identity_arguments, disposition: "runtime_review_required",
  })).sort((a, b) => compare(a.name, b.name));
  const sourceDefinitions = {
    functions: functions.map(({ name, identityArguments, result, definitionSha256, language, securityDefiner, volatility }) =>
      ({ name, identityArguments, result, definitionSha256, language, securityDefiner, volatility })),
    triggerBindings: triggerBindings.map(({ disposition: _disposition, ...binding }) => binding),
    eventTriggerBindings: eventTriggerBindings.map(({ disposition: _disposition, ...binding }) => binding),
  };
  return {
    schemaVersion: 1, observedAt: catalog.observed_at,
    runtimeFingerprint: hash(JSON.stringify(sourceDefinitions)),
    coverage: Object.fromEntries(COVERAGE.map(key => [key, true])),
    functions, triggerBindings, eventTriggerBindings,
    counts: { functions: functions.length, triggerBindings: triggerBindings.length,
      externalTriggerBindings: triggerBindings.filter(binding => binding.tableSchema !== "public").length,
      eventTriggerBindings: eventTriggerBindings.length,
      reviewedUnboundTriggerDefinitions: functions.filter(fn => fn.disposition === "reviewed_unbound_trigger_definition").length,
      pendingFunctionReviews: functions.filter(fn => fn.disposition === "runtime_review_required").length },
    fullRuntimeReconciled: false, deployable: false,
    boundary: "Catalog classification only. No source/target rows or runtime schema changed; converter gates remain open.",
  };
}

/** Link reviewed metadata without turning a correspondence into semantic approval. */
export function linkSourceRuntimeCounterparts(report, trace) {
  if (report?.schemaVersion !== 1 || report.fullRuntimeReconciled !== false || report.deployable !== false ||
      trace?.schemaVersion !== 1 || trace.fullRuntimeReconciled !== false || trace.converterDeployable !== false ||
      trace.runtimeFingerprint !== report.runtimeFingerprint || !Array.isArray(trace.functions) ||
      trace.functionsCount !== trace.functions.length || trace.functions.length !== report.functions.length) {
    fail("source_runtime_counterpart_scope_mismatch");
  }
  const entries = new Map();
  for (const fn of trace.functions) {
    if (!text(fn.name) || typeof fn.identityArguments !== "string") fail("source_runtime_counterpart_invalid");
    const key = JSON.stringify([fn.name, fn.identityArguments]);
    if (entries.has(key)) fail("source_runtime_counterpart_duplicate");
    const counterpart = fn.counterpart;
    if (fn.counterpartSemanticApprovalInferred !== false || !counterpart || ["location", "actor", "boundaryAndEvidence", "remainingBoundary"].some(name =>
        !text(counterpart[name]) || counterpart[name].length > 16000)) fail("source_runtime_counterpart_invalid");
    entries.set(key, fn);
  }
  const functions = report.functions.map(fn => {
    const counterpart = entries.get(JSON.stringify([fn.name, fn.identityArguments]));
    if (!counterpart || ["result", "definitionSha256", "language", "securityDefiner", "volatility", "bindingCount"]
      .some(name => counterpart[name] !== fn[name])) fail("source_runtime_counterpart_definition_mismatch");
    // Keep prose/source constants out of the metadata report; hash only the four
    // documented fields, never arbitrary extra fields supplied in a trace.
    const content = Object.fromEntries(["location", "actor", "boundaryAndEvidence", "remainingBoundary"]
      .map(name => [name, counterpart.counterpart[name]]));
    return { ...fn, counterpart: { identityAndDefinitionMatched: true, correspondenceSha256: hash(JSON.stringify(content)),
      semanticApprovalInferred: false } };
  });
  return { ...report, functions, counterpartTrace: {
    functionCount: functions.length, missingFunctionCount: 0,
    traceSha256: hash(JSON.stringify(functions.map(fn => [fn.name, fn.identityArguments, fn.counterpart.correspondenceSha256]))),
    semanticApprovalInferred: false,
    boundary: "Exact source identity, definition, attributes and binding count matched to manual correspondence; feature/provider/operational acceptance and converter gates remain separate.",
  } };
}

async function main() {
  const args = process.argv.slice(2);
  if (![4, 6].includes(args.length) || args[0] !== "--catalog" || args[2] !== "--output" ||
      (args.length === 6 && args[4] !== "--counterparts")) fail("source_runtime_usage_requires_catalog_and_output");
  const input = path.resolve(args[1]), output = path.resolve(args[3]);
  const inputReal = await realpath(input);
  const outputReal = await realpath(output).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return realpath(path.dirname(output)).then(parent => path.join(parent, path.basename(output)));
  });
  if (inputReal === outputReal || (await stat(input)).size > 2 * 1024 * 1024) fail("source_runtime_paths_or_size_invalid");
  const raw = JSON.parse(await readFile(input, "utf8"));
  let catalog = raw;
  if (raw.rows) {
    if (raw.rows.length !== 1 || !raw.rows[0]?.jsonb_build_object) fail("source_runtime_query_result_invalid");
    catalog = raw.rows[0].jsonb_build_object;
    if (typeof catalog === "string") catalog = JSON.parse(catalog);
  }
  let report = reviewSourceRuntime(catalog);
  if (args.length === 6) {
    const tracePath = path.resolve(args[5]);
    if (await realpath(tracePath) === outputReal || (await stat(tracePath)).size > 2 * 1024 * 1024) {
      fail("source_runtime_paths_or_size_invalid");
    }
    report = linkSourceRuntimeCounterparts(report, JSON.parse(await readFile(tracePath, "utf8")));
  }
  const temporary = `${output}.pending-${randomUUID()}`;
  try {
    await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, output);
  } finally { await unlink(temporary).catch(() => {}); }
  console.log(JSON.stringify({ observedAt: report.observedAt, ...report.counts, ...(report.counterpartTrace ? { mappedFunctionCount: report.counterpartTrace.functionCount } : {}), fullRuntimeReconciled: false, deployable: false }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(/^source_runtime_[a-z_]+$/u.test(error?.message ?? "") ? error.message : "source_runtime_review_failed");
    process.exitCode = 1;
  });
}
