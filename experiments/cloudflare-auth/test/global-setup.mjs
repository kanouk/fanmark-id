import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export default function buildAuthFixtureWorker() {
  const projectRoot = resolve(new URL("..", import.meta.url).pathname);
  execFileSync(
    process.execPath,
    [
      resolve(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
      "deploy",
      "--dry-run",
      "--outdir",
      ".wrangler/auth-fixture",
      "--config",
      "wrangler.fixture.jsonc",
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );
}
