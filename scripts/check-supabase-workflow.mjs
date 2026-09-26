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
assert(jobBlocks.has("validate") && jobBlocks.has("deploy"), "expected validate and deploy jobs");

const validate = jobBlocks.get("validate");
const deploy = jobBlocks.get("deploy");
const migrationValidation = jobBlocks.get("migration-validation");
assert(migrationValidation, "expected secret-free local migration validation");
for (const directory of ["workers/api", "experiments/cloudflare-auth", "experiments/cloudflare-d1-concurrency", "experiments/stripe-receipts"]) {
  assert(migrationValidation.includes(`- ${directory}`), `migration tests must cover ${directory}`);
}
assert(/run: npm ci\s*$/m.test(migrationValidation), "migration tests must install locked dependencies");
assert(/run: npm test\s*$/m.test(migrationValidation), "migration tests must execute");
assert(/^    needs: \[validate, migration-validation\]\s*$/m.test(deploy), "deployment must wait for application and migration validation");


for (const [jobName, job] of jobBlocks) {
  if (jobName === "deploy") {
    continue;
  }
  assert(!/secrets\./.test(job), `${jobName} must not reference secrets`);
  assert(!/supabase\s+(link|db push|gen types)\b/.test(job), `${jobName} must not access Supabase`);
  assert(!/\bgit\s+push\b/.test(job), `${jobName} must not push commits`);
}

assert(/npm run check:ci/.test(validate), "PR validation must check workflow isolation");
assert(/npm ci --legacy-peer-deps/.test(validate), "PR validation must install the locked dependencies");
assert(/npm run typecheck/.test(validate), "PR validation must run the application type check");
assert(/npm run build/.test(validate), "PR validation must run the production build");
assert(validate.includes("npm ci --prefix workers/api"), "Static Assets validation must install locked dependencies");
for (const command of ["npm run --prefix workers/api test:static-assets", "npm run --prefix workers/api build:static-assets:dry-run"]) {
  assert(validate.indexOf(command) > validate.indexOf("run: npm run build"), "Static Assets checks must follow the fresh application build");
}
assert(!/SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|PROJECT_ID)/.test(validate), "PR validation must not reference Supabase credentials");

assert(/^    if:\s*github\.event_name\s*==\s*'push'\s*&&\s*github\.ref\s*==\s*'refs\/heads\/main'\s*$/m.test(deploy), "deployment must be limited to push on main");
assert(/^    concurrency:\s*\n^      group:\s+supabase-production\s*\n^      cancel-in-progress:\s+false\s*$/m.test(deploy), "production deployments must be serialized without cancellation");
assert(/^    environment:\s*\n^      name:\s+Supabase\s*$/m.test(deploy), "deployment must use the Supabase environment");
assert(/^    permissions:\s*\n^      contents:\s+write\s*$/m.test(deploy), "deployment must be allowed to commit generated types");
const deployEnv = deploy.match(/^    env:\s*\n((?:^      .*\n?)*)/m)?.[1] ?? "";
assert(deployEnv.includes("SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}"), "access token must be deploy-job scoped");
assert(deployEnv.includes("SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}"), "database password must be deploy-job scoped");
assert(deployEnv.includes("SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}"), "project ref must be deploy-job scoped");
assert(/supabase link\b/.test(deploy), "deployment must link the Supabase project");
assert(/supabase db push\b/.test(deploy), "deployment must apply migrations");
assert(/supabase gen types\b/.test(deploy), "deployment must generate types");
assert(/\bgit\s+push\b/.test(deploy), "deployment must retain the generated-types commit push");

assert(/^  pull_request:\s*$/m.test(cloudflareWorkflow), "Cloudflare migration validation must run on pull requests");
assert(/^  push:\s*$/m.test(cloudflareWorkflow), "Cloudflare migration validation must run on main pushes");
assert(/^  workflow_dispatch:\s*$/m.test(cloudflareWorkflow), "Cloudflare migration validation must support an explicit manual run");
assert(/^permissions:\s*\n^  contents:\s*read\s*$/m.test(cloudflareWorkflow), "Cloudflare migration validation must be read-only");
assert(!/secrets\.|\bsupabase\b|\bwrangler\s+deploy\b|--remote\b|\bgit\s+push\b/i.test(cloudflareWorkflow), "Cloudflare migration validation must not access secrets or deploy/write remotely");
assert(/run: npm run test:migration-data\s*$/m.test(cloudflareWorkflow), "Cloudflare validation must test migration data boundaries");
assert(/run: npm run build:cloudflare-staging\s*$/m.test(cloudflareWorkflow), "Cloudflare validation must build the staging application");
assert(/run: npm test\s*$/m.test(cloudflareWorkflow), "Cloudflare validation must run the complete Worker test chain");
assert(/run: npm run build:dry-run\s*$/m.test(cloudflareWorkflow), "Cloudflare validation must validate the Worker bundle without deployment");

console.log("Supabase deployment and Cloudflare validation workflow isolation checks passed");
