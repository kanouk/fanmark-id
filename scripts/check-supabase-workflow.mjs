#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const workflowPath = process.argv[2] ?? ".github/workflows/supabase-deploy.yml";
const workflow = await readFile(workflowPath, "utf8");
const cloudflareWorkflowPath = ".github/workflows/cloudflare-migration-validation.yml";
const cloudflareWorkflow = await readFile(cloudflareWorkflowPath, "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(`${workflowPath}: ${message}`);
  }
}

const jobsMarker = "\njobs:\n";
const jobsIndex = workflow.indexOf(jobsMarker);
assert(jobsIndex !== -1, "expected a jobs section");

const header = workflow.slice(0, jobsIndex);
assert(/^  pull_request:\s*$/m.test(header), "expected pull_request trigger");
assert(!/^env:\s*$/m.test(header), "production secrets must not be workflow-scoped");
assert(!/secrets\./.test(header), "production secrets must not appear before jobs");

const jobMatches = [...workflow.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].filter(
  ({ index }) => index > jobsIndex,
);
assert(jobMatches.length > 0, "expected jobs under the jobs section");

const jobBlocks = new Map(
  jobMatches.map((match, index) => {
    const start = match.index;
    const end = jobMatches[index + 1]?.index ?? workflow.length;
    return [match[1], workflow.slice(start, end)];
  }),
);
assert(jobBlocks.has("validate"), "expected legacy validate job");
assert(!jobBlocks.has("deploy"), "legacy production deployment must remain retired");
assert(/^permissions:\s*\n^  contents:\s*read\s*$/m.test(header), "legacy validation must be read-only");

const validate = jobBlocks.get("validate");
const migrationValidation = jobBlocks.get("migration-validation");
assert(migrationValidation, "expected secret-free local migration validation");
for (const directory of ["workers/api", "experiments/cloudflare-auth", "experiments/cloudflare-d1-concurrency", "experiments/stripe-receipts"]) {
  assert(migrationValidation.includes(`- ${directory}`), `migration tests must cover ${directory}`);
}
assert(/run: npm ci\s*$/m.test(migrationValidation), "migration tests must install locked dependencies");
assert(/run: npm test\s*$/m.test(migrationValidation), "migration tests must execute");

for (const [jobName, job] of jobBlocks) {
  assert(!/secrets\./.test(job), `${jobName} must not reference secrets`);
  assert(!/supabase\s+(link|db push|gen types)\b/.test(job), `${jobName} must not access Supabase`);
  assert(!/\bgit\s+push\b/.test(job), `${jobName} must not push commits`);
  assert(!/--remote\b|\bwrangler\s+deploy\b|contents:\s*write/.test(job), `${jobName} must not deploy or grant write permissions`);
}

assert(/npm run check:ci/.test(validate), "PR validation must check workflow isolation");
assert(/npm ci --legacy-peer-deps/.test(validate), "PR validation must install the locked dependencies");
assert(/npm run typecheck/.test(validate), "PR validation must run the application type check");
assert(/run: npm run build:legacy\s*$/m.test(validate), "legacy validation must explicitly use the legacy build");
assert(validate.includes("npm ci --prefix workers/api"), "Static Assets validation must install locked dependencies");
for (const command of ["npm run --prefix workers/api test:static-assets", "npm run --prefix workers/api build:static-assets:dry-run"]) {
  assert(validate.indexOf(command) > validate.indexOf("run: npm run build:legacy"), "Static Assets checks must follow the fresh application build");
}
assert(!/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|PROJECT_ID)/.test(validate), "PR validation must not reference Supabase credentials");

assert(/^  pull_request:\s*$/m.test(cloudflareWorkflow), "Cloudflare migration validation must run on pull requests");
assert(/^  push:\s*$/m.test(cloudflareWorkflow), "Cloudflare migration validation must run on main pushes");
assert(/^  workflow_dispatch:\s*$/m.test(cloudflareWorkflow), "Cloudflare migration validation must support an explicit manual run");
assert(/^permissions:\s*\n^  contents:\s*read\s*$/m.test(cloudflareWorkflow), "Cloudflare migration validation must be read-only");
// This exact local harness creates its own loopback containers and credentials;
// it never accepts a project URL or an existing credential. Keep the broad ban
// on CLI/project access, allowing only the complete fixed test command line.
const localAuthProofLine = '        run: node --experimental-strip-types scripts/migration/test-legacy-profile-supabase-local.mjs "$RUNNER_TEMP/legacy-profile-supabase-local.json"\n';
assert(cloudflareWorkflow.split(localAuthProofLine).length === 2, "Cloudflare validation must run exactly one fixed local Auth integration proof");
// A pinned public test image is not a project CLI command. Accept only this
// complete pull line; extra arguments/commands and different images still fail.
const localStorageImageLine = '          docker pull supabase/storage-api:v1.80.2@sha256:95b217a9c59e0ac06c6dcb539df3189a1668a2445fb43dbf29660d6968ffd7d2\n';
assert(cloudflareWorkflow.split(localStorageImageLine).length === 2, "Cloudflare validation must pull exactly one pinned local Storage test image");
const cloudflareExternalActions = cloudflareWorkflow.replace(localAuthProofLine, "").replace(localStorageImageLine, "");
assert(!/secrets\.|\bsupabase\b|\bwrangler\s+deploy\b|--remote\b|\bgit\s+push\b/i.test(cloudflareExternalActions), "Cloudflare migration validation must not access secrets or deploy/write remotely");
assert(/run: npm run test:migration-data\s*$/m.test(cloudflareWorkflow), "Cloudflare validation must test migration data boundaries");
assert(/run: npm run check:cloudflare-schedules\s*$/m.test(cloudflareWorkflow), "Cloudflare validation must check configured scheduled job coverage");
assert(/run: npm run build:cloudflare-staging\s*$/m.test(cloudflareWorkflow), "Cloudflare validation must build the staging application");
assert(/run: npm test\s*$/m.test(cloudflareWorkflow), "Cloudflare validation must run the complete Worker test chain");
assert(/run: npm run build:dry-run\s*$/m.test(cloudflareWorkflow), "Cloudflare validation must validate the Worker bundle without deployment");

console.log("Retired legacy deployment and Cloudflare validation workflow isolation checks passed");
