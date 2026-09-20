#!/usr/bin/env node

/**
 * Build a bounded, offline inventory for the Supabase -> Cloudflare migration.
 *
 * This module deliberately reads only the checkout. It does not initialize a
 * Supabase client, read environment variables, call a network API, or export
 * data. Generated types are the source for current object counts; SQL dumps
 * and migrations are evidence files and are never treated as live state.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const THIS_FILE = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(THIS_FILE), "../..");
const ARCHIVE_RELATIVE = "supabase/migrations_archive";
const GENERATED_TYPES_RELATIVE = "src/integrations/supabase/types.ts";
const SKIP_DIR_NAMES = new Set([".git", "node_modules", "dist", "build", ".vite"]);

const TABLE_OPERATIONS = ["select", "insert", "update", "upsert", "delete"];
const STORAGE_OPERATIONS = [
  "upload",
  "download",
  "remove",
  "list",
  "move",
  "copy",
  "getPublicUrl",
  "createSignedUrl",
  "createSignedUrls",
  "createSignedUploadUrl",
];
const DEFAULT_SUPABASE_IDENTIFIERS = new Set([
  "supabase",
  "supabaseClient",
  "supabaseAdmin",
  "adminClient",
  "client",
  "db",
]);
const BUILTIN_RECEIVERS = new Set(["Array", "Object", "String", "Number", "Boolean", "URLSearchParams", "FormData"]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relativePath(root, absolutePath) {
  return toPosix(path.relative(root, absolutePath));
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function lineNumber(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text[cursor] === "\n") line += 1;
  }
  return line;
}

function location(root, filePath, text, index) {
  return `${relativePath(root, filePath)}:${lineNumber(text, index)}`;
}

function listFiles(root, relativeDirectory, predicate = () => true) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];

  const files = [];
  const visit = (currentDirectory) => {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIR_NAMES.has(entry.name)) continue;
      const currentPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(currentPath);
      } else if (entry.isFile() && predicate(currentPath)) {
        files.push(currentPath);
      }
    }
  };

  visit(directory);
  return files.sort((left, right) => relativePath(root, left).localeCompare(relativePath(root, right)));
}

function compactExpression(value, maxLength = 120) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

function unwrapExpression(expression) {
  let current = expression;
  while (current && (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isParenthesizedExpression(current))) {
    current = current.expression;
  }
  return current;
}

function propertyChain(expression) {
  const names = [];
  let current = expression;
  while (current && ts.isPropertyAccessExpression(current)) {
    names.unshift(current.name.text);
    current = current.expression;
  }
  if (current && ts.isIdentifier(current)) names.unshift(current.text);
  if (!names.length || !current || !ts.isIdentifier(current)) return null;
  return { base: names[0], names };
}

function collectSupabaseIdentifiers(sourceFile) {
  const identifiers = new Set(DEFAULT_SUPABASE_IDENTIFIERS);
  const imports = [];
  const addImportBindings = (statement) => {
    const moduleName = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
    const looksLikeSupabase = /supabase/i.test(moduleName);
    if (!looksLikeSupabase) return;
    const clause = statement.importClause;
    if (!clause) return;
    if (clause.name) identifiers.add(clause.name.text);
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        identifiers.add(clause.namedBindings.name.text);
      } else {
        for (const element of clause.namedBindings.elements) identifiers.add(element.name.text);
      }
    }
    imports.push(moduleName);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) addImportBindings(statement);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (!initializer || !ts.isIdentifier(declaration.name)) continue;
      if (ts.isCallExpression(initializer) && /createClient$/.test(initializer.expression.getText(sourceFile))) {
        identifiers.add(declaration.name.text);
      }
    }
  }
  return { identifiers, imports };
}

function classifyCall(expression) {
  const chain = propertyChain(expression);
  if (!chain) return null;
  const { names } = chain;
  const method = names.at(-1);
  if (method === "invoke" && names.at(-2) === "functions") {
    return { kind: "edge", operation: "edge_function_invoke", resource: true };
  }
  if (method === "from" && names.at(-2) === "storage") {
    return { kind: "storage", operation: "storage.from", resource: true, chain: STORAGE_OPERATIONS };
  }
  if (method === "from") {
    return { kind: "table", operation: "table.from", resource: true, chain: TABLE_OPERATIONS };
  }
  if (method === "rpc") {
    return { kind: "rpc", operation: "rpc", resource: true };
  }
  const authIndex = names.indexOf("auth");
  if (authIndex >= 0 && authIndex < names.length - 1) {
    const suffix = names.slice(authIndex + 1);
    if (suffix[0] === "admin") return { kind: "auth_admin", operation: `auth.admin.${suffix.at(-1)}`, resource: false };
    if (suffix[0] === "mfa") return { kind: "auth_mfa", operation: `auth.mfa.${suffix.at(-1)}`, resource: false };
    return { kind: "auth", operation: `auth.${suffix.at(-1)}`, resource: false };
  }
  if (method === "channel" && (names.includes("realtime") || names.length >= 2)) {
    return { kind: "realtime", operation: "realtime.channel", resource: true };
  }
  if (method === "removeChannel") {
    return { kind: "realtime", operation: "realtime.removeChannel", resource: true };
  }
  return null;
}

function likelyUnsupportedReceiver(base, identifiers) {
  if (identifiers.has(base) || DEFAULT_SUPABASE_IDENTIFIERS.has(base)) return false;
  if (BUILTIN_RECEIVERS.has(base)) return false;
  return /supabase|client|db|database|api/i.test(base);
}

function chainedOperation(call, operations) {
  if (!operations) return null;
  const allowed = new Set(operations);
  let current = call;
  for (let depth = 0; depth < 30; depth += 1) {
    const parent = current.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === current) {
      if (allowed.has(parent.name.text)) return parent.name.text;
      current = parent;
      continue;
    }
    if (parent && ts.isCallExpression(parent) && parent.expression === current) {
      current = parent;
      continue;
    }
    break;
  }
  return null;
}

function firstArgument(call, sourceFile) {
  const argument = call.arguments[0];
  if (!argument) return { value: null, expression: "missing argument" };
  const unwrapped = unwrapExpression(argument);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return { value: unwrapped.text, expression: null };
  }
  return { value: null, expression: compactExpression(unwrapped.getText(sourceFile)) };
}

function analyzeSourceFile(text, filePath, root) {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind);
  const { identifiers, imports } = collectSupabaseIdentifiers(sourceFile);
  const calls = [];
  const unsupportedAliases = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const classification = classifyCall(node.expression);
      if (classification) {
        const chain = propertyChain(node.expression);
        const receiver = chain?.base ?? "<expression>";
        const supported = chain && identifiers.has(receiver);
        if (supported) {
          const argument = firstArgument(node, sourceFile);
          const isAuthMethod = classification.kind.startsWith("auth");
          const operation =
            classification.kind === "table"
              ? `table.${chainedOperation(node, classification.chain) ?? "from"}`
              : classification.kind === "storage"
                ? `storage.${chainedOperation(node, classification.chain) ?? "from"}`
                : classification.operation;
          const start = node.getStart(sourceFile);
          calls.push({
            kind: classification.kind,
            operation,
            target: isAuthMethod ? "auth" : argument.value ?? "<unresolved>",
            ...(!isAuthMethod && argument.expression ? { expression: argument.expression } : {}),
            file: relativePath(root, filePath),
            line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
            location: `${relativePath(root, filePath)}:${sourceFile.getLineAndCharacterOfPosition(start).line + 1}`,
            offset: start,
          });
        } else if (chain && likelyUnsupportedReceiver(receiver, identifiers)) {
          const start = node.getStart(sourceFile);
          unsupportedAliases.push({
            receiver,
            operation: classification.operation,
            location: `${relativePath(root, filePath)}:${sourceFile.getLineAndCharacterOfPosition(start).line + 1}`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { calls, unsupportedAliases, imports };
}

/**
 * Analyze Supabase calls from one source string. TypeScript's AST ignores
 * comments and string literals, and call offsets keep same-line calls distinct.
 */
export function analyzeSupabaseCallsites(text, filePath = "fixture.ts", root = process.cwd()) {
  const result = analyzeSourceFile(text, filePath, root);
  result.calls.sort((left, right) => left.offset - right.offset);
  result.unsupportedAliases.sort((left, right) => left.location.localeCompare(right.location) || left.operation.localeCompare(right.operation));
  return result;
}

export function extractSupabaseCallsites(text, filePath = "fixture.ts", root = process.cwd()) {
  return analyzeSupabaseCallsites(text, filePath, root).calls;
}

function parseGeneratedTypeNames(typesText, section) {
  const sectionMatch = typesText.match(new RegExp(`    ${section}: \\{([\\s\\S]*?)\\n    \\}`));
  if (!sectionMatch) return [];
  const sectionStart = (sectionMatch.index ?? 0) + sectionMatch[0].indexOf(sectionMatch[1]);
  return [...sectionMatch[1].matchAll(/^      ([A-Za-z0-9_]+):\s*\{/gm)].map((match) => ({
    name: match[1],
    line: lineNumber(typesText, sectionStart + match.index),
  }));
}

function parseConfigFunctions(configText) {
  const entries = new Map();
  let current = null;
  const lines = configText.split("\n");
  lines.forEach((line, index) => {
    const section = line.match(/^\[functions\.([^\]]+)\]/);
    if (section) {
      current = { name: section[1], line: index + 1, verifyJwt: null, verifyJwtLine: null };
      entries.set(current.name, current);
      return;
    }
    if (current) {
      const verify = line.match(/^\s*verify_jwt\s*=\s*(true|false)\s*$/);
      if (verify) {
        current.verifyJwt = verify[1] === "true";
        current.verifyJwtLine = index + 1;
      }
    }
  });
  return entries;
}

function collectEdgeEntrypoints(root) {
  const functionsDirectory = path.join(root, "supabase/functions");
  if (!fs.existsSync(functionsDirectory)) return [];
  const configPath = path.join(root, "supabase/config.toml");
  const configEntries = fs.existsSync(configPath) ? parseConfigFunctions(readText(configPath)) : new Map();
  const entrypoints = [];
  for (const entry of fs.readdirSync(functionsDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name === "_shared") continue;
    const entrypointPath = path.join(functionsDirectory, entry.name, "index.ts");
    if (!fs.existsSync(entrypointPath)) continue;
    const source = readText(entrypointPath);
    const handlerMatch = source.match(/\b(?:Deno\.)?serve\s*\(/);
    const config = configEntries.get(entry.name);
    entrypoints.push({
      name: entry.name,
      path: relativePath(root, entrypointPath),
      verifyJwt: config?.verifyJwt ?? null,
      configLocation: config ? `supabase/config.toml:${config.verifyJwtLine ?? config.line}` : null,
      handler: handlerMatch ? `serve:${lineNumber(source, handlerMatch.index)}` : "serve:unresolved",
    });
  }
  return entrypoints;
}

function addReference(referenceMap, name, filePath, line) {
  if (!referenceMap.has(name)) referenceMap.set(name, new Map());
  const files = referenceMap.get(name);
  const relative = filePath;
  if (!files.has(relative)) files.set(relative, new Set());
  files.get(relative).add(line);
}

function scanSqlReferences(root, files) {
  const references = {
    auth: new Map(),
    storage: new Map(),
    cron: new Map(),
  };

  for (const filePath of files) {
    const file = relativePath(root, filePath);
    const lines = readText(filePath).split("\n");
    lines.forEach((lineText, index) => {
      const line = index + 1;
      const authMatches = lineText.matchAll(/\bauth\.(users|sessions|uid|role|jwt|identities)\b/gi);
      for (const match of authMatches) addReference(references.auth, `auth.${match[1].toLowerCase()}`, file, line);

      const storageMatches = lineText.matchAll(/\bstorage\.(objects|foldername|filename)\b/gi);
      for (const match of storageMatches) addReference(references.storage, `storage.${match[1]}`, file, line);
      if (/\bbucket_id\b/i.test(lineText)) {
        addReference(references.storage, "bucket_id", file, line);
        for (const bucket of lineText.matchAll(/(?:bucket_id\s*(?:=|,)\s*|bucket_id[^'\"]{0,60})['\"]([^'\"]+)['\"]/gi)) {
          addReference(references.storage, `bucket:${bucket[1]}`, file, line);
        }
      }

      if (/\bpg_cron\b/i.test(lineText)) addReference(references.cron, "pg_cron", file, line);
      for (const match of lineText.matchAll(/\bcron\.(job|alter_job|schedule|unschedule)\b/gi)) {
        addReference(references.cron, `cron.${match[1].toLowerCase()}`, file, line);
      }
      if (/\bnet\.http_post\b/i.test(lineText)) addReference(references.cron, "net.http_post", file, line);
      for (const match of lineText.matchAll(/functions\/v1\/([A-Za-z0-9-]+)/g)) {
        addReference(references.cron, `edge-url:${match[1]}`, file, line);
      }
    });
  }
  return references;
}

function compressLineNumbers(numbers) {
  const sorted = [...new Set(numbers)].sort((left, right) => left - right);
  const ranges = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  return ranges.join(",");
}

function formatReferenceLocations(fileMap) {
  return [...fileMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, lines]) => `${file}:${compressLineNumbers(lines)}`)
    .join("; ");
}

function serializeReferences(referenceMap) {
  return [...referenceMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, files]) => ({ name, locations: formatReferenceLocations(files) }));
}

function collectSqlEvidenceFiles(root) {
  const migrations = listFiles(root, "supabase/migrations", (filePath) => filePath.endsWith(".sql"));
  const snapshots = ["supabase/remote_schema.sql", "supabase/remote_schema_before_rls_push.sql"]
    .map((file) => path.join(root, file))
    .filter((filePath) => fs.existsSync(filePath));
  const config = path.join(root, "supabase/config.toml");
  if (fs.existsSync(config)) snapshots.push(config);
  return [...migrations, ...snapshots];
}

function collectFrontendCallsites(root) {
  const sourceFiles = listFiles(root, "src", (filePath) => /\.(?:ts|tsx)$/.test(filePath));
  const callsites = [];
  const unsupportedAliases = [];
  for (const filePath of sourceFiles) {
    const analysis = analyzeSupabaseCallsites(readText(filePath), filePath, root);
    callsites.push(...analysis.calls);
    unsupportedAliases.push(...analysis.unsupportedAliases);
  }
  return { callsites, unsupportedAliases };
}

function readBaseCommit(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unresolved-head";
  }
}

export function buildInventory(root = DEFAULT_ROOT) {
  const absoluteRoot = path.resolve(root);
  const typesPath = path.join(absoluteRoot, GENERATED_TYPES_RELATIVE);
  const typesText = readText(typesPath);
  const sqlEvidenceFiles = collectSqlEvidenceFiles(absoluteRoot);
  const sqlReferences = scanSqlReferences(absoluteRoot, sqlEvidenceFiles);
  const frontendAnalysis = collectFrontendCallsites(absoluteRoot);
  const archiveFiles = listFiles(absoluteRoot, ARCHIVE_RELATIVE, (filePath) => filePath.endsWith(".sql"));
  const historicalExport = path.join(absoluteRoot, "supabase/remote_migration_versions.sql");

  return {
    baseCommit: readBaseCommit(absoluteRoot),
    generatedTypes: {
      source: GENERATED_TYPES_RELATIVE,
      tables: parseGeneratedTypeNames(typesText, "Tables"),
      views: parseGeneratedTypeNames(typesText, "Views"),
      functions: parseGeneratedTypeNames(typesText, "Functions"),
    },
    edgeEntrypoints: collectEdgeEntrypoints(absoluteRoot),
    frontendCallsites: frontendAnalysis.callsites,
    unsupportedAliases: frontendAnalysis.unsupportedAliases,
    sqlReferences: {
      auth: serializeReferences(sqlReferences.auth),
      storage: serializeReferences(sqlReferences.storage),
      cron: serializeReferences(sqlReferences.cron),
      evidenceFiles: sqlEvidenceFiles.map((filePath) => relativePath(absoluteRoot, filePath)),
    },
    archive: {
      relativePath: ARCHIVE_RELATIVE,
      sqlFileCount: archiveFiles.length,
      excludedFromCurrentCounts: true,
      historicalMigrationExport: fs.existsSync(historicalExport) ? relativePath(absoluteRoot, historicalExport) : null,
    },
  };
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function inlineCode(value) {
  const text = String(value).replaceAll("\n", " ");
  return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}

function markdownTable(headers, rows) {
  const header = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function renderNameList(items) {
  if (!items.length) return "_none_";
  return items.map((item) => `- \`${item.name}\` (types.ts:${item.line})`).join("\n");
}

export function renderMarkdown(inventory) {
  const { generatedTypes, edgeEntrypoints, frontendCallsites, unsupportedAliases, sqlReferences, archive } = inventory;
  const unresolved = frontendCallsites.filter((call) => call.target === "<unresolved>");
  const operationCounts = new Map();
  for (const call of frontendCallsites) operationCounts.set(call.operation, (operationCounts.get(call.operation) ?? 0) + 1);
  const operationSummary = [...operationCounts.entries()].sort(([left], [right]) => left.localeCompare(right));
  const configured = edgeEntrypoints.filter((entry) => entry.verifyJwt !== null).length;

  const lines = [
    "# fanmark.id repository inventory (offline)",
    "",
    `Base commit: \`${inventory.baseCommit}\``,
    "",
    "This report is generated from the checked-out repository only. It makes no network calls, reads no credentials, and does not claim that local generated types, migrations, or SQL snapshots equal the current production state.",
    "",
    "Run from the repository root:",
    "",
    "```sh",
    "node scripts/migration/inventory.mjs --output docs/migration/repository-inventory.md",
    "```",
    "",
    "## Generated Supabase types",
    "",
    `Source: \`${generatedTypes.source}\` (generated checkout artifact; counts are not live counts).`,
    "",
    markdownTable(["Object kind", "Count"], [
      ["Tables", generatedTypes.tables.length],
      ["Views", generatedTypes.views.length],
      ["Functions / RPCs", generatedTypes.functions.length],
    ]),
    "",
    "### Tables",
    "",
    renderNameList(generatedTypes.tables),
    "",
    "### Views",
    "",
    renderNameList(generatedTypes.views),
    "",
    "### Functions / RPCs",
    "",
    renderNameList(generatedTypes.functions),
    "",
    "## Edge entrypoints",
    "",
    `Found ${edgeEntrypoints.length} local directories with \`index.ts\` (\`_shared\` excluded). ${configured} have an explicit \`verify_jwt\` entry in \`supabase/config.toml\`; an absent value is reported as unconfigured and requires live verification.`,
    "",
    markdownTable(["Function", "Entrypoint", "verify_jwt in config", "Handler signal"], edgeEntrypoints.map((entry) => [
      `\`${entry.name}\``,
      `\`${entry.path}\``,
      entry.verifyJwt === null ? "unconfigured" : String(entry.verifyJwt),
      entry.handler,
    ])),
    "",
    "## Frontend Supabase callsites",
    "",
    `Scanned \`src/**/*.{ts,tsx}\`: ${frontendCallsites.length} callsites. Each row records the first line of the call and the extracted operation.`,
    "",
    markdownTable(["Location", "Kind", "Target", "Operation", "Dynamic expression"], frontendCallsites.map((call) => [
      inlineCode(call.location),
      call.kind,
      inlineCode(call.target),
      inlineCode(call.operation),
      call.expression ? inlineCode(call.expression) : "",
    ])),
    "",
    "Operation summary:",
    "",
    operationSummary.length ? operationSummary.map(([operation, count]) => `- \`${operation}\`: ${count}`).join("\n") : "_none_",
    "",
    "### Unresolved or dynamic call arguments",
    "",
    unresolved.length
      ? unresolved.map((call) => `- ${inlineCode(call.location)}: ${call.kind} (${call.operation}), expression ${inlineCode(call.expression ?? "unresolved")}`).join("\n")
      : "_none detected in frontend source._",
    "",
    "### Unsupported or unknown receiver aliases",
    "",
    unsupportedAliases.length
      ? unsupportedAliases.map((call) => `- \`${call.location}\`: receiver \`${call.receiver}\`, operation \`${call.operation}\``).join("\n")
      : "_none detected in frontend source._",
    "",
    "## SQL, cron, storage, and auth references",
    "",
    "The following references are grouped from current checkout migrations, the two checked-in schema snapshots, and `supabase/config.toml`. Locations are compressed by file and line range. These are evidence references, not a declaration of live state.",
    "",
    `Evidence files (${sqlReferences.evidenceFiles.length}): ${sqlReferences.evidenceFiles.map((file) => `\`${file}\``).join(", ")}`,
    "",
    "### Auth references",
    "",
    sqlReferences.auth.length ? markdownTable(["Reference", "Locations"], sqlReferences.auth.map((ref) => [`\`${ref.name}\``, ref.locations])) : "_none_",
    "",
    "### Storage references",
    "",
    sqlReferences.storage.length ? markdownTable(["Reference", "Locations"], sqlReferences.storage.map((ref) => [`\`${ref.name}\``, ref.locations])) : "_none_",
    "",
    "### Cron / pg_net references",
    "",
    sqlReferences.cron.length ? markdownTable(["Reference", "Locations"], sqlReferences.cron.map((ref) => [`\`${ref.name}\``, ref.locations])) : "_none_",
    "",
    "## Reproduction and tests",
    "",
    "- `node --check scripts/migration/inventory.mjs`",
    "- `node scripts/migration/test-inventory.mjs` (fixture covers comments/strings, multiline and same-line calls, unfinished chains, import aliases, auth MFA, Realtime, and dynamic RPC/Edge arguments retained as unresolved)",
    "- The report is deterministic for a fixed checkout: it contains the Git base commit and no generation timestamp or live response payload.",
    "",
    "## Archive and live-state limits",
    "",
    `- \`${archive.relativePath}/\` contains ${archive.sqlFileCount} historical SQL files. They are excluded from all generated-type/current-object counts; historical names can describe prior states and are not evidence of what is deployed now.`,
    archive.historicalMigrationExport
      ? `- \`${archive.historicalMigrationExport}\` is a migration-history export and is used only as a limitation marker, not as a current-object source.`
      : "- No migration-history export was found.",
    "- `remote_schema.sql` and `remote_schema_before_rls_push.sql` are checked-in snapshots. Their presence does not prove the current production schema, function permissions, cron jobs, storage buckets, auth configuration, secrets, DNS, or deployment state.",
    "- The scanner does not read `.env`, does not enumerate user rows or storage objects, and does not export network data.",
    "- AST call classification uses standard receiver names and imports whose module path contains `supabase`; it is not whole-program symbol/dataflow analysis. Destructured or arbitrary aliases, computed properties, wrappers, and indirect calls need manual follow-up. An empty unsupported-alias list is not proof that no callsite was missed.",
    "",
    "### Unverified live-only inventory",
    "",
    "- No live-only names are knowable from this offline scan. See the coordinator-owned [live observations](live-observations.md) for separately captured read-only observations; those observations are not imported into these local counts.",
    "",
    "Reconcile the live observations with this checkout report before treating any mapping as complete.",
    "",
    "## Remaining mapping work",
    "",
    "- Verify every local Edge entrypoint, configured JWT policy, deployed version, and any live-only function against the production project read-only.",
    "- Reconcile generated types and checked-in SQL snapshots with a fresh, access-controlled production schema readback; resolve drift before selecting Cloudflare D1/R2/Workers targets.",
    "- Resolve the dynamic frontend calls listed above and map each static table/RPC/function/storage operation to an owner, data classification, and Cloudflare replacement or retention decision.",
    "- Confirm pg_cron/pg_net schedules, Auth providers and redirect URLs, Storage buckets/policies, Realtime channels, Stripe/Resend webhooks, and deployment secrets in the live environment. None are proven by this offline report.",
    "",
  ];
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      options.root = path.resolve(argv[++index]);
    } else if (argument === "--output") {
      options.output = path.resolve(argv[++index]);
    } else if (argument === "--help" || argument === "-h") {
      console.log("Usage: node scripts/migration/inventory.mjs [--root PATH] [--output PATH]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  const markdown = renderMarkdown(buildInventory(options.root));
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${markdown}\n`, "utf8");
  } else {
    process.stdout.write(`${markdown}\n`);
  }
}
