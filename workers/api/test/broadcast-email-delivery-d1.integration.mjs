#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const migrationPaths = [
  "workers/api/migrations-business/0000_business_schema_v4_staging.sql",
  "workers/api/migrations-business/0016_broadcast_email_delivery.sql",
];
const { handleBroadcastEmailAdminRequest } = await import(pathToFileURL(
  path.join(repoRoot, "workers/api/src/broadcast-email-admin-d1-api.ts"),
).href);
const { snapshotBroadcastEmailDeliveryPage } = await import(pathToFileURL(
  path.join(repoRoot, "workers/api/src/broadcast-email-delivery-d1.ts"),
).href);
const { dispatchBroadcastEmailDeliveryBatch } = await import(pathToFileURL(
  path.join(repoRoot, "workers/api/src/broadcast-email-delivery-d1.ts"),
).href);
const { handleBroadcastEmailWebhookRequest, BROADCAST_EMAIL_WEBHOOK_PATH } = await import(pathToFileURL(
  path.join(repoRoot, "workers/api/src/broadcast-email-webhook-d1.ts"),
).href);

function splitSql(sql) {
  const source = sql.replace(/^--.*(?:\r?\n|$)/gmu, "");
  const statements = [];
  let start = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "'" && !doubleQuoted) {
      if (singleQuoted && next === "'") index += 1;
      else singleQuoted = !singleQuoted;
      continue;
    }
    if (character === '"' && !singleQuoted) {
      if (doubleQuoted && next === '"') index += 1;
      else doubleQuoted = !doubleQuoted;
      continue;
    }
    if (character !== ";" || singleQuoted || doubleQuoted) continue;
    const candidate = source.slice(start, index).trim();
    const isTrigger = /^create\s+trigger\b/iu.test(candidate);
    if (isTrigger) {
      const cases = candidate.match(/\bCASE\b/giu)?.length ?? 0;
      const ends = candidate.match(/\bEND\b/giu)?.length ?? 0;
      if (ends < cases + 1) continue;
    }
    if (candidate) statements.push(candidate);
    start = index + 1;
  }
  const remainder = source.slice(start).trim();
  if (remainder) statements.push(remainder);
  return statements;
}

async function createFixture() {
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-broadcast-email-delivery-d1-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: {
          BUSINESS_DB: { type: "d1", name: "fanmark-broadcast-email-business-test" },
          AUTH_DB: { type: "d1", name: "fanmark-broadcast-email-auth-test" },
        },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const database = await miniflare.getD1Database("BUSINESS_DB");
  const authDatabase = await miniflare.getD1Database("AUTH_DB");
  try {
    for (const migration of migrationPaths) {
      const sql = await fs.readFile(path.join(repoRoot, migration), "utf8");
      for (const statement of splitSql(sql)) {
        const result = await database.prepare(statement).run();
        assert.equal(result.success, true, `${migration}: ${statement.slice(0, 120)}`);
      }
    }
    return { miniflare, database, authDatabase };
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
}

const RUN = "00000000-0000-4000-8000-000000000001";
const SECOND_RUN = "00000000-0000-4000-8000-000000000002";
const BROADCAST = "00000000-0000-4000-8000-000000000003";
const USER_A = "00000000-0000-4000-8000-000000000004";
const USER_B = "00000000-0000-4000-8000-000000000005";
const USER_C = "00000000-0000-4000-8000-000000000006";
const NOW = "2026-09-27T12:00:00.000000Z";
const ADMIN = "00000000-0000-4000-8000-000000000008";

test("applies durable delivery schema without persisting addresses and propagates only permanent suppressions", async () => {
  const fixture = await createFixture();
  const { database } = fixture;
  try {
    const deliveryColumns = await database.prepare("PRAGMA table_info(broadcast_delivery_recipients)").all();
    assert.equal(deliveryColumns.success, true);
    const columnNames = deliveryColumns.results.map((column) => column.name);
    assert.deepEqual(columnNames.filter((name) => /^(?:email|email_address|recipient_email|address)$/iu.test(name)), []);

    await database.prepare(`
      INSERT INTO broadcast_emails (id, subject, body_text, email_type, status, created_at, updated_at)
      VALUES (?, 'Synthetic subject', 'Synthetic body', 'broadcast_announcement', 'scheduled', ?, ?),
        ('synthetic-second-broadcast', 'Synthetic subject', 'Synthetic body', 'broadcast_announcement', 'scheduled', ?, ?)
    `).bind(BROADCAST, NOW, NOW, NOW, NOW).run();
    await database.batch([
      database.prepare(`INSERT INTO broadcast_delivery_runs
        (id, broadcast_id, request_id, requested_by, status, created_at)
        VALUES (?, ?, ?, 'synthetic-admin', 'sending', ?)`)
        .bind(RUN, BROADCAST, "00000000-0000-4000-8000-000000000006", NOW),
      database.prepare(`INSERT INTO broadcast_delivery_recipients
        (run_id, user_id, language, status, next_attempt_at, provider_email_id, created_at, updated_at)
        VALUES (?, ?, 'ja', 'sent', ?, 'resend-a', ?, ?)`)
        .bind(RUN, USER_A, NOW, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_delivery_recipients
        (run_id, user_id, language, status, next_attempt_at, provider_email_id, created_at, updated_at)
        VALUES (?, ?, 'en', 'sent', ?, 'resend-b', ?, ?)`)
        .bind(RUN, USER_B, NOW, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_delivery_recipients
        (run_id, user_id, language, status, next_attempt_at, lease_token, lease_expires_at, created_at, updated_at)
        VALUES (?, ?, 'ja', 'sending', ?, 'lease-c', '2026-09-27T12:05:00.000000Z', ?, ?)`)
        .bind(RUN, USER_C, NOW, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_delivery_runs
        (id, broadcast_id, request_id, requested_by, status, created_at)
        VALUES (?, 'synthetic-second-broadcast', ?, 'synthetic-admin', 'sending', ?)`)
        .bind(SECOND_RUN, "00000000-0000-4000-8000-000000000007", NOW),
    ]);

    await database.prepare(`INSERT INTO broadcast_delivery_recipients
      (run_id, user_id, language, status, next_attempt_at, lease_token, lease_expires_at, created_at, updated_at)
      VALUES (?, ?, 'ja', 'sending', ?, 'future-lease', '2026-09-27T12:05:00.000000Z', ?, ?)`)
      .bind(SECOND_RUN, USER_A, NOW, NOW, NOW).run();

    await database.prepare(`INSERT INTO broadcast_delivery_webhook_events
      (id, provider_email_id, event_type, bounce_type, created_at)
      VALUES ('event-permanent', 'resend-a', 'email.bounced', 'Permanent', ?)`)
      .bind(NOW).run();

    assert.deepEqual(await database.prepare(`SELECT status FROM broadcast_delivery_recipients WHERE run_id = ? AND user_id = ?`)
      .bind(RUN, USER_A).first(), { status: "bounced" });
    assert.deepEqual(await database.prepare(`SELECT status, last_error_code, lease_token FROM broadcast_delivery_recipients WHERE run_id = ? AND user_id = ?`)
      .bind(SECOND_RUN, USER_A).first(), { status: "suppressed", last_error_code: "recipient_suppressed", lease_token: null });
    assert.deepEqual(await database.prepare(`SELECT reason, source_event_id FROM broadcast_delivery_suppressions WHERE user_id = ?`)
      .bind(USER_A).first(), { reason: "permanent_bounce", source_event_id: "event-permanent" });

    await database.prepare(`INSERT INTO broadcast_delivery_webhook_events
      (id, provider_email_id, event_type, bounce_type, created_at)
      VALUES ('event-transient', 'resend-b', 'email.bounced', 'Transient', ?)`)
      .bind(NOW).run();
    assert.equal((await database.prepare(`SELECT status FROM broadcast_delivery_recipients WHERE run_id = ? AND user_id = ?`)
      .bind(RUN, USER_B).first()).status, "bounced");
    assert.equal((await database.prepare(`SELECT COUNT(*) AS count FROM broadcast_delivery_suppressions WHERE user_id = ?`)
      .bind(USER_B).first()).count, 0);

    await database.prepare(`INSERT INTO broadcast_delivery_webhook_events
      (id, provider_email_id, event_type, created_at)
      VALUES ('event-complaint', 'resend-b', 'email.complained', ?)`)
      .bind(NOW).run();
    assert.deepEqual(await database.prepare(`SELECT reason FROM broadcast_delivery_suppressions WHERE user_id = ?`)
      .bind(USER_B).first(), { reason: "complaint" });

    await database.prepare(`INSERT INTO broadcast_delivery_webhook_events
      (id, provider_email_id, event_type, created_at)
      VALUES ('event-before-ack', 'resend-c', 'email.delivered', ?)`)
      .bind(NOW).run();
    await database.prepare(`UPDATE broadcast_delivery_recipients SET provider_email_id = 'resend-c'
      WHERE run_id = ? AND user_id = ?`).bind(RUN, USER_C).run();
    assert.deepEqual(await database.prepare(`SELECT status, lease_token FROM broadcast_delivery_recipients
      WHERE run_id = ? AND user_id = ?`).bind(RUN, USER_C).first(), { status: "delivered", lease_token: null });

    await assert.rejects(
      database.prepare(`INSERT INTO broadcast_delivery_webhook_events
        (id, provider_email_id, event_type, created_at)
        VALUES ('event-complaint', 'resend-b', 'email.complained', ?)`)
        .bind(NOW).run(),
      /UNIQUE constraint failed/iu,
    );
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("queues an admin send idempotently, freezes its filter/templates, and fails closed without selectors", async () => {
  const fixture = await createFixture();
  const { database, authDatabase } = fixture;
  const broadcastId = "00000000-0000-4000-8000-000000000009";
  const secondBroadcastId = "00000000-0000-4000-8000-000000000010";
  const requestId = "00000000-0000-4000-8000-000000000011";
  const origin = "https://app.example.test";
  const env = {
    AUTH_BACKEND: "better-auth",
    BROADCAST_EMAIL_BACKEND: "d1",
    BROADCAST_SEND_BACKEND: "d1",
    BROADCAST_WEBHOOK_SIGNING_SECRET: "whsec_c3ludGhldGljLXdlYmhvb2stc2VjcmV0",
    BETTER_AUTH_SECRET: "synthetic-better-auth-secret-with-enough-bytes-123456",
    CORS_ALLOWED_ORIGINS: origin,
    D1_TOPOLOGY: "split",
    FANMARK_DB: database,
    AUTH_DB: authDatabase,
    RESEND_API_KEY: "re_synthetic-key",
    RESEND_FROM_EMAIL: "Fanmark <test@example.test>",
  };
  let providerCalls = 0;
  const authorizeAdmin = async () => ({ userId: ADMIN, sessionId: "synthetic-session" });
  const sendTestEmail = async () => {
    providerCalls += 1;
    return "synthetic-provider-id";
  };
  const request = (id, commandId) => new Request("https://app.example.test/api/admin/broadcast-emails/send", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: origin },
    body: JSON.stringify({ broadcastId: id, requestId: commandId }),
  });

  try {
    await database.prepare(`INSERT INTO user_settings
      (id, user_id, username, plan_type, preferred_language, created_at, updated_at)
      VALUES ('synthetic-admin-settings', ?, 'synthetic-admin', 'admin', 'ja', ?, ?)`)
      .bind(ADMIN, NOW, NOW).run();
    await database.batch([
      database.prepare(`INSERT INTO broadcast_emails
        (id, subject, body_text, email_type, recipient_filter, status, created_by, created_at, updated_at)
        VALUES (?, 'Frozen subject', 'Frozen body', 'broadcast_announcement', '{"plan_types":["free"]}', 'draft', ?, ?, ?)`)
        .bind(broadcastId, ADMIN, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_emails
        (id, subject, body_text, email_type, recipient_filter, status, created_by, created_at, updated_at)
        VALUES (?, 'Second subject', 'Second body', 'broadcast_announcement', '{}', 'draft', ?, ?, ?)`)
        .bind(secondBroadcastId, ADMIN, NOW, NOW),
      database.prepare(`INSERT INTO email_templates
        (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
        VALUES ('synthetic-ja-template', 'broadcast_announcement', 'ja', 'JA subject', 'JA body', 'Open', 1, ?, ?)`)
        .bind(NOW, NOW),
      database.prepare(`INSERT INTO email_templates
        (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
        VALUES ('synthetic-en-template', 'broadcast_announcement', 'en', 'EN subject', 'EN body', 'Open', 1, ?, ?)`)
        .bind(NOW, NOW),
    ]);

    const concurrentStarts = await Promise.all([
      handleBroadcastEmailAdminRequest(request(broadcastId, requestId), env, authorizeAdmin, () => new Date(NOW), sendTestEmail),
      handleBroadcastEmailAdminRequest(request(broadcastId, requestId), env, authorizeAdmin, () => new Date(NOW), sendTestEmail),
    ]);
    assert.deepEqual(concurrentStarts.map((response) => response?.status).sort(), [200, 202]);
    const first = concurrentStarts.find((response) => response?.status === 202);
    assert.ok(first);
    const firstBody = await first.json();
    const concurrentReplay = concurrentStarts.find((response) => response?.status === 200);
    assert.ok(concurrentReplay);
    assert.equal((await concurrentReplay.json()).runId, firstBody.runId);
    assert.deepEqual(firstBody, {
      accepted: true,
      runId: firstBody.runId,
      status: "snapshotting",
      recipientCount: 0,
      sentCount: 0,
      failedCount: 0,
    });
    assert.deepEqual(Object.keys(firstBody).sort(), ["accepted", "failedCount", "recipientCount", "runId", "sentCount", "status"]);
    assert.equal(providerCalls, 0);

    const persisted = await database.prepare(`SELECT broadcast_id, request_id, requested_by, status,
        recipient_filter, template_snapshot FROM broadcast_delivery_runs WHERE id = ?`)
      .bind(firstBody.runId).first();
    assert.equal(persisted.broadcast_id, broadcastId);
    assert.equal(persisted.request_id, requestId);
    assert.equal(persisted.requested_by, ADMIN);
    assert.equal(persisted.status, "snapshotting");
    assert.equal(JSON.parse(persisted.recipient_filter).plan_types[0], "free");
    const frozenSnapshot = JSON.parse(persisted.template_snapshot);
    assert.equal(frozenSnapshot.broadcast.subject, "Frozen subject");
    assert.equal(frozenSnapshot.templatesByLanguage.en.id, "synthetic-en-template");
    assert.equal(frozenSnapshot.templatesByLanguage.ko.id, "synthetic-ja-template");
    assert.equal((await database.prepare("SELECT status FROM broadcast_emails WHERE id = ?").bind(broadcastId).first()).status, "scheduled");

    await database.prepare("UPDATE email_templates SET subject = 'Edited after start' WHERE id = 'synthetic-ja-template'").run();
    const replay = await handleBroadcastEmailAdminRequest(request(broadcastId, requestId), env, authorizeAdmin, () => new Date(NOW));
    assert.equal(replay?.status, 200);
    assert.equal((await replay.json()).runId, firstBody.runId);
    assert.equal(JSON.parse((await database.prepare("SELECT template_snapshot FROM broadcast_delivery_runs WHERE id = ?")
      .bind(firstBody.runId).first()).template_snapshot).templatesByLanguage.ja.subject, "JA subject");

    const conflicting = await handleBroadcastEmailAdminRequest(request(secondBroadcastId, requestId), env, authorizeAdmin, () => new Date(NOW));
    assert.equal(conflicting?.status, 409);
    assert.deepEqual(await conflicting.json(), { error: "idempotency_conflict" });
    const differentKey = await handleBroadcastEmailAdminRequest(request(broadcastId, "00000000-0000-4000-8000-000000000012"), env, authorizeAdmin, () => new Date(NOW));
    assert.equal(differentKey?.status, 409);

    const closed = await handleBroadcastEmailAdminRequest(request(secondBroadcastId, "00000000-0000-4000-8000-000000000013"),
      { ...env, BROADCAST_SEND_BACKEND: "" }, authorizeAdmin, () => new Date(NOW));
    assert.equal(closed?.status, 503);
    assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM broadcast_delivery_runs WHERE broadcast_id = ?")
      .bind(secondBroadcastId).first()).count, 0);
    assert.equal(providerCalls, 0);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("snapshots Auth IDs in bounded pages, applies source filters, and never copies addresses", async () => {
  const fixture = await createFixture();
  const { database, authDatabase } = fixture;
  const unfilteredBroadcast = "00000000-0000-4000-8000-000000000021";
  const filteredBroadcast = "00000000-0000-4000-8000-000000000022";
  const adminId = "00000000-0000-4000-8000-000000000023";
  const authUsers = [
    ["00000000-0000-4000-8000-000000000031", "synthetic-a@example.test", "2026-09-26T10:00:00.000000Z"],
    ["00000000-0000-4000-8000-000000000032", "synthetic-b@example.test", "2026-09-26T10:00:00.000000Z"],
    ["00000000-0000-4000-8000-000000000033", "synthetic-no-settings@example.test", "2026-09-26T10:00:00.000000Z"],
    ["00000000-0000-4000-8000-000000000034", "synthetic-future@example.test", "2026-09-28T10:00:00.000000Z"],
    ["00000000-0000-4000-8000-000000000035", "", "2026-09-26T10:00:00.000000Z"],
  ];
  const origin = "https://app.example.test";
  const env = {
    AUTH_BACKEND: "better-auth",
    BETTER_AUTH_SECRET: "synthetic-better-auth-secret-with-enough-bytes-123456",
    BROADCAST_EMAIL_BACKEND: "d1",
    BROADCAST_SEND_BACKEND: "d1",
    BROADCAST_WEBHOOK_SIGNING_SECRET: "whsec_c3ludGhldGljLXdlYmhvb2stc2VjcmV0",
    CORS_ALLOWED_ORIGINS: origin,
    D1_TOPOLOGY: "split",
    FANMARK_DB: database,
    AUTH_DB: authDatabase,
    RESEND_API_KEY: "re_synthetic-key",
    RESEND_FROM_EMAIL: "Fanmark <test@example.test>",
  };
  const authorizeAdmin = async () => ({ userId: adminId, sessionId: "synthetic-session" });
  const start = async (broadcastId, requestId) => handleBroadcastEmailAdminRequest(
    new Request("https://app.example.test/api/admin/broadcast-emails/send", {
      method: "POST",
      headers: { "content-type": "application/json", Origin: origin },
      body: JSON.stringify({ broadcastId, requestId }),
    }), env, authorizeAdmin, () => new Date(NOW),
  );
  try {
    await authDatabase.prepare(`CREATE TABLE "user" (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, emailVerified INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )`).run();
    const idsToInsert = authUsers.map(([id, email, createdAt]) => authDatabase.prepare(`INSERT INTO "user"
      (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Synthetic user', ?, 1, ?, ?)`)
      .bind(id, email, createdAt, createdAt));
    await authDatabase.batch(idsToInsert);
    await database.prepare(`INSERT INTO user_settings
      (id, user_id, username, plan_type, preferred_language, created_at, updated_at)
      VALUES
      ('settings-a', '00000000-0000-4000-8000-000000000031', 'user-a', 'free', 'en', '2026-09-27T10:00:00.000000Z', ?),
      ('settings-b', '00000000-0000-4000-8000-000000000032', 'user-b', 'creator', 'ko', '2026-09-27T10:00:00.000000Z', ?),
      ('settings-future', '00000000-0000-4000-8000-000000000034', 'user-future', 'free', 'ja', '2026-09-28T10:00:00.000000Z', ?)`)
      .bind(NOW, NOW, NOW).run();
    await database.prepare(`INSERT INTO user_settings
      (id, user_id, username, plan_type, preferred_language, created_at, updated_at)
      VALUES ('synthetic-admin-profile', ?, 'snapshot-admin', 'admin', 'ja', ?, ?)`)
      .bind(adminId, NOW, NOW).run();
    await database.prepare(`INSERT INTO broadcast_delivery_suppressions
      (user_id, reason, source_event_id, created_at) VALUES (?, 'complaint', 'previous-complaint', ?)`)
      .bind(authUsers[1][0], NOW).run();
    await database.batch([
      database.prepare(`INSERT INTO broadcast_emails
        (id, subject, body_text, email_type, recipient_filter, status, created_by, created_at, updated_at)
        VALUES (?, 'All users', 'Notice', 'broadcast_announcement', '{}', 'draft', ?, ?, ?)`)
        .bind(unfilteredBroadcast, adminId, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_emails
        (id, subject, body_text, email_type, recipient_filter, status, created_by, created_at, updated_at)
        VALUES (?, 'Filtered users', 'Notice', 'broadcast_announcement',
          '{"plan_types":["free"],"registered_after":"2026-09-27","registered_before":"2026-09-28"}',
          'draft', ?, ?, ?)`)
        .bind(filteredBroadcast, adminId, NOW, NOW),
      database.prepare(`INSERT INTO email_templates
        (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
        VALUES ('snapshot-ja', 'broadcast_announcement', 'ja', 'JA', 'Body', 'Open', 1, ?, ?)`)
        .bind(NOW, NOW),
    ]);

    const allStart = await start(unfilteredBroadcast, "00000000-0000-4000-8000-000000000041");
    assert.equal(allStart?.status, 202);
    const allStartBody = await allStart.json();
    const filteredStart = await start(filteredBroadcast, "00000000-0000-4000-8000-000000000042");
    assert.equal(filteredStart?.status, 202);
    const filteredStartBody = await filteredStart.json();
    const snapshotResults = [];
    for (let index = 0; index < 4; index += 1) {
      snapshotResults.push(await snapshotBroadcastEmailDeliveryPage(env, () => new Date(NOW), () => `lease-${index}`));
    }
    assert.deepEqual(snapshotResults.filter((result) => result.status === "page_committed")
      .map((result) => [result.runId, result.recipientCount]).sort(([left], [right]) => left.localeCompare(right)),
    [[allStartBody.runId, 2], [filteredStartBody.runId, 1]].sort(([left], [right]) => left.localeCompare(right)));
    assert.deepEqual(snapshotResults.filter((result) => result.status === "sending")
      .map((result) => result.runId).sort(), [allStartBody.runId, filteredStartBody.runId].sort());
    const recipients = await database.prepare(`SELECT user_id, language FROM broadcast_delivery_recipients
      WHERE run_id = ? ORDER BY user_id`).bind(allStartBody.runId).all();
    assert.deepEqual(recipients.results, [
      { user_id: authUsers[0][0], language: "en" },
      { user_id: authUsers[2][0], language: "ja" },
    ]);
    assert.equal((await database.prepare("SELECT total_recipients FROM broadcast_emails WHERE id = ?")
      .bind(unfilteredBroadcast).first()).total_recipients, 2);

    const filteredRecipients = await database.prepare(`SELECT user_id, language FROM broadcast_delivery_recipients WHERE run_id = ?`)
      .bind(filteredStartBody.runId).all();
    assert.deepEqual(filteredRecipients.results, [{ user_id: authUsers[0][0], language: "en" }]);
    assert.equal((await database.prepare("SELECT status FROM broadcast_delivery_runs WHERE id = ?")
      .bind(filteredStartBody.runId).first()).status, "sending");
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("resumes from the committed cursor after a snapshot page acknowledgement is lost", async () => {
  const fixture = await createFixture();
  const { database, authDatabase } = fixture;
  const broadcastId = "00000000-0000-4000-8000-000000000081";
  const adminId = "00000000-0000-4000-8000-000000000082";
  const origin = "https://app.example.test";
  const env = {
    AUTH_BACKEND: "better-auth",
    BETTER_AUTH_SECRET: "synthetic-better-auth-secret-with-enough-bytes-123456",
    BROADCAST_EMAIL_BACKEND: "d1",
    BROADCAST_SEND_BACKEND: "d1",
    BROADCAST_WEBHOOK_SIGNING_SECRET: "whsec_c3ludGhldGljLXdlYmhvb2stc2VjcmV0",
    CORS_ALLOWED_ORIGINS: origin,
    D1_TOPOLOGY: "split",
    FANMARK_DB: database,
    AUTH_DB: authDatabase,
    RESEND_API_KEY: "re_synthetic-key",
    RESEND_FROM_EMAIL: "Fanmark <test@example.test>",
  };
  const request = new Request("https://app.example.test/api/admin/broadcast-emails/send", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: origin },
    body: JSON.stringify({ broadcastId, requestId: "00000000-0000-4000-8000-000000000083" }),
  });
  try {
    await authDatabase.prepare(`CREATE TABLE "user" (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, emailVerified INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )`).run();
    await authDatabase.batch(Array.from({ length: 51 }, (_, index) => {
      const userId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      return authDatabase.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
        VALUES (?, 'Synthetic recipient', ?, 1, ?, ?)`).bind(userId, `snapshot-${index + 1}@example.test`, NOW, NOW);
    }));
    await database.batch([
      database.prepare(`INSERT INTO user_settings
        (id, user_id, username, plan_type, preferred_language, created_at, updated_at)
        VALUES ('snapshot-crash-admin', ?, 'snapshot-crash-admin', 'admin', 'ja', ?, ?)`).bind(adminId, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_emails
        (id, subject, body_text, email_type, recipient_filter, status, created_by, created_at, updated_at)
        VALUES (?, 'Crash subject', 'Crash body', 'broadcast_announcement', '{}', 'draft', ?, ?, ?)`).bind(broadcastId, adminId, NOW, NOW),
      database.prepare(`INSERT INTO email_templates
        (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
        VALUES ('snapshot-crash-ja', 'broadcast_announcement', 'ja', 'JA', 'Body', 'Open', 1, ?, ?)`).bind(NOW, NOW),
    ]);
    const started = await handleBroadcastEmailAdminRequest(request, env,
      async () => ({ userId: adminId, sessionId: "synthetic-session" }), () => new Date(NOW));
    assert.equal(started.status, 202);
    const runId = (await started.json()).runId;
    let loseAck = true;
    const ackLossDb = {
      prepare: (...args) => database.prepare(...args),
      batch: async (statements) => {
        const result = await database.batch(statements);
        if (loseAck) {
          loseAck = false;
          throw new Error("injected_ack_loss_after_commit");
        }
        return result;
      },
    };
    const lost = await snapshotBroadcastEmailDeliveryPage({ ...env, FANMARK_DB: ackLossDb }, () => new Date(NOW), () => "lost-ack-lease");
    assert.deepEqual(lost, { status: "failed", runId, reason: "database_error" });
    const committed = await database.prepare(`SELECT last_auth_user_id, recipient_count FROM broadcast_delivery_runs WHERE id = ?`)
      .bind(runId).first();
    assert.equal(committed.recipient_count, 50);
    assert.equal(committed.last_auth_user_id, "00000000-0000-4000-8000-000000000050");
    assert.equal((await database.prepare(`SELECT COUNT(*) AS count FROM broadcast_delivery_recipients WHERE run_id = ?`)
      .bind(runId).first()).count, 50);

    const resumed = await snapshotBroadcastEmailDeliveryPage(env, () => new Date(NOW), () => "resume-lease");
    assert.equal(resumed.status, "page_committed");
    assert.equal(resumed.pageSize, 1);
    assert.equal(resumed.recipientCount, 51);
    const ready = await snapshotBroadcastEmailDeliveryPage(env, () => new Date(NOW), () => "finish-lease");
    assert.equal(ready.status, "sending");
    const totals = await database.prepare(`SELECT COUNT(*) AS count, COUNT(DISTINCT user_id) AS distinct_count
      FROM broadcast_delivery_recipients WHERE run_id = ?`).bind(runId).first();
    assert.deepEqual(totals, { count: 51, distinct_count: 51 });
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("retries an uncertain provider response with the exact same payload and idempotency key", async () => {
  const fixture = await createFixture();
  const { database, authDatabase } = fixture;
  const broadcastId = "00000000-0000-4000-8000-000000000051";
  const adminId = "00000000-0000-4000-8000-000000000052";
  const userId = "00000000-0000-4000-8000-000000000053";
  const requestId = "00000000-0000-4000-8000-000000000054";
  const origin = "https://app.example.test";
  const env = {
    AUTH_BACKEND: "better-auth",
    BETTER_AUTH_SECRET: "synthetic-better-auth-secret-with-enough-bytes-123456",
    BROADCAST_EMAIL_BACKEND: "d1",
    BROADCAST_SEND_BACKEND: "d1",
    BROADCAST_SEND_BATCH_SIZE: "1",
    BROADCAST_SEND_MAX_ATTEMPTS: "3",
    BROADCAST_WEBHOOK_SIGNING_SECRET: "whsec_c3ludGhldGljLXdlYmhvb2stc2VjcmV0",
    CORS_ALLOWED_ORIGINS: origin,
    D1_TOPOLOGY: "split",
    FANMARK_DB: database,
    AUTH_DB: authDatabase,
    RESEND_API_KEY: "re_synthetic-key",
    RESEND_FROM_EMAIL: "Fanmark <test@example.test>",
  };
  const authorizeAdmin = async () => ({ userId: adminId, sessionId: "synthetic-session" });
  const request = new Request("https://app.example.test/api/admin/broadcast-emails/send", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: origin },
    body: JSON.stringify({ broadcastId, requestId }),
  });
  const resendRequests = [];
  let providerAttempt = 0;
  let notifyProviderEntered;
  const providerEntered = new Promise((resolve) => { notifyProviderEntered = resolve; });
  let releaseProvider;
  const providerPaused = new Promise((resolve) => { releaseProvider = resolve; });
  const resendMock = async (_input, init) => {
    providerAttempt += 1;
    resendRequests.push({
      idempotencyKey: new Headers(init.headers).get("idempotency-key"),
      body: init.body,
    });
    if (providerAttempt === 1) {
      notifyProviderEntered();
      await providerPaused;
    }
    return providerAttempt === 1
      ? new Response(JSON.stringify({ name: "internal_error" }), { status: 500, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ id: "resend-synthetic-message" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await authDatabase.prepare(`CREATE TABLE "user" (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, emailVerified INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )`).run();
    await authDatabase.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (?, 'Synthetic recipient', 'synthetic-recipient@example.test', 1, ?, ?)`)
      .bind(userId, NOW, NOW).run();
    await database.batch([
      database.prepare(`INSERT INTO user_settings
        (id, user_id, username, plan_type, preferred_language, created_at, updated_at)
        VALUES ('dispatch-admin-settings', ?, 'dispatch-admin', 'admin', 'ja', ?, ?)`)
        .bind(adminId, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_emails
        (id, subject, body_text, email_type, recipient_filter, status, created_by, created_at, updated_at)
        VALUES (?, 'Retry subject', 'Retry body', 'broadcast_announcement', '{}', 'draft', ?, ?, ?)`)
        .bind(broadcastId, adminId, NOW, NOW),
      database.prepare(`INSERT INTO email_templates
        (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
        VALUES ('dispatch-ja-template', 'broadcast_announcement', 'ja', 'JA', 'Template body', 'Open', 1, ?, ?)`)
        .bind(NOW, NOW),
    ]);
    const start = await handleBroadcastEmailAdminRequest(request, env, authorizeAdmin, () => new Date(NOW));
    assert.equal(start?.status, 202);
    const startBody = await start.json();
    const snapshotOne = await snapshotBroadcastEmailDeliveryPage(env, () => new Date(NOW), () => "snapshot-lease-one");
    assert.equal(snapshotOne.status, "page_committed");
    const snapshotTwo = await snapshotBroadcastEmailDeliveryPage(env, () => new Date(NOW), () => "snapshot-lease-two");
    assert.equal(snapshotTwo.status, "sending");

    const firstAttemptPromise = dispatchBroadcastEmailDeliveryBatch(env, () => new Date(NOW), resendMock, async () => {}, () => "send-lease-one");
    await providerEntered;
    const concurrentDispatch = await dispatchBroadcastEmailDeliveryBatch(env, () => new Date(NOW), resendMock, async () => {}, () => "send-lease-concurrent");
    assert.equal(concurrentDispatch.status, "idle");
    assert.equal(providerAttempt, 1);
    releaseProvider();
    const firstAttempt = await firstAttemptPromise;
    assert.equal(firstAttempt.status, "processed");
    assert.equal(firstAttempt.retrying, 1);
    const queued = await database.prepare(`SELECT status, attempt_count, payload_fingerprint, last_error_code,
        provider_email_id, next_attempt_at FROM broadcast_delivery_recipients WHERE run_id = ? AND user_id = ?`)
      .bind(startBody.runId, userId).first();
    assert.equal(queued.status, "pending");
    assert.equal(queued.attempt_count, 1);
    assert.match(queued.payload_fingerprint, /^[a-f0-9]{64}$/u);
    assert.equal(queued.last_error_code, "provider_server_error");
    assert.equal(queued.provider_email_id, null);
    assert.equal(queued.next_attempt_at, "2026-09-27T12:01:00.000000Z");

    const secondNow = "2026-09-27T12:01:00.000000Z";
    const secondAttempt = await dispatchBroadcastEmailDeliveryBatch(env, () => new Date(secondNow), resendMock, async () => {}, () => "send-lease-two");
    assert.equal(secondAttempt.status, "completed");
    assert.equal(secondAttempt.sent, 1);
    assert.equal(providerAttempt, 2);
    assert.equal(resendRequests[0].idempotencyKey, resendRequests[1].idempotencyKey);
    assert.equal(resendRequests[0].body, resendRequests[1].body);
    assert.equal(JSON.parse(resendRequests[1].body).to[0], "synthetic-recipient@example.test");
    assert.deepEqual(await database.prepare(`SELECT status, provider_email_id FROM broadcast_delivery_recipients
      WHERE run_id = ? AND user_id = ?`).bind(startBody.runId, userId).first(), {
      status: "sent",
      provider_email_id: "resend-synthetic-message",
    });
    assert.deepEqual(await database.prepare(`SELECT status, sent_count, failed_count, created_at, updated_at FROM broadcast_emails WHERE id = ?`)
      .bind(broadcastId).first(), { status: "completed", sent_count: 1, failed_count: 0, created_at: NOW, updated_at: secondNow });
    assert.equal((await database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'BROADCAST_EMAIL_SENT' AND resource_id = ?`).bind(broadcastId).first()).count, 1);
    const duplicateDispatch = await dispatchBroadcastEmailDeliveryBatch(env, () => new Date("2026-09-27T12:02:00.000000Z"), resendMock, async () => {}, () => "send-lease-after-completion");
    assert.equal(duplicateDispatch.status, "idle");
    assert.equal((await database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'BROADCAST_EMAIL_SENT' AND resource_id = ?`).bind(broadcastId).first()).count, 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("pauses for review if the Auth email changes after an uncertain send", async () => {
  const fixture = await createFixture();
  const { database, authDatabase } = fixture;
  const broadcastId = "00000000-0000-4000-8000-000000000071";
  const adminId = "00000000-0000-4000-8000-000000000072";
  const userId = "00000000-0000-4000-8000-000000000073";
  const origin = "https://app.example.test";
  const env = {
    AUTH_BACKEND: "better-auth",
    BETTER_AUTH_SECRET: "synthetic-better-auth-secret-with-enough-bytes-123456",
    BROADCAST_EMAIL_BACKEND: "d1",
    BROADCAST_SEND_BACKEND: "d1",
    BROADCAST_SEND_BATCH_SIZE: "1",
    BROADCAST_WEBHOOK_SIGNING_SECRET: "whsec_c3ludGhldGljLXdlYmhvb2stc2VjcmV0",
    CORS_ALLOWED_ORIGINS: origin,
    D1_TOPOLOGY: "split",
    FANMARK_DB: database,
    AUTH_DB: authDatabase,
    RESEND_API_KEY: "re_synthetic-key",
    RESEND_FROM_EMAIL: "Fanmark <test@example.test>",
  };
  const authorizeAdmin = async () => ({ userId: adminId, sessionId: "synthetic-session" });
  const request = new Request("https://app.example.test/api/admin/broadcast-emails/send", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: origin },
    body: JSON.stringify({ broadcastId, requestId: "00000000-0000-4000-8000-000000000074" }),
  });
  let providerAttempts = 0;
  const uncertainProvider = async () => {
    providerAttempts += 1;
    return new Response(JSON.stringify({ name: "internal_error" }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  };
  try {
    await authDatabase.prepare(`CREATE TABLE "user" (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, emailVerified INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    )`).run();
    await authDatabase.prepare(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (?, 'Synthetic recipient', 'before-change@example.test', 1, ?, ?)`).bind(userId, NOW, NOW).run();
    await database.batch([
      database.prepare(`INSERT INTO user_settings
        (id, user_id, username, plan_type, preferred_language, created_at, updated_at)
        VALUES ('changed-email-admin-settings', ?, 'changed-email-admin', 'admin', 'ja', ?, ?)`).bind(adminId, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_emails
        (id, subject, body_text, email_type, recipient_filter, status, created_by, created_at, updated_at)
        VALUES (?, 'Frozen subject', 'Frozen body', 'broadcast_announcement', '{}', 'draft', ?, ?, ?)`).bind(broadcastId, adminId, NOW, NOW),
      database.prepare(`INSERT INTO email_templates
        (id, email_type, language, subject, body_text, button_text, is_active, created_at, updated_at)
        VALUES ('changed-email-ja-template', 'broadcast_announcement', 'ja', 'JA', 'Template body', 'Open', 1, ?, ?)`).bind(NOW, NOW),
    ]);
    const started = await handleBroadcastEmailAdminRequest(request, env, authorizeAdmin, () => new Date(NOW));
    const startBody = await started.json();
    await snapshotBroadcastEmailDeliveryPage(env, () => new Date(NOW), () => "changed-email-snapshot-one");
    await snapshotBroadcastEmailDeliveryPage(env, () => new Date(NOW), () => "changed-email-snapshot-two");

    const first = await dispatchBroadcastEmailDeliveryBatch(env, () => new Date(NOW), uncertainProvider, async () => {}, () => "changed-email-send-one");
    assert.equal(first.retrying, 1);
    assert.equal(providerAttempts, 1);
    await authDatabase.prepare(`UPDATE "user" SET email = 'after-change@example.test' WHERE id = ?`).bind(userId).run();

    const retry = await dispatchBroadcastEmailDeliveryBatch(env, () => new Date("2026-09-27T12:01:00.000000Z"), uncertainProvider, async () => {}, () => "changed-email-send-two");
    assert.equal(retry.status, "paused");
    assert.equal(retry.reason, "payload_changed_after_attempt");
    assert.equal(providerAttempts, 1);
    assert.equal((await database.prepare(`SELECT status, last_error_code FROM broadcast_delivery_recipients
      WHERE run_id = ? AND user_id = ?`).bind(startBody.runId, userId).first()).status, "needs_review");
    assert.equal((await database.prepare(`SELECT status FROM broadcast_delivery_runs WHERE id = ?`)
      .bind(startBody.runId).first()).status, "needs_review");
    assert.equal((await database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'BROADCAST_EMAIL_SENT' AND resource_id = ?`).bind(broadcastId).first()).count, 0);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("pauses without another provider call after the 24-hour idempotency window", async () => {
  const fixture = await createFixture();
  const { database, authDatabase } = fixture;
  const broadcastId = "00000000-0000-4000-8000-000000000084";
  const runId = "00000000-0000-4000-8000-000000000085";
  const userId = "00000000-0000-4000-8000-000000000086";
  const templateSnapshot = JSON.stringify({
    schemaVersion: 1,
    broadcast: { id: broadcastId, emailType: "broadcast_announcement", subject: "", bodyText: "", recipientFilter: null },
    templatesByLanguage: Object.fromEntries(["en", "ja", "ko", "id"].map((language) => [language, {
      id: `template-${language}`, subject: "Synthetic subject", body_text: "Synthetic body",
    }])),
  });
  const env = {
    AUTH_BACKEND: "better-auth",
    BETTER_AUTH_SECRET: "synthetic-better-auth-secret-with-enough-bytes-123456",
    BROADCAST_EMAIL_BACKEND: "d1",
    BROADCAST_SEND_BACKEND: "d1",
    BROADCAST_WEBHOOK_SIGNING_SECRET: "whsec_c3ludGhldGljLXdlYmhvb2stc2VjcmV0",
    D1_TOPOLOGY: "split",
    FANMARK_DB: database,
    AUTH_DB: authDatabase,
    RESEND_API_KEY: "re_synthetic-key",
    RESEND_FROM_EMAIL: "Fanmark <test@example.test>",
  };
  let providerCalls = 0;
  try {
    await database.batch([
      database.prepare(`INSERT INTO broadcast_emails
        (id, subject, body_text, email_type, status, total_recipients, created_at, updated_at)
        VALUES (?, 'Synthetic', 'Synthetic', 'broadcast_announcement', 'sending', 1, ?, ?)`).bind(broadcastId, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_delivery_runs
        (id, broadcast_id, request_id, requested_by, status, recipient_count, template_snapshot, created_at, started_at)
        VALUES (?, ?, 'expired-window-request', 'synthetic-admin', 'sending', 1, ?, ?, ?)`).bind(runId, broadcastId, templateSnapshot, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_delivery_recipients
        (run_id, user_id, language, status, attempt_count, next_attempt_at, first_attempt_at, idempotency_expires_at,
         payload_fingerprint, last_error_code, created_at, updated_at)
        VALUES (?, ?, 'ja', 'pending', 1, ?, ?, ?, ?, 'provider_server_error', ?, ?)`)
        .bind(runId, userId, "2026-09-27T12:01:00.000000Z", NOW, "2026-09-28T12:00:00.000000Z", "a".repeat(64), NOW, NOW),
    ]);
    const result = await dispatchBroadcastEmailDeliveryBatch(env,
      () => new Date("2026-09-28T12:00:00.001Z"), async () => { providerCalls += 1; return new Response("{}", { status: 200 }); },
      async () => {}, () => "expired-window-lease");
    assert.equal(result.status, "paused");
    assert.equal(result.reason, "idempotency_window_expired");
    assert.equal(providerCalls, 0);
    assert.deepEqual(await database.prepare(`SELECT status, last_error_code FROM broadcast_delivery_recipients
      WHERE run_id = ? AND user_id = ?`).bind(runId, userId).first(), {
      status: "needs_review", last_error_code: "idempotency_window_expired",
    });
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("verifies raw Resend signatures, deduplicates events, and persists only delivery metadata", async () => {
  const fixture = await createFixture();
  const { database } = fixture;
  const broadcastId = "00000000-0000-4000-8000-000000000061";
  const runId = "00000000-0000-4000-8000-000000000062";
  const userId = "00000000-0000-4000-8000-000000000063";
  const secret = "whsec_c3ludGhldGljLXdlYmhvb2stc2VjcmV0";
  const timestamp = String(Math.floor(Date.parse(NOW) / 1000));
  const env = {
    BROADCAST_EMAIL_BACKEND: "d1",
    BROADCAST_SEND_BACKEND: "d1",
    BROADCAST_WEBHOOK_SIGNING_SECRET: secret,
    D1_TOPOLOGY: "split",
    FANMARK_DB: database,
  };
  const sign = async (rawBody, eventId, signedTimestamp = timestamp) => {
    const keyBytes = Buffer.from(secret.slice("whsec_".length), "base64");
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key,
      new TextEncoder().encode(`${eventId}.${signedTimestamp}.${rawBody}`)));
    return Buffer.from(signatureBytes).toString("base64");
  };
  const makeRequest = async (rawBody, eventId, options = {}) => {
    const signedTimestamp = options.timestamp ?? timestamp;
    const signature = options.signature ?? await sign(rawBody, eventId, signedTimestamp);
    return new Request(`https://app.example.test${BROADCAST_EMAIL_WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "svix-id": eventId,
        "svix-timestamp": signedTimestamp,
        "svix-signature": `v1,${signature}`,
        "content-type": "application/json",
      },
      body: rawBody,
    });
  };
  const permanentBounce = JSON.stringify({
    type: "email.bounced",
    created_at: NOW,
    data: { email_id: "resend-webhook-message", to: ["private-recipient@example.test"], bounce: { type: "Permanent" } },
  });

  try {
    await database.batch([
      database.prepare(`INSERT INTO broadcast_emails
        (id, subject, body_text, email_type, status, total_recipients, sent_count, failed_count, created_at, updated_at)
        VALUES (?, 'Synthetic', 'Synthetic', 'broadcast_announcement', 'sending', 1, 1, 0, ?, ?)`)
        .bind(broadcastId, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_delivery_runs
        (id, broadcast_id, request_id, requested_by, status, recipient_count, template_snapshot, created_at, started_at)
        VALUES (?, ?, 'webhook-request', 'synthetic-admin', 'sending', 1, '{}', ?, ?)`)
        .bind(runId, broadcastId, NOW, NOW),
      database.prepare(`INSERT INTO broadcast_delivery_recipients
        (run_id, user_id, language, status, attempt_count, next_attempt_at, provider_email_id, created_at, updated_at)
        VALUES (?, ?, 'ja', 'sent', 1, ?, 'resend-webhook-message', ?, ?)`)
        .bind(runId, userId, NOW, NOW, NOW),
    ]);

    const first = await handleBroadcastEmailWebhookRequest(await makeRequest(permanentBounce, "event-bounce"), env, () => new Date(NOW));
    assert.equal(first?.status, 200);
    assert.deepEqual(await first.json(), { received: true });
    const duplicate = await handleBroadcastEmailWebhookRequest(await makeRequest(permanentBounce, "event-bounce"), env, () => new Date(NOW));
    assert.equal(duplicate?.status, 200);
    assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM broadcast_delivery_webhook_events").first()).count, 1);
    const webhookTimestamp = await database.prepare(
      "SELECT created_at FROM broadcast_delivery_webhook_events WHERE id = ?",
    ).bind("event-bounce").first();
    assert.equal(webhookTimestamp.created_at, "2026-09-27T12:00:00.000000Z");
    assert.equal((await database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'BROADCAST_EMAIL_SENT' AND resource_id = ?`).bind(broadcastId).first()).count, 1);
    assert.deepEqual(await database.prepare(`SELECT status, last_error_code FROM broadcast_delivery_recipients
      WHERE run_id = ? AND user_id = ?`).bind(runId, userId).first(), {
      status: "bounced",
      last_error_code: "provider_bounced",
    });
    assert.deepEqual(await database.prepare("SELECT user_id, reason FROM broadcast_delivery_suppressions").first(), {
      user_id: userId,
      reason: "permanent_bounce",
    });
    assert.deepEqual(await database.prepare("SELECT status, sent_count, failed_count FROM broadcast_emails WHERE id = ?")
      .bind(broadcastId).first(), { status: "failed", sent_count: 0, failed_count: 1 });
    const eventColumns = await database.prepare("PRAGMA table_info(broadcast_delivery_webhook_events)").all();
    assert.deepEqual(eventColumns.results.map((column) => column.name).filter((name) => /email_address|recipient|payload|body/iu.test(name)), []);

    const invalid = await handleBroadcastEmailWebhookRequest(await makeRequest(permanentBounce, "event-invalid", { signature: "AAAA" }), env, () => new Date(NOW));
    assert.equal(invalid?.status, 401);
    const tamperedSignature = await sign(permanentBounce, "event-tampered");
    const tampered = await handleBroadcastEmailWebhookRequest(
      await makeRequest(`${permanentBounce} `, "event-tampered", { signature: tamperedSignature }), env, () => new Date(NOW));
    assert.equal(tampered?.status, 401);
    const staleTimestamp = "1";
    const stale = await handleBroadcastEmailWebhookRequest(await makeRequest(permanentBounce, "event-stale", { timestamp: staleTimestamp }), env, () => new Date(NOW));
    assert.equal(stale?.status, 400);
    const unsupportedBody = JSON.stringify({ type: "email.opened", data: { email_id: "resend-webhook-message" } });
    const unsupported = await handleBroadcastEmailWebhookRequest(await makeRequest(unsupportedBody, "event-unsupported"), env, () => new Date(NOW));
    assert.equal(unsupported?.status, 400);
    assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM broadcast_delivery_webhook_events").first()).count, 1);
  } finally {
    await fixture.miniflare.dispose();
  }
});
