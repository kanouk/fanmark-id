import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, unlink, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROLES = ["anon", "authenticated", "service_role"];
const COVERAGE = ["public_tables", "public_policies", "public_function_acl", "api_role_effective_privileges",
  "function_definitions_and_types", "relation_options"];
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const ordered = rows => rows.toSorted((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const text = value => typeof value === "string" && value.length > 0;
const bool = value => typeof value === "boolean";
function requireValid(condition, code) { if (!condition) throw new Error(`source_authorization_${code}`); }
function privileges(rows, keys) {
  requireValid(Array.isArray(rows) && rows.length === ROLES.length &&
    new Set(rows.map(row => row?.role)).size === ROLES.length &&
    rows.every(row => ROLES.includes(row.role) && keys.every(key => bool(row[key]))), "role_privileges_invalid");
  return ordered(rows.map(row => Object.fromEntries(["role", ...keys].map(key => [key, row[key]]))));
}

export function reviewSourceAuthorization(catalog) {
  requireValid(catalog && COVERAGE.every(key => catalog.coverage?.[key] === true), "scope_incomplete");
  requireValid(text(catalog.observed_at) && Number.isFinite(Date.parse(catalog.observed_at)) &&
    ["roles", "tables", "policies", "functions"].every(key => Array.isArray(catalog[key])) &&
    catalog.tables.length > 0 && catalog.functions.length > 0, "catalog_invalid");
  requireValid(catalog.roles.length === ROLES.length && new Set(catalog.roles.map(row => row?.name)).size === ROLES.length &&
    catalog.roles.every(row => ROLES.includes(row.name) && [row.superuser, row.inherit, row.bypass_rls].every(bool)), "roles_invalid");
  const roles = ordered(catalog.roles.map(row => ({ name: row.name, superuser: row.superuser,
    inherit: row.inherit, bypassRls: row.bypass_rls })));
  const relations = new Map();
  const tables = ordered(catalog.tables.map(row => {
    requireValid(text(row.name) && text(row.owner) && ["r", "p", "v", "m"].includes(row.kind) &&
      bool(row.rls_enabled) && bool(row.rls_forced) && Array.isArray(row.options) &&
      row.options.every(text) && !relations.has(row.name), "relation_invalid");
    relations.set(row.name, row.kind);
    const isView = ["v", "m"].includes(row.kind);
    return { name: row.name, owner: row.owner, kind: row.kind, rlsEnabled: row.rls_enabled,
      rlsForced: row.rls_forced,
      viewSecurityInvoker: row.kind === "v" ? row.options.includes("security_invoker=true") : null,
      optionsSha256: hash(ordered(row.options)),
      effectivePrivileges: privileges(row.effective_privileges, ["select", "insert", "update", "delete"]),
      disposition: isView ? "view_owner_and_underlying_relations_review_required" : "worker_authorization_review_required" };
  }));
  const policyIdentities = new Set();
  const policies = ordered(catalog.policies.map(row => {
    const identity = JSON.stringify([row.table, row.name]);
    requireValid(text(row.table) && ["r", "p"].includes(relations.get(row.table)) && text(row.name) &&
      !policyIdentities.has(identity) && ["PERMISSIVE", "RESTRICTIVE"].includes(row.permissive) &&
      ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"].includes(row.command) &&
      Array.isArray(row.roles) && row.roles.length > 0 && row.roles.every(text) &&
      new Set(row.roles).size === row.roles.length &&
      (row.using === null || text(row.using)) && (row.check === null || text(row.check)), "policy_invalid");
    policyIdentities.add(identity);
    return { table: row.table, name: row.name, permissive: row.permissive,
      roles: row.roles.toSorted(compare), command: row.command,
      usingPresent: row.using !== null, checkPresent: row.check !== null,
      expressionsSha256: hash({ using: row.using, check: row.check }),
      disposition: "worker_authorization_review_required" };
  }));
  const functionIdentities = new Set();
  const functions = ordered(catalog.functions.map(row => {
    const identity = JSON.stringify([row.name, row.identity_arguments]);
    requireValid(text(row.name) && typeof row.identity_arguments === "string" &&
      ["f", "p"].includes(row.kind) && (text(row.result) || (row.kind === "p" && row.result === null)) &&
      text(row.definition) && text(row.owner) && bool(row.security_definer) &&
      !functionIdentities.has(identity) && (row.acl === null || Array.isArray(row.acl)), "function_invalid");
    functionIdentities.add(identity);
    const aclIdentities = new Set();
    const acl = ordered((row.acl ?? []).map(grant => {
      const grantIdentity = JSON.stringify([grant.grantor, grant.grantee, grant.privilege]);
      requireValid(text(grant.grantor) && text(grant.grantee) && grant.privilege === "EXECUTE" &&
        bool(grant.grantable) && !aclIdentities.has(grantIdentity), "function_acl_invalid");
      aclIdentities.add(grantIdentity);
      return { grantor: grant.grantor, grantee: grant.grantee, privilege: grant.privilege, grantable: grant.grantable };
    }));
    const invocationKind = row.result === "trigger" ? "trigger" : row.result === "event_trigger" ? "event_trigger"
      : row.kind === "p" ? "procedure" : "ordinary_function";
    return { name: row.name, identityArguments: row.identity_arguments, kind: row.kind, result: row.result,
      owner: row.owner, securityDefiner: row.security_definer, invocationKind,
      definitionSha256: createHash("sha256").update(row.definition).digest("hex"), acl,
      effectiveExecute: privileges(row.effective_execute, ["execute"]),
      disposition: ["trigger", "event_trigger"].includes(invocationKind) ? "trigger_binding_review_required"
        : "function_body_caller_and_authorization_review_required" };
  }));
  const nonTriggers = functions.filter(fn => ["ordinary_function", "procedure"].includes(fn.invocationKind));
  const executionCounts = rows => Object.fromEntries(ROLES.map(role => [role,
    rows.filter(fn => fn.effectiveExecute.some(grant => grant.role === role && grant.execute)).length]));
  const normalized = { roles, tables, policies, functions };
  return { schemaVersion: 1, observedAt: catalog.observed_at,
    authorizationFingerprint: hash(normalized), coverage: Object.fromEntries(COVERAGE.map(key => [key, true])),
    ...normalized,
    counts: { relations: tables.length, tables: tables.filter(row => ["r", "p"].includes(row.kind)).length,
      views: tables.filter(row => ["v", "m"].includes(row.kind)).length,
      rlsEnabledTables: tables.filter(row => ["r", "p"].includes(row.kind) && row.rlsEnabled).length,
      policies: policies.length, functions: functions.length,
      triggerFunctions: functions.filter(fn => ["trigger", "event_trigger"].includes(fn.invocationKind)).length,
      nonTriggerRoutines: nonTriggers.length, securityDefiners: functions.filter(fn => fn.securityDefiner).length,
      effectiveExecuteIncludingTriggers: executionCounts(functions), effectiveExecuteNonTriggers: executionCounts(nonTriggers) },
    authorizationReconciled: false, deployable: false,
    boundary: "Catalog metadata only. EXECUTE is not proof of RPC exposure or allowed business actions; table grants are not effective access under RLS. No source/target rows or schema changed.",
  };
}

async function main() {
  const args = process.argv.slice(2);
  requireValid(args.length === 4 && args[0] === "--catalog" && args[2] === "--output", "usage_requires_catalog_and_output");
  const input = path.resolve(args[1]), output = path.resolve(args[3]);
  const inputReal = await realpath(input);
  const outputReal = await realpath(output).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return realpath(path.dirname(output)).then(parent => path.join(parent, path.basename(output)));
  });
  requireValid(inputReal !== outputReal && (await stat(input)).size <= 2 * 1024 * 1024, "paths_or_size_invalid");
  const raw = JSON.parse(await readFile(input, "utf8"));
  let catalog = raw;
  if (raw.rows) {
    requireValid(raw.rows.length === 1 && raw.rows[0]?.jsonb_build_object, "query_result_invalid");
    catalog = raw.rows[0].jsonb_build_object;
    if (typeof catalog === "string") catalog = JSON.parse(catalog);
  }
  const report = reviewSourceAuthorization(catalog), temporary = `${output}.pending-${randomUUID()}`;
  try {
    await writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, output);
  } finally { await unlink(temporary).catch(() => {}); }
  console.log(JSON.stringify({ observedAt: report.observedAt, ...report.counts, authorizationReconciled: false, deployable: false }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(/^source_authorization_[a-z_]+$/u.test(error?.message ?? "") ? error.message : "source_authorization_review_failed");
    process.exitCode = 1;
  });
}
