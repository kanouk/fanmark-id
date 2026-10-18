// Offline preparation inventory. No credentials, network, shell, or deployment.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const configPath = "workers/api/wrangler.app-staging.jsonc";
export const policyPath = "docs/migration/production-preparation-policy.json";
export const reportPath = "docs/migration/evidence/production-preparation-offline.json";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sorted = (values) => [...values].sort();
function same(actual, expected, code) {
  if (JSON.stringify(sorted(actual)) !== JSON.stringify(sorted(expected))) throw new Error(code);
}

export function createPreparationReport({ config, policy, read, list }) {
  same(Object.keys(config), policy.configSections, "unreviewed_config_section");
  const entries = Object.entries(policy.variableGroups).flatMap(([disposition, names]) =>
    names.map((name) => ({ name, disposition })));
  if (new Set(entries.map(({ name }) => name)).size !== entries.length) throw new Error("duplicate_variable_policy");
  same(Object.keys(config.vars), entries.map(({ name }) => name), "unreviewed_config_variable");
  same(config.d1_databases.map(({ binding }) => binding), Object.keys(policy.schemas), "unreviewed_d1_binding");
  same(config.r2_buckets.map(({ binding }) => binding), policy.r2Bindings, "unreviewed_r2_binding");
  same(config.durable_objects.bindings.map(({ name }) => name), policy.doBindings, "unreviewed_do_binding");
  const fingerprint = (path) => {
    if (!/^(workers\/api|scripts|src|supabase\/functions|docs\/migration)\/[\w./-]+$/.test(path) || path.includes("..")) {
      throw new Error("unsafe_inventory_path");
    }
    return { path, sha256: hash(read(path)) };
  };
  const schemas = config.d1_databases.map((database) => {
    const expected = policy.schemas[database.binding];
    if (database.migrations_dir !== expected.directory ||
        (database.migrations_pattern ?? null) !== expected.selector) throw new Error("unreviewed_schema_selector");
    const directory = `workers/api/${expected.directory}`;
    const available = sorted(list(directory).filter((name) => name.endsWith(".sql")));
    const names = expected.files ?? available;
    if (new Set(names).size !== names.length || names.some((name) => !available.includes(name))) {
      throw new Error("schema_file_missing_or_duplicate");
    }
    if (expected.selector !== null) {
      const match = expected.selector.match(/^migrations\/\{([^{}]+)\}$/);
      if (!match) throw new Error("unreviewed_schema_selector");
      const selected = match[1].split(",").flatMap((term) => {
        if (term === "000[0-6]_*.sql") return available.filter((name) => /^000[0-6]_.*\.sql$/.test(name));
        if (!/^\w+\.sql$/.test(term)) throw new Error("unreviewed_schema_selector");
        return [term];
      });
      same(selected, names, "unreviewed_schema_selection");
    }
    const files = sorted(names).map((name) => fingerprint(`${directory}/${name}`));
    return { binding: database.binding, proposedName: expected.proposedName,
      productionId: null, schemaFileCount: files.length, files,
      // A file-set digest, NOT a live D1 sqlite_schema/recovery guard digest.
      migrationFilesSha256: hash(JSON.stringify(files)) };
  });
  return {
    format: "fanmark-production-preparation-v1", scope: "offline-repository-only",
    productionReady: false, deployable: false,
    pendingGates: ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"],
    configurationFingerprint: fingerprint(configPath), policyFingerprint: fingerprint(policyPath),
    variables: entries.sort((a, b) => a.name.localeCompare(b.name, "en")),
    schemas,
    r2: sorted(policy.r2Bindings).map((binding) => ({ binding, productionName: null })),
    durableObjects: sorted(policy.doBindings).map((binding) => ({ binding, productionNamespace: null })),
    ratelimits: sorted(config.ratelimits.map(({ name }) => name)).map((binding) => ({ binding, productionNamespace: null })),
    productionAccount: null, productionZone: null, productionWorker: null,
    // Only names are emitted. Values and environment secrets must stay private.
    implementationFingerprints: sorted(policy.implementationFiles).map(fingerprint),
  };
}

export function readPreparationReport(directory = root) {
  const read = (path) => readFileSync(resolve(directory, path));
  return createPreparationReport({ config: JSON.parse(read(configPath)), policy: JSON.parse(read(policyPath)),
    read, list: (path) => readdirSync(resolve(directory, path)) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && args[0] !== "--check")) throw new Error("usage: production-preparation-audit.mjs [--check]");
    const serialized = JSON.stringify(readPreparationReport(), null, 2) + "\n";
    if (args[0] === "--check") {
      if (readFileSync(resolve(root, reportPath), "utf8") !== serialized) throw new Error("preparation_inventory_stale");
      console.log("Offline inventory matches. P1-P8 remain pending; productionReady=false.");
    } else process.stdout.write(serialized);
  } catch (error) {
    // Do not emit filesystem contents, caller data, or native exception paths.
    const safe = /^(unreviewed_|duplicate_variable_policy|unsafe_inventory_path|schema_file_|preparation_inventory_stale|usage:)/;
    console.error(safe.test(error.message) ? error.message : "preparation_inventory_read_failed");
    process.exitCode = 1;
  }
}
