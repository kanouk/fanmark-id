import assert from "node:assert/strict";
import test from "node:test";

import { authEmailTemplateContentDigest } from "./staging-auth-email-template-baseline.mjs";
import {
  STAGING_EMAIL_TEMPLATE_MASTER_READ_SQL,
  broadcastEmailTemplateContentDigest,
  readStagingEmailTemplateMasterBaseline,
} from "./staging-email-template-master-baseline.mjs";

function authRows() {
  return ["signup", "recovery", "magiclink", "email_change"].flatMap((emailType, typeIndex) =>
    ["en", "id", "ja", "ko"].map((language, languageIndex) => ({
      id: `00000000-0000-4000-8000-${String(typeIndex * 4 + languageIndex + 1).padStart(12, "0")}`,
      email_type: emailType,
      language,
      subject: `Auth subject ${typeIndex}-${languageIndex}`,
      body_text: `Auth body ${typeIndex}-${languageIndex}`,
      button_text: "Continue",
      is_active: 1,
      created_at: "2026-09-27T00:00:00.000Z",
      updated_at: "2026-09-27T00:00:00.000Z",
    })),
  );
}

function broadcastRows() {
  return ["broadcast_announcement", "broadcast_maintenance", "broadcast_security"].flatMap((emailType, typeIndex) =>
    ["en", "id", "ja", "ko"].map((language, languageIndex) => ({
      id: `10000000-0000-4000-8000-${String(typeIndex * 4 + languageIndex + 1).padStart(12, "0")}`,
      email_type: emailType,
      language,
      subject: `Broadcast subject ${typeIndex}-${languageIndex}`,
      body_text: `Broadcast body ${typeIndex}-${languageIndex}`,
      button_text: "Open",
      is_active: 1,
      created_at: "2026-09-27T00:00:00.000Z",
      updated_at: "2026-09-27T00:00:00.000Z",
    })),
  );
}

function rowsFor({ auth = [], broadcast = [], total = auth.length + broadcast.length } = {}) {
  return (sql) => {
    if (sql === STAGING_EMAIL_TEMPLATE_MASTER_READ_SQL) return [{
      auth_count: auth.length,
      auth_rows_json: JSON.stringify(auth),
      broadcast_count: broadcast.length,
      broadcast_rows_json: JSON.stringify(broadcast),
      total_count: total,
    }];
    return [];
  };
}

test("email template master baseline accepts only empty, auth-only, or exact auth plus broadcast sets", () => {
  assert.equal(readStagingEmailTemplateMasterBaseline(rowsFor()), "empty");

  const auth = authRows();
  const broadcast = broadcastRows();
  const expectedAuthDigest = authEmailTemplateContentDigest(auth);
  const expectedBroadcastDigest = broadcastEmailTemplateContentDigest(broadcast);
  const options = { expectedAuthDigest, expectedBroadcastDigest };

  assert.equal(readStagingEmailTemplateMasterBaseline(rowsFor({ auth }), options), "auth_seeded");
  assert.equal(readStagingEmailTemplateMasterBaseline(rowsFor({ auth, broadcast }), options), "seeded");
  assert.equal(readStagingEmailTemplateMasterBaseline(rowsFor({ auth, broadcast, total: 29 }), options), "invalid");
  assert.equal(readStagingEmailTemplateMasterBaseline(rowsFor({ auth, broadcast }), {
    ...options,
    expectedBroadcastDigest: "0".repeat(64),
  }), "invalid");
  assert.equal(readStagingEmailTemplateMasterBaseline(rowsFor({ auth }), {
    ...options,
    expectedAuthDigest: "0".repeat(64),
  }), "invalid");
  assert.equal(readStagingEmailTemplateMasterBaseline((sql) =>
    sql === STAGING_EMAIL_TEMPLATE_MASTER_READ_SQL ? [{
      auth_count: 16,
      auth_rows_json: "not-json",
      broadcast_count: 0,
      broadcast_rows_json: "[]",
      total_count: 16,
    }] : []), "invalid");
});
