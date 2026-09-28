import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL(".", import.meta.url));
const typeScriptImports = new Set([
  "checkout-payment-assessment.test.mjs",
  "extension-application-result.test.mjs",
  "ingress.test.mjs",
  "invoice-projection.test.mjs",
]);
const pgliteTestFiles = new Set([
  "dispatch-leases.test.mjs",
  "extension-application.test.mjs",
  "ingress.test.mjs",
  "invoice-projection.test.mjs",
  "receipt-foundation.test.mjs",
  "row-conversion.test.mjs",
  "snapshot-export.test.mjs",
]);
const testFiles = readdirSync(new URL("./test/", import.meta.url))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();
const snapshotExportIndex = testFiles.indexOf("snapshot-export.test.mjs");
if (snapshotExportIndex > 0) {
  // Run the PGlite snapshot integration before the other database-heavy suites.
  testFiles.unshift(testFiles.splice(snapshotExportIndex, 1)[0]);
}

for (const file of testFiles) {
  const args = ["--test", "--test-concurrency=1", `test/${file}`];
  if (typeScriptImports.has(file)) args.unshift("--import", "tsx");

  const attempts = pgliteTestFiles.has(file) ? 2 : 1;
  const timeoutMs = file === "snapshot-export.test.mjs" ? 360_000 : 180_000;
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    process.stdout.write(`\n=== ${file} (attempt ${attempt}/${attempts}) ===\n`);
    result = spawnSync(process.execPath, args, {
      cwd: packageDirectory,
      stdio: "inherit",
      timeout: timeoutMs,
    });

    if (result.error?.code !== "ETIMEDOUT" || attempt === attempts) break;
    process.stderr.write(`Timed out after ${timeoutMs / 1000} seconds: ${file}; retrying once in a fresh process\n`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (result.error?.code === "ETIMEDOUT") {
    process.stderr.write(`Timed out after ${timeoutMs / 1000} seconds: ${file}\n`);
    process.exitCode = 1;
    break;
  }
  if (result.error) {
    process.stderr.write(`Could not run ${file}: ${result.error.message}\n`);
    process.exitCode = 1;
    break;
  }
  if (result.status !== 0) {
    process.stderr.write(`Test file failed: ${file}\n`);
    process.exitCode = result.status ?? 1;
    break;
  }
}
