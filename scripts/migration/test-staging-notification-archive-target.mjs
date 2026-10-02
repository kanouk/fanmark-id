import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isStagingNotificationArchiveTarget } from "./staging-notification-archive-target.mjs";

const config = JSON.parse(await readFile(new URL("../../workers/api/wrangler.app-staging.jsonc", import.meta.url), "utf8"));
const identity = {
  loggedIn: true,
  email: "fanmark.id@gmail.com",
  accounts: [{ id: "bfc2890741f0b3fb236e2d755b6c9adc" }],
};

test("accepts only the intended workers.dev staging Worker and split D1 bindings", () => {
  assert.equal(isStagingNotificationArchiveTarget(config, identity), true);
});

test("rejects a live route, altered schedule, or deployed archive selector", () => {
  assert.equal(isStagingNotificationArchiveTarget({ ...config, routes: ["fanmark.id/*"] }, identity), false);
  assert.equal(isStagingNotificationArchiveTarget({
    ...config,
    triggers: { crons: ["* * * * *", "0 1 * * *"] },
  }, identity), false);
  assert.equal(isStagingNotificationArchiveTarget({
    ...config,
    vars: { ...config.vars, NOTIFICATION_ARCHIVE_BACKEND: "d1" },
  }, identity), false);
});

test("rejects changed D1 bindings and an unexpected Cloudflare identity", () => {
  const [business, ...others] = config.d1_databases;
  assert.equal(isStagingNotificationArchiveTarget({
    ...config,
    d1_databases: [{ ...business, database_id: "00000000-0000-0000-0000-000000000000" }, ...others],
  }, identity), false);
  assert.equal(isStagingNotificationArchiveTarget(config, { ...identity, loggedIn: false }), false);
  assert.equal(isStagingNotificationArchiveTarget(config, { ...identity, email: "other@example.com" }), false);
  assert.equal(isStagingNotificationArchiveTarget(config, { ...identity, accounts: [] }), false);
});

test("rejects malformed binding and Cron configuration", () => {
  assert.equal(isStagingNotificationArchiveTarget({
    ...config,
    d1_databases: null,
  }, identity), false);
  assert.equal(isStagingNotificationArchiveTarget({
    ...config,
    triggers: { crons: "* * * * *" },
  }, identity), false);
});
