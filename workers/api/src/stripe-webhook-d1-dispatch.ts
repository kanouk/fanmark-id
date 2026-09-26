export class StripeWebhookD1DispatchError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "StripeWebhookD1DispatchError";
  }
}

export interface StripeWebhookD1Claim {
  receiptId: string;
  dispatchId: string;
  stripeEventId: string;
  livemode: boolean;
  eventType: string;
  objectType: string | null;
  objectId: string | null;
  apiVersion: string | null;
  normalizedSchemaVersion: number;
  normalizedPayload: Record<string, unknown>;
  normalizedPayloadSha256: string;
  rawPayloadSha256: string;
  attemptCount: number;
  claimGeneration: number;
  leaseToken: string;
  leaseUntil: string;
}

export interface StripeWebhookD1LeaseIdentity {
  receiptId: string;
  dispatchId: string;
  livemode: boolean;
  leaseToken: string;
  claimGeneration: number;
}

export interface StripeWebhookD1LeaseResult {
  receiptId: string;
  dispatchId: string;
  stripeEventId: string;
  livemode: boolean;
  receiptStatus: string;
  dispatchStatus: string;
  claimGeneration: number;
  leaseToken: string | null;
  leaseUntil: string | null;
  availableAt?: string;
  attemptCount?: number;
}

interface CandidateRow extends Record<string, unknown> {
  receipt_id: string;
  dispatch_id: string;
  stripe_event_id: string;
  livemode: number;
  event_type: string;
  object_type: string | null;
  object_id: string | null;
  api_version: string | null;
  normalized_schema_version: number;
  normalized_payload: string;
  normalized_payload_sha256: string;
  raw_payload_sha256: string;
  receipt_status: string;
  dispatch_status: string;
  attempt_count: number;
  claim_generation: number;
  available_at: string;
  lease_until: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HASH_RE = /^[0-9a-f]{64}$/u;
const MAX_CLAIM_GENERATION = Number.MAX_SAFE_INTEGER;

function timestamp(value: string | undefined): string {
  const normalized = value ?? new Date().toISOString();
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) {
    throw new StripeWebhookD1DispatchError("invalid_timestamp");
  }
  return normalized;
}

function requireMode(value: unknown): number {
  if (typeof value !== "boolean") throw new StripeWebhookD1DispatchError("invalid_livemode");
  return value ? 1 : 0;
}

function safeInteger(value: unknown, code: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new StripeWebhookD1DispatchError(code);
  }
  return value as number;
}

function requireUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new StripeWebhookD1DispatchError(code);
  return value.toLowerCase();
}

function errorText(value: string | null | undefined, code: string, maxBytes: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new StripeWebhookD1DispatchError(code);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function queuedPayload(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new StripeWebhookD1DispatchError("invalid_queued_payload");
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new StripeWebhookD1DispatchError("invalid_queued_payload");
  }
  return parsed as Record<string, unknown>;
}

function mapClaim(row: CandidateRow, leaseToken: string, leaseUntil: string, alreadyClaimed = false): StripeWebhookD1Claim {
  if (
    !UUID_RE.test(row.receipt_id) || !UUID_RE.test(row.dispatch_id) ||
    typeof row.stripe_event_id !== "string" || typeof row.event_type !== "string" ||
    !Number.isSafeInteger(row.normalized_schema_version) || row.normalized_schema_version < 1 ||
    !Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0 ||
    !Number.isSafeInteger(row.claim_generation) || row.claim_generation < 0 ||
    !HASH_RE.test(row.normalized_payload_sha256) || !HASH_RE.test(row.raw_payload_sha256)
  ) throw new StripeWebhookD1DispatchError("invalid_queued_receipt");
  return {
    receiptId: row.receipt_id,
    dispatchId: row.dispatch_id,
    stripeEventId: row.stripe_event_id,
    livemode: row.livemode === 1,
    eventType: row.event_type,
    objectType: row.object_type,
    objectId: row.object_id,
    apiVersion: row.api_version,
    normalizedSchemaVersion: row.normalized_schema_version,
    normalizedPayload: queuedPayload(row.normalized_payload),
    normalizedPayloadSha256: row.normalized_payload_sha256,
    rawPayloadSha256: row.raw_payload_sha256,
    attemptCount: row.attempt_count + (alreadyClaimed ? 0 : 1),
    claimGeneration: row.claim_generation + (alreadyClaimed ? 0 : 1),
    leaseToken,
    leaseUntil,
  };
}

export async function claimStripeWebhookDispatchesFromD1(args: {
  database: D1Database;
  livemode: boolean;
  batchSize?: number;
  leaseSeconds?: number;
  now?: string;
  createLeaseToken?: () => string;
}): Promise<StripeWebhookD1Claim[]> {
  const livemode = requireMode(args.livemode);
  const batchSize = safeInteger(args.batchSize ?? 10, "invalid_batch_size", 1, 100);
  const leaseSeconds = safeInteger(args.leaseSeconds ?? 300, "invalid_lease_duration", 1, 3600);
  const now = timestamp(args.now);
  const nowMs = Date.parse(now);
  const leaseUntil = new Date(nowMs + leaseSeconds * 1000).toISOString();
  const createLeaseToken = args.createLeaseToken ?? (() => crypto.randomUUID());
  const candidates = await args.database.prepare(`
    SELECT r.id AS receipt_id, d.id AS dispatch_id, r.stripe_event_id, r.livemode,
      r.event_type, r.object_type, r.object_id, r.api_version,
      r.normalized_schema_version, r.normalized_payload,
      r.normalized_payload_sha256, r.raw_payload_sha256, r.status AS receipt_status,
      d.status AS dispatch_status, d.attempt_count, d.claim_generation,
      d.available_at, d.lease_until
    FROM stripe_webhook_receipts AS r
    JOIN stripe_webhook_dispatches AS d
      ON d.receipt_id = r.id AND d.livemode = r.livemode AND d.stripe_event_id = r.stripe_event_id
    WHERE r.livemode = ?
      AND r.status IN ('received', 'retryable', 'processing')
      AND (
        (d.status IN ('pending', 'retryable') AND d.available_at <= ?)
        OR (d.status = 'processing' AND d.lease_until IS NOT NULL AND d.lease_until <= ?)
      )
    ORDER BY r.last_received_at, r.id
    LIMIT ?
  `).bind(livemode, now, now, batchSize).all<CandidateRow>();

  const selected = candidates.results ?? [];
  if (selected.length === 0) return [];
  if (selected.length > batchSize) throw new StripeWebhookD1DispatchError("invalid_candidate_batch");
  const leaseTokens = selected.map(() => requireUuid(createLeaseToken(), "invalid_lease_token"));
  if (new Set(leaseTokens).size !== leaseTokens.length) throw new StripeWebhookD1DispatchError("duplicate_lease_token");
  const claims = selected.map((row, index) => mapClaim(row, leaseTokens[index], leaseUntil));
  for (const claim of claims) {
    if (claim.claimGeneration > MAX_CLAIM_GENERATION || claim.attemptCount > MAX_CLAIM_GENERATION) {
      throw new StripeWebhookD1DispatchError("claim_counter_exhausted");
    }
  }

  const statements: D1PreparedStatement[] = [];
  for (const claim of claims) {
    const candidate = selected.find((row) => row.dispatch_id === claim.dispatchId) as CandidateRow;
    statements.push(args.database.prepare(`
      UPDATE stripe_webhook_dispatches
      SET status = 'processing', attempt_count = attempt_count + 1,
          claimed_at = ?, lease_until = ?, lease_token = ?,
          claim_generation = claim_generation + 1, updated_at = ?
      WHERE id = ? AND receipt_id = ? AND livemode = ? AND stripe_event_id = ?
        AND claim_generation = ?
        AND (
          (status IN ('pending', 'retryable') AND available_at <= ?)
          OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until <= ?)
        )
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_receipts AS r
          WHERE r.id = stripe_webhook_dispatches.receipt_id
            AND r.status IN ('received', 'retryable', 'processing')
        )
      RETURNING id
    `).bind(
      now, leaseUntil, claim.leaseToken, now,
      claim.dispatchId, claim.receiptId, livemode, claim.stripeEventId,
      candidate.claim_generation, now, now,
    ));
    statements.push(args.database.prepare(`
      UPDATE stripe_webhook_receipts
      SET status = 'processing', updated_at = ?
      WHERE id = ? AND livemode = ? AND stripe_event_id = ?
        AND status IN ('received', 'retryable', 'processing')
        AND changes() = 1
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = stripe_webhook_receipts.id
            AND d.status = 'processing' AND d.lease_token = ?
            AND d.claim_generation = ? AND d.lease_until = ?
        )
      RETURNING id
    `).bind(
      now, claim.receiptId, livemode, claim.stripeEventId,
      claim.dispatchId, claim.leaseToken, claim.claimGeneration, leaseUntil,
    ));
  }
  const updates = await args.database.batch(statements);
  const readbacks = await args.database.batch(claims.map((claim) => args.database.prepare(`
    SELECT r.id AS receipt_id, d.id AS dispatch_id, r.stripe_event_id, r.livemode,
      r.event_type, r.object_type, r.object_id, r.api_version,
      r.normalized_schema_version, r.normalized_payload,
      r.normalized_payload_sha256, r.raw_payload_sha256,
      d.attempt_count, d.claim_generation, d.lease_token, d.lease_until
    FROM stripe_webhook_receipts AS r
    JOIN stripe_webhook_dispatches AS d
      ON d.receipt_id = r.id AND d.livemode = r.livemode AND d.stripe_event_id = r.stripe_event_id
    WHERE r.id = ? AND d.id = ? AND r.status = 'processing' AND d.status = 'processing'
      AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until = ?
  `).bind(claim.receiptId, claim.dispatchId, claim.leaseToken, claim.claimGeneration, leaseUntil)));

  const claimed: StripeWebhookD1Claim[] = [];
  for (let index = 0; index < claims.length; index += 1) {
    const result = readbacks[index];
    const row = result?.results?.[0] as CandidateRow & { lease_token: string; lease_until: string } | undefined;
    if (!row) continue;
    if (updates[index * 2]?.meta?.changes !== 1 || updates[index * 2 + 1]?.meta?.changes !== 1) {
      throw new StripeWebhookD1DispatchError("claim_state_not_atomic");
    }
    claimed.push(mapClaim(row, row.lease_token, row.lease_until, true));
  }
  return claimed;
}

export async function renewStripeWebhookDispatchLeaseInD1(args: {
  database: D1Database;
  identity: StripeWebhookD1LeaseIdentity;
  leaseSeconds?: number;
  now?: string;
}): Promise<StripeWebhookD1LeaseResult | null> {
  const receiptId = requireUuid(args.identity.receiptId, "invalid_receipt_id");
  const dispatchId = requireUuid(args.identity.dispatchId, "invalid_dispatch_id");
  const leaseToken = requireUuid(args.identity.leaseToken, "invalid_lease_token");
  const claimGeneration = safeInteger(args.identity.claimGeneration, "invalid_claim_generation", 1, MAX_CLAIM_GENERATION);
  const livemode = requireMode(args.identity.livemode);
  const leaseSeconds = safeInteger(args.leaseSeconds ?? 300, "invalid_lease_duration", 1, 3600);
  const now = timestamp(args.now);
  const proposedUntil = new Date(Date.parse(now) + leaseSeconds * 1000).toISOString();
  const results = await args.database.batch([
    args.database.prepare(`
      UPDATE stripe_webhook_dispatches
      SET lease_until = CASE WHEN lease_until > ? THEN lease_until ELSE ? END, updated_at = ?
      WHERE id = ? AND receipt_id = ? AND livemode = ? AND status = 'processing'
        AND lease_token = ? AND claim_generation = ? AND lease_until IS NOT NULL AND lease_until > ?
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_receipts AS r
          WHERE r.id = stripe_webhook_dispatches.receipt_id
            AND r.livemode = stripe_webhook_dispatches.livemode
            AND r.stripe_event_id = stripe_webhook_dispatches.stripe_event_id
            AND r.status = 'processing'
        )
      RETURNING id
    `).bind(
      proposedUntil, proposedUntil, now, dispatchId, receiptId, livemode,
      leaseToken, claimGeneration, now,
    ),
  ]);
  if (results[0]?.meta?.changes !== 1) return null;
  const row = await args.database.prepare(`
    SELECT r.id AS receipt_id, d.id AS dispatch_id, r.stripe_event_id,
      r.livemode, r.status AS receipt_status, d.status AS dispatch_status,
      d.claim_generation, d.lease_token, d.lease_until
    FROM stripe_webhook_receipts AS r
    JOIN stripe_webhook_dispatches AS d
      ON d.receipt_id = r.id AND d.livemode = r.livemode AND d.stripe_event_id = r.stripe_event_id
    WHERE r.id = ? AND d.id = ? AND r.status = 'processing' AND d.status = 'processing'
      AND d.lease_token = ? AND d.claim_generation = ?
  `).bind(receiptId, dispatchId, leaseToken, claimGeneration).first<{
    receipt_id: string;
    dispatch_id: string;
    stripe_event_id: string;
    livemode: number;
    receipt_status: string;
    dispatch_status: string;
    claim_generation: number;
    lease_token: string;
    lease_until: string;
  }>();
  if (!row) return null;
  return {
    receiptId: row.receipt_id,
    dispatchId: row.dispatch_id,
    stripeEventId: row.stripe_event_id,
    livemode: row.livemode === 1,
    receiptStatus: row.receipt_status,
    dispatchStatus: row.dispatch_status,
    claimGeneration: row.claim_generation,
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until,
  };
}

export async function retryStripeWebhookDispatchInD1(args: {
  database: D1Database;
  identity: StripeWebhookD1LeaseIdentity;
  retryAfterSeconds?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  now?: string;
}): Promise<StripeWebhookD1LeaseResult | null> {
  const receiptId = requireUuid(args.identity.receiptId, "invalid_receipt_id");
  const dispatchId = requireUuid(args.identity.dispatchId, "invalid_dispatch_id");
  const leaseToken = requireUuid(args.identity.leaseToken, "invalid_lease_token");
  const claimGeneration = safeInteger(args.identity.claimGeneration, "invalid_claim_generation", 1, MAX_CLAIM_GENERATION);
  const livemode = requireMode(args.identity.livemode);
  const retryAfterSeconds = safeInteger(args.retryAfterSeconds ?? 0, "invalid_retry_delay", 0, 86400);
  const errorCode = errorText(args.errorCode, "invalid_error_code", 128);
  const errorMessage = errorText(args.errorMessage, "invalid_error_message", 1000);
  const now = timestamp(args.now);
  const availableAt = new Date(Date.parse(now) + retryAfterSeconds * 1000).toISOString();
  const results = await args.database.batch([
    args.database.prepare(`
      UPDATE stripe_webhook_dispatches
      SET status = 'retryable', available_at = ?, claimed_at = NULL,
          lease_until = NULL, lease_token = NULL, last_error_code = ?,
          last_error_message = ?, updated_at = ?
      WHERE id = ? AND receipt_id = ? AND livemode = ? AND status = 'processing'
        AND lease_token = ? AND claim_generation = ?
        AND lease_until IS NOT NULL AND lease_until > ?
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_receipts AS r
          WHERE r.id = stripe_webhook_dispatches.receipt_id
            AND r.livemode = stripe_webhook_dispatches.livemode
            AND r.stripe_event_id = stripe_webhook_dispatches.stripe_event_id
            AND r.status = 'processing'
        )
      RETURNING id
    `).bind(
      availableAt, errorCode, errorMessage, now, dispatchId, receiptId,
      livemode, leaseToken, claimGeneration, now,
    ),
    args.database.prepare(`
      UPDATE stripe_webhook_receipts
      SET status = 'retryable', last_error_code = ?, last_error_message = ?, updated_at = ?
      WHERE id = ? AND livemode = ? AND status = 'processing' AND changes() = 1
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = stripe_webhook_receipts.id
            AND d.status = 'retryable' AND d.lease_token IS NULL
            AND d.claim_generation = ? AND d.available_at = ? AND d.updated_at = ?
        )
      RETURNING id
    `).bind(errorCode, errorMessage, now, receiptId, livemode, dispatchId,
      claimGeneration, availableAt, now),
  ]);
  if (results[0]?.meta?.changes !== 1) return null;
  if (results[1]?.meta?.changes !== 1) throw new StripeWebhookD1DispatchError("retry_state_not_atomic");
  const row = await args.database.prepare(`
    SELECT r.id AS receipt_id, d.id AS dispatch_id, r.stripe_event_id,
      r.livemode, r.status AS receipt_status, d.status AS dispatch_status,
      d.claim_generation, d.attempt_count, d.available_at
    FROM stripe_webhook_receipts AS r
    JOIN stripe_webhook_dispatches AS d
      ON d.receipt_id = r.id AND d.livemode = r.livemode AND d.stripe_event_id = r.stripe_event_id
    WHERE r.id = ? AND d.id = ? AND r.status = 'retryable' AND d.status = 'retryable'
      AND d.claim_generation = ? AND d.available_at = ?
  `).bind(receiptId, dispatchId, claimGeneration, availableAt).first<{
    receipt_id: string;
    dispatch_id: string;
    stripe_event_id: string;
    livemode: number;
    receipt_status: string;
    dispatch_status: string;
    claim_generation: number;
    attempt_count: number;
    available_at: string;
  }>();
  if (!row) return null;
  return {
    receiptId: row.receipt_id,
    dispatchId: row.dispatch_id,
    stripeEventId: row.stripe_event_id,
    livemode: row.livemode === 1,
    receiptStatus: row.receipt_status,
    dispatchStatus: row.dispatch_status,
    claimGeneration: row.claim_generation,
    leaseToken: null,
    leaseUntil: null,
    availableAt: row.available_at,
    attemptCount: row.attempt_count,
  };
}

export async function deadLetterStripeWebhookDispatchInD1(args: {
  database: D1Database;
  identity: StripeWebhookD1LeaseIdentity;
  errorCode: string;
  errorMessage?: string | null;
  now?: string;
}): Promise<StripeWebhookD1LeaseResult | null> {
  const receiptId = requireUuid(args.identity.receiptId, "invalid_receipt_id");
  const dispatchId = requireUuid(args.identity.dispatchId, "invalid_dispatch_id");
  const leaseToken = requireUuid(args.identity.leaseToken, "invalid_lease_token");
  const claimGeneration = safeInteger(args.identity.claimGeneration, "invalid_claim_generation", 1, MAX_CLAIM_GENERATION);
  const livemode = requireMode(args.identity.livemode);
  const errorCode = errorText(args.errorCode, "invalid_error_code", 128);
  if (!errorCode) throw new StripeWebhookD1DispatchError("invalid_error_code");
  const errorMessage = errorText(args.errorMessage ?? null, "invalid_error_message", 1000);
  const now = timestamp(args.now);
  const results = await args.database.batch([
    args.database.prepare(`
      UPDATE stripe_webhook_dispatches
      SET status = 'dead_letter', claimed_at = NULL, lease_until = NULL, lease_token = NULL,
          last_error_code = ?, last_error_message = ?, updated_at = ?
      WHERE id = ? AND receipt_id = ? AND livemode = ? AND status = 'processing'
        AND lease_token = ? AND claim_generation = ? AND lease_until IS NOT NULL AND lease_until > ?
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_receipts AS r
          WHERE r.id = stripe_webhook_dispatches.receipt_id
            AND r.livemode = stripe_webhook_dispatches.livemode
            AND r.stripe_event_id = stripe_webhook_dispatches.stripe_event_id
            AND r.status = 'processing'
        )
      RETURNING id
    `).bind(errorCode, errorMessage, now, dispatchId, receiptId, livemode,
      leaseToken, claimGeneration, now),
    args.database.prepare(`
      UPDATE stripe_webhook_receipts
      SET status = 'dead_letter', terminal_at = ?, last_error_code = ?,
          last_error_message = ?, updated_at = ?
      WHERE id = ? AND livemode = ? AND status = 'processing' AND changes() = 1
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = stripe_webhook_receipts.id
            AND d.status = 'dead_letter' AND d.claim_generation = ?
            AND d.last_error_code = ? AND d.updated_at = ?
        )
      RETURNING id
    `).bind(now, errorCode, errorMessage, now, receiptId, livemode,
      dispatchId, claimGeneration, errorCode, now),
  ]);
  if (results[0]?.meta?.changes !== 1) return null;
  if (results[1]?.meta?.changes !== 1) {
    throw new StripeWebhookD1DispatchError("dead_letter_state_not_atomic");
  }
  const row = await args.database.prepare(`
    SELECT r.id AS receipt_id, d.id AS dispatch_id, r.stripe_event_id,
      r.livemode, r.status AS receipt_status, d.status AS dispatch_status,
      d.claim_generation, d.attempt_count
    FROM stripe_webhook_receipts AS r
    JOIN stripe_webhook_dispatches AS d
      ON d.receipt_id = r.id AND d.livemode = r.livemode AND d.stripe_event_id = r.stripe_event_id
    WHERE r.id = ? AND d.id = ? AND r.status = 'dead_letter' AND d.status = 'dead_letter'
      AND d.claim_generation = ? AND r.terminal_at = ? AND d.last_error_code = ?
  `).bind(receiptId, dispatchId, claimGeneration, now, errorCode).first<{
    receipt_id: string;
    dispatch_id: string;
    stripe_event_id: string;
    livemode: number;
    receipt_status: string;
    dispatch_status: string;
    claim_generation: number;
    attempt_count: number;
  }>();
  if (!row) return null;
  return {
    receiptId: row.receipt_id,
    dispatchId: row.dispatch_id,
    stripeEventId: row.stripe_event_id,
    livemode: row.livemode === 1,
    receiptStatus: row.receipt_status,
    dispatchStatus: row.dispatch_status,
    claimGeneration: row.claim_generation,
    leaseToken: null,
    leaseUntil: null,
    attemptCount: row.attempt_count,
  };
}
