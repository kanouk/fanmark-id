import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL(".", import.meta.url));
const typeScriptImports = new Set([
  "checkout-payment-assessment.test.mjs",
  "customer-user-mapping.test.mjs",
  "extension-application-result.test.mjs",
  "ingress.test.mjs",
  "invoice-projection.test.mjs",
  "noop-checkout-receipt.test.mjs",
  "subscription-projection.test.mjs",
  "subscription-application.test.mjs",
]);
const pgliteTestFiles = new Set([
  "dispatch-leases.test.mjs",
  "extension-application.test.mjs",
  "ingress.test.mjs",
  "invoice-projection.test.mjs",
  "receipt-foundation.test.mjs",
  "row-conversion.test.mjs",
  "snapshot-export.test.mjs",
  "subscription-application.test.mjs",
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
  const standalonePglite = file === "snapshot-export.test.mjs";
  const standaloneRunner = standalonePglite || file === "subscription-application.test.mjs";
  const args = standaloneRunner
    ? [`test/${file}`]
    : ["--test", "--test-concurrency=1", `test/${file}`];
  if (typeScriptImports.has(file)) args.unshift("--import", "tsx");

  let attempts = pgliteTestFiles.has(file) ? 2 : 1;
  if (file === "subscription-application.test.mjs") attempts = 3;
  // PGlite can leave a timed-out node:test child alive; bound the outer process
  // and start a clean retry only for ETIMEDOUT.
  const timeoutMs = file === "snapshot-export.test.mjs" || file === "subscription-application.test.mjs"
    ? 120_000
    : 60_000;
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    process.stdout.write(`\n=== ${file} (attempt ${attempt}/${attempts}) ===\n`);
    result = spawnSync(process.execPath, args, {
      cwd: packageDirectory,
      stdio: "inherit",
      env: standalonePglite
        ? { ...process.env, FANMARK_PGLITE_SNAPSHOT_STANDALONE: "1" }
        : process.env,
      timeout: timeoutMs,
      killSignal: process.platform === "win32" ? "SIGTERM" : "SIGKILL",
    });

    if (result.error?.code !== "ETIMEDOUT" || attempt === attempts) break;
    process.stderr.write(`Timed out after ${timeoutMs / 1000} seconds: ${file}; retrying in a fresh process\n`);
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
