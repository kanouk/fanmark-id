import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationSql = await readFile(
  new URL("../../../supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql", import.meta.url),
  "utf8",
);

const acceptSql = `
  select * from public.accept_stripe_webhook_receipt(
    $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10
  )
`;

const defaults = {
  eventId: "evt_foundation_001",
  livemode: true,
  eventType: "invoice.payment_failed",
  objectType: "invoice",
  objectId: "in_foundation_001",
  apiVersion: "2025-08-27.basil",
  schemaVersion: 1,
  payload: { event_id: "evt_foundation_001", object: "invoice" },
  normalizedHash: "a".repeat(64),
  rawHash: "b".repeat(64),
};

let db;

async function execute(sql, params = []) {
  return db.query(sql, params);
}

async function setRequestRole(role) {
  await execute("select set_config('request.jwt.claim.role', $1, false)", [role]);
}

async function accept(overrides = {}) {
  const input = { ...defaults, ...overrides };
  const result = await execute(acceptSql, [
    input.eventId,
    input.livemode,
    input.eventType,
    input.objectType,
    input.objectId,
    input.apiVersion,
    input.schemaVersion,
    JSON.stringify(input.payload),
    input.normalizedHash,
    input.rawHash,
  ]);
  return result.rows[0];
}

async function countRows(table) {
  const result = await execute(`select count(*)::int as count from ${table}`);
  return result.rows[0].count;
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create function auth.role()
    returns text
    language sql
    stable
    as $$ select current_setting('request.jwt.claim.role', true) $$;
  `);
  await db.exec(migrationSql);
  await setRequestRole("service_role");
});

beforeEach(async () => {
  await execute("reset role");
  await setRequestRole("service_role");
  await execute("set search_path = public");
  await execute("truncate billing_ingress.stripe_webhook_dispatches, billing_ingress.stripe_webhook_receipts cascade");
});

after(async () => {
  await db.close();
});

test("inserts one immutable receipt and one pending dispatch atomically", async () => {
  const result = await accept();

  assert.equal(result.outcome, "accepted");
  assert.equal(result.receipt_status, "received");
  assert.equal(result.dispatch_status, "pending");
  assert.equal(result.delivery_count, 1);
  assert.equal(await countRows("billing_ingress.stripe_webhook_receipts"), 1);
  assert.equal(await countRows("billing_ingress.stripe_webhook_dispatches"), 1);

  const stored = await execute(`
    select stripe_event_id, livemode, normalized_schema_version,
           normalized_payload, normalized_payload_sha256, raw_payload_sha256
      from billing_ingress.stripe_webhook_receipts
  `);
  assert.deepEqual(stored.rows[0], {
    stripe_event_id: defaults.eventId,
    livemode: true,
    normalized_schema_version: 1,
    normalized_payload: defaults.payload,
    normalized_payload_sha256: defaults.normalizedHash,
    raw_payload_sha256: defaults.rawHash,
  });
});

test("same-mode duplicate retry returns the existing nonterminal pair without adding rows", async () => {
  const first = await accept();
  const duplicate = await accept();

  assert.equal(duplicate.outcome, "duplicate_nonterminal");
  assert.equal(duplicate.receipt_id, first.receipt_id);
  assert.equal(duplicate.dispatch_id, first.dispatch_id);
  assert.equal(duplicate.delivery_count, 2);
  assert.equal(await countRows("billing_ingress.stripe_webhook_receipts"), 1);
  assert.equal(await countRows("billing_ingress.stripe_webhook_dispatches"), 1);
});

test("overlapping same-mode delivery calls converge on one receipt and dispatch", async () => {
  const results = await Promise.all([
    accept({ eventId: "evt_concurrent" }),
    accept({ eventId: "evt_concurrent" }),
  ]);

  assert.equal(results.filter((result) => result.outcome === "accepted").length, 1);
  assert.equal(results.filter((result) => result.outcome === "duplicate_nonterminal").length, 1);
  assert.equal(new Set(results.map((result) => result.receipt_id)).size, 1);
  assert.equal(new Set(results.map((result) => result.dispatch_id)).size, 1);
  assert.equal(await countRows("billing_ingress.stripe_webhook_receipts"), 1);
  assert.equal(await countRows("billing_ingress.stripe_webhook_dispatches"), 1);
});

test("terminal duplicate is reported without creating another dispatch", async () => {
  const first = await accept();
  await execute(`
    update billing_ingress.stripe_webhook_receipts
       set status = 'applied', terminal_at = now()
     where id = $1::uuid
  `, [first.receipt_id]);
  await execute(`
    update billing_ingress.stripe_webhook_dispatches
       set status = 'completed', completed_at = now()
     where id = $1::uuid
  `, [first.dispatch_id]);

  const duplicate = await accept();
  assert.equal(duplicate.outcome, "duplicate_terminal");
  assert.equal(duplicate.receipt_id, first.receipt_id);
  assert.equal(duplicate.dispatch_id, first.dispatch_id);
  assert.equal(duplicate.receipt_status, "applied");
  assert.equal(duplicate.dispatch_status, "completed");
  assert.equal(duplicate.delivery_count, 2);
  assert.equal(await countRows("billing_ingress.stripe_webhook_receipts"), 1);
  assert.equal(await countRows("billing_ingress.stripe_webhook_dispatches"), 1);
});

test("terminal receipt repair preserves terminal dispatch state when the row is missing", async () => {
  const cases = [
    ["applied", "completed"],
    ["ignored", "completed"],
    ["dead_letter", "dead_letter"],
  ];

  for (const [receiptStatus, expectedDispatchStatus] of cases) {
    const first = await accept({ eventId: `evt_missing_dispatch_${receiptStatus}` });
    await execute(`
      update billing_ingress.stripe_webhook_receipts
         set status = $1, terminal_at = now()
       where id = $2::uuid
    `, [receiptStatus, first.receipt_id]);
    await execute(
      "delete from billing_ingress.stripe_webhook_dispatches where id = $1::uuid",
      [first.dispatch_id],
    );

    const duplicate = await accept({ eventId: `evt_missing_dispatch_${receiptStatus}` });
    assert.equal(duplicate.outcome, "duplicate_terminal");
    assert.equal(duplicate.dispatch_status, expectedDispatchStatus);

    const repaired = await execute(`
      select status, completed_at
        from billing_ingress.stripe_webhook_dispatches
       where receipt_id = $1::uuid
    `, [first.receipt_id]);
    assert.equal(repaired.rows[0].status, expectedDispatchStatus);
    assert.equal(expectedDispatchStatus === "completed", repaired.rows[0].completed_at !== null);
  }
});

test("a nonterminal receipt with a terminal dispatch requires reconciliation and keeps the dispatch untouched", async () => {
  const first = await accept({ eventId: "evt_terminal_mismatch" });
  await execute(`
    update billing_ingress.stripe_webhook_dispatches
       set status = 'completed', completed_at = now()
     where id = $1::uuid
  `, [first.dispatch_id]);

  await assert.rejects(
    () => accept({ eventId: "evt_terminal_mismatch" }),
    /reconciliation required/,
  );

  const state = await execute(`
    select r.status as receipt_status, d.status as dispatch_status
      from billing_ingress.stripe_webhook_receipts r
      join billing_ingress.stripe_webhook_dispatches d on d.receipt_id = r.id
     where r.id = $1::uuid
  `, [first.receipt_id]);
  assert.deepEqual(state.rows[0], { receipt_status: "received", dispatch_status: "completed" });
});

test("same event ID is isolated between live and test mode", async () => {
  const live = await accept({ eventId: "evt_same_across_modes", livemode: true });
  const testMode = await accept({ eventId: "evt_same_across_modes", livemode: false });

  assert.equal(live.outcome, "accepted");
  assert.equal(testMode.outcome, "accepted");
  assert.equal(await countRows("billing_ingress.stripe_webhook_receipts"), 2);
  assert.equal(await countRows("billing_ingress.stripe_webhook_dispatches"), 2);
});

test("the dispatch composite foreign key binds receipt ID, mode, and event ID together", async () => {
  const first = await accept({ eventId: "evt_binding_a", livemode: true });
  const second = await accept({ eventId: "evt_binding_b", livemode: true });
  await execute(
    "delete from billing_ingress.stripe_webhook_dispatches where id in ($1::uuid, $2::uuid)",
    [first.dispatch_id, second.dispatch_id],
  );

  await assert.rejects(
    () => execute(`
      insert into billing_ingress.stripe_webhook_dispatches (
        receipt_id, stripe_event_id, livemode
      ) values ($1::uuid, $2, $3)
    `, [first.receipt_id, "evt_binding_b", true]),
    /stripe_webhook_dispatches_receipt_event_fk/,
  );
  assert.equal(await countRows("billing_ingress.stripe_webhook_dispatches"), 0);
});

test("conflicting immutable fields or hashes fail without changing the stored receipt", async () => {
  await accept({ eventId: "evt_conflict" });

  await assert.rejects(
    () => accept({ eventId: "evt_conflict", eventType: "invoice.payment_succeeded" }),
    /conflicts with immutable event data/,
  );
  await assert.rejects(
    () => accept({ eventId: "evt_conflict", normalizedHash: "c".repeat(64) }),
    /conflicts with immutable event data/,
  );

  const stored = await execute(`
    select event_type, normalized_payload_sha256, delivery_count
      from billing_ingress.stripe_webhook_receipts
     where stripe_event_id = 'evt_conflict'
  `);
  assert.deepEqual(stored.rows[0], {
    event_type: defaults.eventType,
    normalized_payload_sha256: defaults.normalizedHash,
    delivery_count: 1,
  });
});

test("a dispatch insert failure rolls back the receipt insert", async () => {
  await db.exec(`
    create function billing_ingress.force_dispatch_failure()
    returns trigger
    language plpgsql
    set search_path = pg_catalog
    as $$
    begin
      raise exception 'forced dispatch failure';
    end;
    $$;
    create trigger force_dispatch_failure
      before insert on billing_ingress.stripe_webhook_dispatches
      for each row execute function billing_ingress.force_dispatch_failure();
  `);

  await assert.rejects(
    () => accept({ eventId: "evt_rollback" }),
    /forced dispatch failure/,
  );
  assert.equal(await countRows("billing_ingress.stripe_webhook_receipts"), 0);
  assert.equal(await countRows("billing_ingress.stripe_webhook_dispatches"), 0);

  await db.exec(`
    drop trigger force_dispatch_failure on billing_ingress.stripe_webhook_dispatches;
    drop function billing_ingress.force_dispatch_failure();
  `);
  const retry = await accept({ eventId: "evt_rollback" });
  assert.equal(retry.outcome, "accepted");
});

test("anon and authenticated callers cannot invoke the receipt RPC or read its tables", async () => {
  for (const role of ["anon", "authenticated"]) {
    await execute(`set role ${role}`);
    await setRequestRole(role);
    await assert.rejects(
      () => accept({ eventId: `evt_forbidden_${role}` }),
      /permission denied|service role required/,
    );
    await setRequestRole("service_role");
    await assert.rejects(
      () => accept({ eventId: `evt_forged_claim_${role}` }),
      /permission denied/,
    );
    await setRequestRole(role);
    await assert.rejects(
      () => execute("select count(*) from billing_ingress.stripe_webhook_receipts"),
      /permission denied/,
    );
    await execute("reset role");
    await setRequestRole("service_role");
  }
});

test("service_role uses the RPC while direct table access remains denied", async () => {
  await execute("set role service_role");
  await setRequestRole("service_role");
  const result = await accept({ eventId: "evt_service_rpc" });
  assert.equal(result.outcome, "accepted");
  await assert.rejects(
    () => execute("select count(*) from billing_ingress.stripe_webhook_receipts"),
    /permission denied/,
  );
  await execute("reset role");
  await setRequestRole("service_role");
  assert.equal(await countRows("billing_ingress.stripe_webhook_receipts"), 1);
});

test("the SECURITY DEFINER function is unaffected by a caller-controlled search_path", async () => {
  await db.exec(`
    create schema evil;
    create table evil.stripe_webhook_receipts (stripe_event_id text);
    create table evil.stripe_webhook_dispatches (stripe_event_id text);
  `);
  await execute("set search_path = evil, public");

  const result = await accept({ eventId: "evt_search_path" });
  assert.equal(result.outcome, "accepted");
  assert.equal(await countRows("billing_ingress.stripe_webhook_receipts"), 1);
  assert.equal((await countRows("evil.stripe_webhook_receipts")), 0);
  assert.match((await execute("show search_path")).rows[0].search_path, /evil/);
});

test("input and table constraints reject invalid receipt state", async () => {
  await assert.rejects(
    () => accept({ eventId: "evt_bad_hash", normalizedHash: "A".repeat(64) }),
    /SHA-256 must be 64 lowercase hex/,
  );

  for (const payload of [null, 7, "scalar", []]) {
    await assert.rejects(
      () => accept({ eventId: `evt_bad_payload_${String(payload)}`, payload }),
      /normalized payload must be a JSON object/,
    );
  }

  await assert.rejects(
    () => execute(`
      insert into billing_ingress.stripe_webhook_receipts (
        stripe_event_id, livemode, event_type, normalized_schema_version,
        normalized_payload, normalized_payload_sha256, raw_payload_sha256, status
      ) values (
        'evt_bad_status', true, 'invoice.created', 1, '{}'::jsonb,
        repeat('a', 64), repeat('b', 64), 'not_a_status'
      )
    `),
    /stripe_webhook_receipts_status_check/,
  );
});
