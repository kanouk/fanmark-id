#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const miniflarePath = path.join(repoRoot, "workers/api/node_modules/miniflare/dist/src/index.js");
const migrationPath = path.join(repoRoot, "workers/api/migrations-business/0006_stripe_webhook_ingress_staging.sql");
const now = "2026-09-26T03:04:05.000Z";
const hash = "a".repeat(64);
const receiptId = "00000000-0000-4000-8000-000000000001";
const dispatchId = "00000000-0000-4000-8000-000000000002";
const eventId = "evt_synthetic_ingress_001";

function splitSqlStatements(sql) {
  const source = sql.replace(/^--.*(?:\r?\n|$)/gm, "");
  const statements = [];
  let current = "";
  let parentheses = 0;
  for (const line of source.split(/\r?\n/)) {
    current += `${line}\n`;
    for (const character of line) {
      if (character === "(") parentheses += 1;
      if (character === ")") parentheses -= 1;
    }
    if (line.trimEnd().endsWith(";") && parentheses === 0) {
      statements.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) throw new Error("incomplete_sql_migration_statement");
  return statements;
}

async function createDatabase() {
  const { Miniflare } = await import(pathToFileURL(miniflarePath).href);
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "fanmark-stripe-webhook-ingress-schema-test",
        type: "worker",
        compatibilityDate: "2026-09-18",
        env: { DB: { type: "d1", name: "fanmark-stripe-webhook-ingress-schema-test" } },
        manifest: {
          mainModule: "index.js",
          modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('ok'); } };" } },
        },
      },
    }],
  });
  const database = await miniflare.getD1Database("DB");
  try {
    const sql = await fs.readFile(migrationPath, "utf8");
    for (const statement of splitSqlStatements(sql)) {
      const result = await database.prepare(statement).run();
      assert.equal(result.success, true, statement.slice(0, 120));
    }
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
  return { miniflare, database };
}

function receiptValues(overrides = {}) {
  return {
    id: receiptId,
    stripe_event_id: eventId,
    livemode: 0,
    event_type: "customer.subscription.updated",
    object_type: "subscription",
    object_id: "sub_synthetic_001",
    api_version: "2026-01-01",
    normalized_schema_version: 1,
    normalized_payload: JSON.stringify({ id: "evt_synthetic_ingress_001", type: "customer.subscription.updated" }),
    normalized_payload_sha256: hash,
    raw_payload_sha256: "b".repeat(64),
    status: "received",
    delivery_count: 1,
    first_received_at: now,
    last_received_at: now,
    terminal_at: null,
    last_error_code: null,
    last_error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function dispatchValues(overrides = {}) {
  return {
    id: dispatchId,
    receipt_id: receiptId,
    stripe_event_id: eventId,
    livemode: 0,
    status: "pending",
    attempt_count: 0,
    available_at: now,
    claimed_at: null,
    lease_until: null,
    lease_token: null,
    claim_generation: 0,
    completed_at: null,
    last_error_code: null,
    last_error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function insert(table, values) {
  const columns = Object.keys(values);
  return { sql: `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, values: Object.values(values) };
}

async function run(database, table, values) {
  const query = insert(table, values);
  return database.prepare(query.sql).bind(...query.values).run();
}

async function count(database, table) {
  return database.prepare(`SELECT count(*) AS count FROM ${table}`).first().then((row) => row.count);
}

test("Stripe ingress schema creates receipt/dispatch tables and excludes raw request bodies", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const tables = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'stripe_webhook_%' ORDER BY name").all();
    assert.deepEqual(tables.results.map((row) => row.name), ["stripe_webhook_dispatches", "stripe_webhook_receipts"]);
    const receiptColumns = await database.prepare("PRAGMA table_info(stripe_webhook_receipts)").all();
    const dispatchColumns = await database.prepare("PRAGMA table_info(stripe_webhook_dispatches)").all();
    const rawBodyColumn = /^(raw_payload|request_body|payload_bytes)$/i;
    assert.equal(receiptColumns.results.some((column) => rawBodyColumn.test(column.name)), false);
    assert.equal(dispatchColumns.results.some((column) => rawBodyColumn.test(column.name)), false);
    const indexes = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'stripe_webhook_%' ORDER BY name").all();
    assert.deepEqual(indexes.results.map((row) => row.name), [
      "stripe_webhook_dispatches_claim_idx",
      "stripe_webhook_dispatches_ready_idx",
      "stripe_webhook_receipts_status_idx",
    ]);
  } finally {
    await miniflare.dispose();
  }
});

test("receipt and durable dispatch commit together and event identity includes live mode", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const receipt = insert("stripe_webhook_receipts", receiptValues());
    const dispatch = insert("stripe_webhook_dispatches", dispatchValues());
    const results = await database.batch([
      database.prepare(receipt.sql).bind(...receipt.values),
      database.prepare(dispatch.sql).bind(...dispatch.values),
    ]);
    assert.equal(results.length, 2);
    assert.deepEqual(await database.prepare("SELECT stripe_event_id, livemode, status, delivery_count FROM stripe_webhook_receipts WHERE id = ?").bind(receiptId).first(), {
      stripe_event_id: eventId,
      livemode: 0,
      status: "received",
      delivery_count: 1,
    });
    assert.deepEqual(await database.prepare("SELECT receipt_id, stripe_event_id, livemode, status, claim_generation FROM stripe_webhook_dispatches WHERE id = ?").bind(dispatchId).first(), {
      receipt_id: receiptId,
      stripe_event_id: eventId,
      livemode: 0,
      status: "pending",
      claim_generation: 0,
    });

    await assert.rejects(() => run(database, "stripe_webhook_receipts", receiptValues({ id: "00000000-0000-4000-8000-000000000003" })), /UNIQUE constraint/);
    await run(database, "stripe_webhook_receipts", receiptValues({
      id: "00000000-0000-4000-8000-000000000004",
      livemode: 1,
    }));
    assert.equal(await count(database, "stripe_webhook_receipts"), 2);
  } finally {
    await miniflare.dispose();
  }
});

test("a dispatch failure rolls back its paired receipt in the D1 batch", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const receipt = insert("stripe_webhook_receipts", receiptValues());
    const mismatchedDispatch = insert("stripe_webhook_dispatches", dispatchValues({ stripe_event_id: "evt_other_synthetic" }));
    await assert.rejects(() => database.batch([
      database.prepare(receipt.sql).bind(...receipt.values),
      database.prepare(mismatchedDispatch.sql).bind(...mismatchedDispatch.values),
    ]));
    assert.equal(await count(database, "stripe_webhook_receipts"), 0);
    assert.equal(await count(database, "stripe_webhook_dispatches"), 0);
  } finally {
    await miniflare.dispose();
  }
});

test("receipt and lease state checks reject malformed or incomplete rows", async () => {
  const { miniflare, database } = await createDatabase();
  try {
    const invalidReceipts = [
      receiptValues({ normalized_payload: "not-json" }),
      receiptValues({ normalized_payload_sha256: "short" }),
      receiptValues({ status: "applied" }),
      receiptValues({ status: "unknown" }),
      receiptValues({ delivery_count: 0 }),
      receiptValues({ livemode: 2 }),
    ];
    for (const [index, values] of invalidReceipts.entries()) {
      await assert.rejects(() => run(database, "stripe_webhook_receipts", {
        ...values,
        id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
        stripe_event_id: `${eventId}_${index}`,
      }));
    }
    await run(database, "stripe_webhook_receipts", receiptValues());

    await assert.rejects(() => run(database, "stripe_webhook_dispatches", dispatchValues({
      id: "00000000-0000-4000-8000-000000000011",
      status: "processing",
      claim_generation: 1,
    })));
    await assert.rejects(() => run(database, "stripe_webhook_dispatches", dispatchValues({
      id: "00000000-0000-4000-8000-000000000012",
      status: "completed",
    })));
    await assert.rejects(() => run(database, "stripe_webhook_dispatches", dispatchValues({
      id: "00000000-0000-4000-8000-000000000013",
      stripe_event_id: "evt_mismatched_synthetic",
    })));
    assert.equal(await count(database, "stripe_webhook_dispatches"), 0);
  } finally {
    await miniflare.dispose();
  }
});
