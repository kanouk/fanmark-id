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
const testFiles = readdirSync(new URL("./test/", import.meta.url))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();

for (const file of testFiles) {
  const args = ["--test", "--test-concurrency=1", `test/${file}`];
  if (typeScriptImports.has(file)) args.unshift("--import", "tsx");

  process.stdout.write(`\n=== ${file} ===\n`);
  const result = spawnSync(process.execPath, args, {
    cwd: packageDirectory,
    stdio: "inherit",
    timeout: 180_000,
  });

  if (result.error?.code === "ETIMEDOUT") {
    process.stderr.write(`Timed out after 180 seconds: ${file}\n`);
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
