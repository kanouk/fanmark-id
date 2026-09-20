import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const foundationSql = await readFile(
  new URL("../../../supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql", import.meta.url),
  "utf8",
);
const leaseSql = await readFile(
  new URL("../../../supabase/migrations/20260921100000_add_stripe_dispatch_leases.sql", import.meta.url),
  "utf8",
);

const acceptSql = `
  select * from public.accept_stripe_webhook_receipt(
    $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10
  )
`;
const claimSql = `
  select * from public.claim_stripe_webhook_dispatches($1, $2, $3)
`;
const renewSql = `
  select * from public.renew_stripe_webhook_dispatch_lease($1::uuid, $2::uuid, $3, $4::uuid, $5, $6)
`;
const retrySql = `
  select * from public.retry_stripe_webhook_dispatch($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8)
`;

const defaults = {
  livemode: true,
  eventType: "invoice.payment_failed",
  objectType: "invoice",
  objectId: "in_lease_default",
  apiVersion: "2025-08-27.basil",
  schemaVersion: 1,
  payload: { event_id: "evt_lease_default", object: "invoice" },
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

async function acceptOn(target, overrides = {}) {
  const input = {
    ...defaults,
    eventId: `evt_lease_${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
  const result = await target.query(acceptSql, [
    input.eventId,
    input.livemode,
    input.eventType,
    input.objectType,
    input.objectId,
    input.apiVersion,
    input.schemaVersion,
    JSON.stringify({ ...input.payload, event_id: input.eventId }),
    input.normalizedHash,
    input.rawHash,
  ]);
  return result.rows[0];
}

async function accept(overrides = {}) {
  return acceptOn(db, overrides);
}

async function claim(livemode = true, batchSize = 10, leaseSeconds = 300) {
  const result = await execute(claimSql, [livemode, batchSize, leaseSeconds]);
  return result.rows;
}

async function renew(row, leaseSeconds = 300, overrides = {}) {
  const result = await execute(renewSql, [
    overrides.receiptId ?? row.receipt_id,
    overrides.dispatchId ?? row.dispatch_id,
    overrides.livemode ?? row.livemode,
    overrides.leaseToken ?? row.lease_token,
    overrides.claimGeneration ?? row.claim_generation,
    leaseSeconds,
  ]);
  return result.rows;
}

async function retry(row, delaySeconds = 0, errorCode = "worker_failed", errorMessage = "bounded failure", overrides = {}) {
  const result = await execute(retrySql, [
    overrides.receiptId ?? row.receipt_id,
    overrides.dispatchId ?? row.dispatch_id,
    overrides.livemode ?? row.livemode,
    overrides.leaseToken ?? row.lease_token,
    overrides.claimGeneration ?? row.claim_generation,
    delaySeconds,
    errorCode,
    errorMessage,
  ]);
  return result.rows;
}

async function dispatchState(dispatchId) {
  const result = await execute(`
    select d.status as dispatch_status,
           d.attempt_count,
           d.claim_generation,
           d.lease_token,
           d.lease_until,
           d.available_at,
           r.status as receipt_status,
           r.normalized_payload,
           r.last_error_code,
           r.last_error_message
      from billing_ingress.stripe_webhook_dispatches d
      join billing_ingress.stripe_webhook_receipts r on r.id = d.receipt_id
     where d.id = $1::uuid
  `, [dispatchId]);
  return result.rows[0];
}

async function markTerminal(row, receiptStatus = "applied", dispatchStatus = "completed") {
  await execute(`
    update billing_ingress.stripe_webhook_receipts
       set status = $1, terminal_at = clock_timestamp()
     where id = $2::uuid
  `, [receiptStatus, row.receipt_id]);
  await execute(`
    update billing_ingress.stripe_webhook_dispatches
       set status = $1, completed_at = case when $1 = 'completed' then clock_timestamp() else null end,
           claimed_at = null, lease_until = null, lease_token = null
     where id = $2::uuid
  `, [dispatchStatus, row.dispatch_id]);
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
  await db.exec(foundationSql);
  await db.exec(leaseSql);
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

test("the migration refuses an unfenced legacy processing row for explicit reconciliation", async () => {
  const legacyDb = new PGlite();
  try {
    await legacyDb.exec(`
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
    await legacyDb.exec(foundationSql);
    await legacyDb.query("select set_config('request.jwt.claim.role', $1, false)", ["service_role"]);
    const accepted = await acceptOn(legacyDb, { eventId: "evt_lease_legacy_processing" });
    await legacyDb.query(
      "update billing_ingress.stripe_webhook_dispatches set status = 'processing' where id = $1::uuid",
      [accepted.dispatch_id],
    );

    await assert.rejects(
      () => legacyDb.exec(leaseSql),
      /processing Stripe dispatch rows require lease reconciliation/,
    );
  } finally {
    await legacyDb.close();
  }
});

test("claims only due nonterminal work in the requested mode and skips active/future/terminal rows", async () => {
  const liveDue = await accept({ eventId: "evt_lease_live_due" });
  const testDue = await accept({ eventId: "evt_lease_test_due", livemode: false });
  const future = await accept({ eventId: "evt_lease_live_future" });
  const terminal = await accept({ eventId: "evt_lease_live_terminal" });
  await execute(
    "update billing_ingress.stripe_webhook_dispatches set available_at = clock_timestamp() + interval '1 hour' where id = $1::uuid",
    [future.dispatch_id],
  );
  await markTerminal(terminal);

  const liveRows = await claim(true, 10, 60);
  const testRows = await claim(false, 10, 60);

  assert.deepEqual(liveRows.map((row) => row.stripe_event_id), [liveDue.event_id ?? "evt_lease_live_due"]);
  assert.deepEqual(testRows.map((row) => row.stripe_event_id), [testDue.event_id ?? "evt_lease_test_due"]);
  assert.equal(liveRows[0].attempt_count, 1);
  assert.equal(liveRows[0].claim_generation, 1);
  assert.equal(liveRows[0].lease_token.length > 0, true);
  assert.equal(await claim(true, 10, 60).then((rows) => rows.length), 0);
  assert.equal(await dispatchState(future.dispatch_id).then((row) => row.dispatch_status), "pending");
  assert.equal(await dispatchState(terminal.dispatch_id).then((row) => row.dispatch_status), "completed");
});

test("expired processing can be reclaimed with a new token and generation", async () => {
  const accepted = await accept({ eventId: "evt_lease_expired_reclaim" });
  const [first] = await claim(true, 1, 60);
  assert.equal(first.dispatch_id, accepted.dispatch_id);

  await execute(
    "update billing_ingress.stripe_webhook_dispatches set lease_until = clock_timestamp() - interval '1 second' where id = $1::uuid",
    [first.dispatch_id],
  );
  const [reclaimed] = await claim(true, 1, 60);

  assert.equal(reclaimed.dispatch_id, first.dispatch_id);
  assert.equal(reclaimed.claim_generation, 2);
  assert.equal(reclaimed.attempt_count, 2);
  assert.notEqual(reclaimed.lease_token, first.lease_token);
  assert.equal((await renew(first)).length, 0);
  assert.equal((await retry(first)).length, 0);
  const state = await dispatchState(first.dispatch_id);
  assert.equal(state.dispatch_status, "processing");
  assert.equal(state.claim_generation, 2);
  assert.equal(state.lease_token, reclaimed.lease_token);
});

test("renew requires the current unexpired token and generation and preserves generation", async () => {
  await accept({ eventId: "evt_lease_renew" });
  const [claimed] = await claim(true, 1, 60);
  const renewedWithoutShortening = await renew(claimed, 1);

  assert.equal(renewedWithoutShortening.length, 1);
  assert.equal(renewedWithoutShortening[0].claim_generation, claimed.claim_generation);
  assert.equal(renewedWithoutShortening[0].lease_token, claimed.lease_token);
  assert.ok(new Date(renewedWithoutShortening[0].lease_until).getTime() >= new Date(claimed.lease_until).getTime());

  const renewed = await renew(claimed, 120);
  assert.ok(new Date(renewed[0].lease_until).getTime() > new Date(renewedWithoutShortening[0].lease_until).getTime());

  await execute(
    "update billing_ingress.stripe_webhook_dispatches set lease_until = clock_timestamp() - interval '1 second' where id = $1::uuid",
    [claimed.dispatch_id],
  );
  assert.equal((await renew(claimed, 120)).length, 0);
});

test("retry clears the lease, schedules bounded work, updates both states, and preserves the snapshot", async () => {
  const accepted = await accept({
    eventId: "evt_lease_retry",
    payload: { object: "invoice", original: "kept" },
  });
  const [claimed] = await claim(true, 1, 60);
  const before = await dispatchState(claimed.dispatch_id);
  const [retried] = await retry(claimed, 600, "temporary_failure", "Stripe retrieval failed");

  assert.equal(retried.receipt_status, "retryable");
  assert.equal(retried.dispatch_status, "retryable");
  assert.equal(retried.claim_generation, 1);
  assert.equal(retried.attempt_count, 1);
  assert.equal(await claim(true, 1, 60).then((rows) => rows.length), 0);
  const after = await dispatchState(accepted.dispatch_id);
  assert.equal(after.dispatch_status, "retryable");
  assert.equal(after.receipt_status, "retryable");
  assert.equal(after.lease_token, null);
  assert.equal(after.lease_until, null);
  assert.equal(after.last_error_code, "temporary_failure");
  assert.equal(after.last_error_message, "Stripe retrieval failed");
  assert.deepEqual(after.normalized_payload, before.normalized_payload);

  await execute(
    "update billing_ingress.stripe_webhook_dispatches set available_at = clock_timestamp() - interval '1 second' where id = $1::uuid",
    [accepted.dispatch_id],
  );
  const [reclaimed] = await claim(true, 1, 60);
  assert.equal(reclaimed.claim_generation, 2);
  assert.equal(reclaimed.attempt_count, 2);
});

test("retry is atomic if the receipt update fails after the dispatch update", async () => {
  await accept({ eventId: "evt_lease_retry_rollback" });
  const [claimed] = await claim(true, 1, 60);
  await db.exec(`
    create schema lease_test;
    create function lease_test.fail_retry_receipt()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.status = 'retryable' then
        raise exception 'test retry rollback';
      end if;
      return new;
    end;
    $$;
    create trigger fail_retry_receipt
      before update on billing_ingress.stripe_webhook_receipts
      for each row execute function lease_test.fail_retry_receipt();
  `);

  await assert.rejects(() => retry(claimed), /test retry rollback/);
  const state = await dispatchState(claimed.dispatch_id);
  assert.equal(state.receipt_status, "processing");
  assert.equal(state.dispatch_status, "processing");
  assert.equal(state.claim_generation, 1);
  assert.equal(state.lease_token, claimed.lease_token);

  await db.exec(`
    drop trigger fail_retry_receipt on billing_ingress.stripe_webhook_receipts;
    drop function lease_test.fail_retry_receipt();
    drop schema lease_test;
  `);
});

test("claim is atomic if the receipt processing update fails", async () => {
  const accepted = await accept({ eventId: "evt_lease_claim_rollback" });
  await db.exec(`
    create schema lease_test;
    create function lease_test.fail_processing_receipt()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.status = 'processing' then
        raise exception 'test claim rollback';
      end if;
      return new;
    end;
    $$;
    create trigger fail_processing_receipt
      before update on billing_ingress.stripe_webhook_receipts
      for each row execute function lease_test.fail_processing_receipt();
  `);

  await assert.rejects(() => claim(true, 1, 60), /test claim rollback/);
  const state = await dispatchState(accepted.dispatch_id);
  assert.equal(state.receipt_status, "received");
  assert.equal(state.dispatch_status, "pending");
  assert.equal(state.claim_generation, 0);

  await db.exec(`
    drop trigger fail_processing_receipt on billing_ingress.stripe_webhook_receipts;
    drop function lease_test.fail_processing_receipt();
    drop schema lease_test;
  `);
});

test("invalid parameters reject before any state transition", async () => {
  const accepted = await accept({ eventId: "evt_lease_invalid_parameters" });
  await assert.rejects(() => claim(true, 0, 60), /batch size/);
  await assert.rejects(() => claim(true, 1, 0), /lease duration/);
  const [claimed] = await claim(true, 1, 60);
  await assert.rejects(() => retry(claimed, -1), /retry delay/);
  await assert.rejects(() => retry(claimed, 86401), /retry delay/);
  await assert.rejects(() => retry(claimed, 0, "x".repeat(129)), /error code/);
  await assert.rejects(() => renew(claimed, 3601), /lease duration/);
  const state = await dispatchState(accepted.dispatch_id);
  assert.equal(state.receipt_status, "processing");
  assert.equal(state.dispatch_status, "processing");
});

test("terminal receipts and dispatches are never claimable or renewed", async () => {
  const applied = await accept({ eventId: "evt_lease_applied" });
  const deadLetter = await accept({ eventId: "evt_lease_dead_letter" });
  await markTerminal(applied, "applied", "completed");
  await markTerminal(deadLetter, "dead_letter", "dead_letter");

  assert.equal((await claim(true)).length, 0);
  assert.equal((await renew({
    receipt_id: applied.receipt_id,
    dispatch_id: applied.dispatch_id,
    livemode: true,
    lease_token: "00000000-0000-0000-0000-000000000001",
    claim_generation: 1,
  })).length, 0);
});

test("service-role ACL and fixed search_path protect all lease RPCs", async () => {
  const accepted = await accept({ eventId: "evt_lease_acl" });
  await execute("set search_path = pg_catalog, pg_temp");

  const forgedLease = {
    receipt_id: accepted.receipt_id,
    dispatch_id: accepted.dispatch_id,
    livemode: true,
    lease_token: "00000000-0000-0000-0000-000000000001",
    claim_generation: 1,
  };
  for (const role of ["anon", "authenticated"]) {
    await execute(`set role ${role}`);
    await setRequestRole("service_role");
    await assert.rejects(() => claim(true), /permission denied/);
    await assert.rejects(() => renew(forgedLease), /permission denied/);
    await assert.rejects(() => retry(forgedLease), /permission denied/);
    await execute("reset role");
    await setRequestRole("service_role");
  }

  await execute("set role service_role");
  await setRequestRole("service_role");
  const rows = await claim(true, 1, 60);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dispatch_id, accepted.dispatch_id);
  await assert.rejects(
    () => execute("select count(*) from billing_ingress.stripe_webhook_receipts"),
    /permission denied/,
  );
  await assert.rejects(
    () => execute("select count(*) from billing_ingress.stripe_webhook_dispatches"),
    /permission denied/,
  );
  await execute("reset role");
  await setRequestRole("service_role");
});
