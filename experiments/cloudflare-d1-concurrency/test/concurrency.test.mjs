import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import schemaSql from "../migrations/0001_concurrency_fixture.sql?raw";

const USER_A = "user-a";
const USER_B = "user-b";
const FIXED_TIME = "2026-09-21T00:00:00.000Z";

function statementsFrom(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function executeSchema() {
  await env.DB.batch(statementsFrom(schemaSql).map((statement) => env.DB.prepare(statement)));
}

async function resetFixture() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM acquisition_audit"),
    env.DB.prepare("DELETE FROM fanmark_licenses"),
    env.DB.prepare("DELETE FROM coupon_redemptions"),
    env.DB.prepare("DELETE FROM coupons"),
    env.DB.prepare("DELETE FROM transfer_audit"),
    env.DB.prepare("DELETE FROM transfer_requests"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}

async function seedUsers(users) {
  await env.DB.batch(
    users.map(({ id, activeLimit }) =>
      env.DB
        .prepare("INSERT INTO users (id, active_limit) VALUES (?, ?)")
        .bind(id, activeLimit),
    ),
  );
}

const acquireLicenseSql = `
  INSERT INTO fanmark_licenses (
    id,
    user_id,
    normalized_fanmark,
    display_fanmark,
    status,
    operation_id,
    created_at
  )
  SELECT ?, ?, ?, ?, 'active', ?, ?
  WHERE (
    SELECT COUNT(*)
    FROM fanmark_licenses
    WHERE user_id = ? AND status = 'active'
  ) < COALESCE((SELECT active_limit FROM users WHERE id = ?), 0)
    AND NOT EXISTS (
      SELECT 1
      FROM fanmark_licenses
      WHERE normalized_fanmark = ? AND status IN ('active', 'grace')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM fanmark_licenses
      WHERE operation_id = ?
    )
`;

const auditAcquisitionSql = `
  INSERT OR IGNORE INTO acquisition_audit (
    id,
    operation_id,
    license_id,
    event_type,
    created_at
  )
  SELECT ?, operation_id, id, 'fanmark_acquired', ?
  FROM fanmark_licenses
  WHERE operation_id = ? AND status = 'active'
`;

async function acquireLicense({
  userId,
  normalizedFanmark,
  displayFanmark = normalizedFanmark,
  operationId,
  failAfterInsert = false,
}) {
  const licenseId = `license-${operationId}`;
  const auditId = `audit-${operationId}`;
  const statements = [
    env.DB
      .prepare(acquireLicenseSql)
      .bind(
        licenseId,
        userId,
        normalizedFanmark,
        displayFanmark,
        operationId,
        FIXED_TIME,
        userId,
        userId,
        normalizedFanmark,
        operationId,
      ),
  ];

  if (failAfterInsert) {
    statements.push(env.DB.prepare("INSERT INTO missing_table (id) VALUES (?)").bind("boom"));
  }

  statements.push(env.DB.prepare(auditAcquisitionSql).bind(auditId, FIXED_TIME, operationId));
  const [licenseResult, ...rest] = await env.DB.batch(statements);
  const auditResult = rest.at(-1);
  return {
    inserted: Number(licenseResult.meta?.changes ?? 0) === 1,
    auditInserted: Number(auditResult?.meta?.changes ?? 0) === 1,
    operationId,
  };
}

async function rows(sql, ...params) {
  const result = await env.DB.prepare(sql).bind(...params).all();
  return result.results;
}

async function count(sql, ...params) {
  const result = await env.DB.prepare(sql).bind(...params).first();
  return Number(result?.count ?? 0);
}

const claimCouponSql = `
  INSERT OR IGNORE INTO coupon_redemptions (
    id,
    coupon_id,
    user_id,
    operation_id,
    created_at
  )
  SELECT ?, ?, ?, ?, ?
  WHERE EXISTS (
    SELECT 1 FROM coupons WHERE id = ? AND remaining_uses > 0
  )
    AND NOT EXISTS (
      SELECT 1
      FROM coupon_redemptions
      WHERE coupon_id = ? AND user_id = ?
    )
`;

const consumeCouponSql = `
  UPDATE coupons
  SET remaining_uses = remaining_uses - 1
  WHERE id = ?
    AND remaining_uses > 0
    AND EXISTS (
      SELECT 1
      FROM coupon_redemptions
      WHERE operation_id = ?
        AND coupon_id = ?
        AND user_id = ?
        AND applied_at IS NULL
    )
`;

const markCouponAppliedSql = `
  UPDATE coupon_redemptions
  SET applied_at = ?
  WHERE operation_id = ?
    AND coupon_id = ?
    AND user_id = ?
    AND applied_at IS NULL
`;

async function claimCoupon({ couponId, userId, operationId }) {
  const [claimResult, consumeResult, appliedResult] = await env.DB.batch([
    env.DB
      .prepare(claimCouponSql)
      .bind(
        `redemption-${operationId}`,
        couponId,
        userId,
        operationId,
        FIXED_TIME,
        couponId,
        couponId,
        userId,
      ),
    env.DB.prepare(consumeCouponSql).bind(couponId, operationId, couponId, userId),
    env.DB.prepare(markCouponAppliedSql).bind(FIXED_TIME, operationId, couponId, userId),
  ]);
  return {
    claimed: Number(claimResult.meta?.changes ?? 0) === 1,
    consumed: Number(consumeResult.meta?.changes ?? 0) === 1,
    markedApplied: Number(appliedResult.meta?.changes ?? 0) === 1,
  };
}

const approveTransferSql = `
  UPDATE transfer_requests
  SET status = 'approved', approved_by = ?, approved_at = ?, approved_operation_id = ?
  WHERE id = ? AND status = 'pending'
`;

const auditTransferSql = `
  INSERT OR IGNORE INTO transfer_audit (id, request_id, event_type, created_at)
  SELECT ?, id, 'transfer_approved', ?
  FROM transfer_requests
  WHERE id = ? AND status = 'approved' AND approved_operation_id = ?
`;

async function approveTransfer({ requestId, actorId, operationId }) {
  const [updateResult, auditResult] = await env.DB.batch([
    env.DB
      .prepare(approveTransferSql)
      .bind(actorId, FIXED_TIME, operationId, requestId),
    env.DB
      .prepare(auditTransferSql)
      .bind(`transfer-audit-${operationId}`, FIXED_TIME, requestId, operationId),
  ]);
  return {
    approved: Number(updateResult.meta?.changes ?? 0) === 1,
    audited: Number(auditResult.meta?.changes ?? 0) === 1,
  };
}

beforeAll(executeSchema);
beforeEach(resetFixture);

describe("D1 acquisition invariants on an actual local binding", () => {
  it("allows only one normalized fanmark when different users race", async () => {
    await seedUsers([
      { id: USER_A, activeLimit: 2 },
      { id: USER_B, activeLimit: 2 },
    ]);

    const results = await Promise.all([
      acquireLicense({ userId: USER_A, normalizedFanmark: "normalized:rose", operationId: "same-a" }),
      acquireLicense({ userId: USER_B, normalizedFanmark: "normalized:rose", operationId: "same-b" }),
    ]);

    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(results.filter((result) => !result.inserted)).toHaveLength(1);
    expect(results.filter((result) => !result.inserted)[0].auditInserted).toBe(false);
    expect(await count("SELECT COUNT(*) AS count FROM fanmark_licenses WHERE status = 'active'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS count FROM acquisition_audit")).toBe(1);
  });

  it("allows only one of two different fanmarks when the same user has one slot", async () => {
    await seedUsers([{ id: USER_A, activeLimit: 1 }]);

    const results = await Promise.all([
      acquireLicense({ userId: USER_A, normalizedFanmark: "normalized:lemon", operationId: "slot-lemon" }),
      acquireLicense({ userId: USER_A, normalizedFanmark: "normalized:cedar", operationId: "slot-cedar" }),
    ]);

    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS count FROM fanmark_licenses WHERE user_id = ? AND status = 'active'", USER_A)).toBe(1);
    expect(await count("SELECT COUNT(*) AS count FROM acquisition_audit")).toBe(1);
  });

  it("does not acquire a fanmark while its license is in grace", async () => {
    await seedUsers([{ id: USER_A, activeLimit: 1 }]);
    await env.DB.prepare(
      `INSERT INTO fanmark_licenses
        (id, user_id, normalized_fanmark, display_fanmark, status, operation_id, created_at)
       VALUES (?, ?, ?, ?, 'grace', ?, ?)`,
    )
      .bind("grace-license", USER_A, "normalized:grace", "grace-display", "grace-operation", FIXED_TIME)
      .run();

    const result = await acquireLicense({
      userId: USER_B,
      normalizedFanmark: "normalized:grace",
      operationId: "grace-attempt",
    });

    expect(result).toMatchObject({ inserted: false, auditInserted: false });
    expect(await count("SELECT COUNT(*) AS count FROM fanmark_licenses WHERE status = 'active'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS count FROM acquisition_audit")).toBe(0);
  });

  it("retries the same operation without duplicating the license or audit", async () => {
    await seedUsers([{ id: USER_A, activeLimit: 2 }]);

    const first = await acquireLicense({
      userId: USER_A,
      normalizedFanmark: "normalized:iris",
      operationId: "retry-iris",
    });
    const retry = await acquireLicense({
      userId: USER_A,
      normalizedFanmark: "normalized:iris",
      operationId: "retry-iris",
    });

    expect(first).toMatchObject({ inserted: true, auditInserted: true });
    expect(retry).toMatchObject({ inserted: false, auditInserted: false });
    expect(await count("SELECT COUNT(*) AS count FROM fanmark_licenses")).toBe(1);
    expect(await count("SELECT COUNT(*) AS count FROM acquisition_audit")).toBe(1);
  });

  it("rolls back the insert when a later batch statement fails", async () => {
    await seedUsers([{ id: USER_A, activeLimit: 1 }]);

    await expect(
      acquireLicense({
        userId: USER_A,
        normalizedFanmark: "normalized:failed",
        operationId: "failed-operation",
        failAfterInsert: true,
      }),
    ).rejects.toThrow();

    expect(await count("SELECT COUNT(*) AS count FROM fanmark_licenses")).toBe(0);
    expect(await count("SELECT COUNT(*) AS count FROM acquisition_audit")).toBe(0);

    const retry = await acquireLicense({
      userId: USER_A,
      normalizedFanmark: "normalized:failed",
      operationId: "failed-operation",
    });
    expect(retry).toMatchObject({ inserted: true, auditInserted: true });
  });
});

describe("Small CAS fixtures", () => {
  it("consumes a single-use coupon once under concurrent claims", async () => {
    await seedUsers([
      { id: USER_A, activeLimit: 1 },
      { id: USER_B, activeLimit: 1 },
    ]);
    await env.DB.prepare("INSERT INTO coupons (id, remaining_uses) VALUES (?, 1)").bind("coupon-one").run();

    const results = await Promise.all([
      claimCoupon({ couponId: "coupon-one", userId: USER_A, operationId: "coupon-a" }),
      claimCoupon({ couponId: "coupon-one", userId: USER_B, operationId: "coupon-b" }),
    ]);

    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(results.filter((result) => result.consumed)).toHaveLength(1);
    expect(results.filter((result) => result.markedApplied)).toHaveLength(1);
    expect(await count("SELECT remaining_uses AS count FROM coupons WHERE id = ?", "coupon-one")).toBe(0);
    expect(await count("SELECT COUNT(*) AS count FROM coupon_redemptions")).toBe(1);
  });

  it("does not debit again when an operation is retried or reused for another coupon and user", async () => {
    await seedUsers([
      { id: USER_A, activeLimit: 1 },
      { id: USER_B, activeLimit: 1 },
    ]);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO coupons (id, remaining_uses) VALUES (?, 2)").bind("coupon-two"),
      env.DB.prepare("INSERT INTO coupons (id, remaining_uses) VALUES (?, 2)").bind("coupon-other"),
    ]);

    const first = await claimCoupon({ couponId: "coupon-two", userId: USER_A, operationId: "coupon-retry" });
    const retry = await claimCoupon({ couponId: "coupon-two", userId: USER_A, operationId: "coupon-retry" });
    const reused = await claimCoupon({ couponId: "coupon-other", userId: USER_B, operationId: "coupon-retry" });

    expect(first).toMatchObject({ claimed: true, consumed: true, markedApplied: true });
    expect(retry).toMatchObject({ claimed: false, consumed: false, markedApplied: false });
    expect(reused).toMatchObject({ claimed: false, consumed: false, markedApplied: false });
    expect(await count("SELECT remaining_uses AS count FROM coupons WHERE id = ?", "coupon-two")).toBe(1);
    expect(await count("SELECT remaining_uses AS count FROM coupons WHERE id = ?", "coupon-other")).toBe(2);
  });

  it("approves a pending transfer once with a compare-and-set update", async () => {
    await env.DB.prepare("INSERT INTO transfer_requests (id, status) VALUES (?, 'pending')").bind("transfer-one").run();

    const results = await Promise.all([
      approveTransfer({ requestId: "transfer-one", actorId: USER_A, operationId: "transfer-a" }),
      approveTransfer({ requestId: "transfer-one", actorId: USER_B, operationId: "transfer-b" }),
    ]);

    expect(results.filter((result) => result.approved)).toHaveLength(1);
    expect(results.filter((result) => result.audited)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS count FROM transfer_audit")).toBe(1);
    const request = await env.DB.prepare("SELECT status, approved_operation_id FROM transfer_requests WHERE id = ?").bind("transfer-one").first();
    expect(request?.status).toBe("approved");
    expect(["transfer-a", "transfer-b"]).toContain(request?.approved_operation_id);
  });
});
