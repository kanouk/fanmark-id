#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderReferenceMasterReleaseSql, sha256Hex } from "./reference-master-release.mjs";

function fail(code) {
  throw new Error(code);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || index + 1 >= argv.length || argv[index + 1].startsWith("--")) fail("arguments_invalid");
    if (values.has(key)) fail("arguments_duplicate");
    values.set(key, argv[++index]);
  }
  if (values.size !== 2 || !values.has("--snapshot") || !values.has("--sql-out")) fail("arguments_invalid");
  return { snapshot: values.get("--snapshot"), sqlOut: values.get("--sql-out") };
}

async function readPrivateFile(filePath, repoRoot) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith("/private/") || resolved.startsWith(repoRoot + path.sep)) fail("snapshot_path_not_private");
  const info = await fs.lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("snapshot_permissions_invalid");
  return fs.readFile(resolved);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const snapshotBytes = await readPrivateFile(options.snapshot, repoRoot);
  let snapshot;
  try {
    snapshot = JSON.parse(snapshotBytes.toString("utf8"));
  } catch {
    fail("snapshot_json_invalid");
  }
  const rendered = renderReferenceMasterReleaseSql({ snapshot, snapshotSha256: sha256Hex(snapshotBytes) });
  const outputPath = path.resolve(options.sqlOut);
  if (!outputPath.startsWith("/private/") || outputPath.startsWith(repoRoot + path.sep) || outputPath === path.resolve(options.snapshot)) {
    fail("sql_output_path_not_private");
  }
  await fs.writeFile(outputPath, rendered.sql, { mode: 0o600, flag: "wx" });
  await fs.chmod(outputPath, 0o600);
  process.stdout.write(JSON.stringify({
    release_version: rendered.releaseVersion,
    activation_id: rendered.activationId,
    statements: rendered.statements.length,
    output_bytes: Buffer.byteLength(rendered.sql),
    output_sha256: sha256Hex(Buffer.from(rendered.sql)),
    mode: "0600",
  }) + "\n");
}

main().catch((error) => {
  process.stderr.write(`Reference master SQL render failed (${error?.message ?? "unknown_error"}).\n`);
  process.exitCode = 1;
});
