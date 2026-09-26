export interface VerifiedStripeEventForD1 {
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
}

export interface StripeWebhookD1ReceiptResult {
  receiptId: string;
  dispatchId: string;
  outcome: "accepted" | "duplicate_nonterminal" | "duplicate_terminal";
  receiptStatus: string;
  dispatchStatus: string;
  deliveryCount: number;
}

export class StripeWebhookD1IngressError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "StripeWebhookD1IngressError";
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/u;
const TERMINAL_RECEIPT_STATUS = new Set(["applied", "ignored", "dead_letter"]);

function requiredText(value: unknown, code: string, maximum = 255): string {
  if (typeof value !== "string") throw new StripeWebhookD1IngressError(code);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) throw new StripeWebhookD1IngressError(code);
  return normalized;
}

function nullableText(value: unknown, code: string, maximum = 255): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new StripeWebhookD1IngressError(code);
  const normalized = value.trim();
  if (normalized.length > maximum) throw new StripeWebhookD1IngressError(code);
  return normalized || null;
}

function normalizeInput(input: VerifiedStripeEventForD1) {
  if (!input || typeof input !== "object") throw new StripeWebhookD1IngressError("invalid_event");
  const stripeEventId = requiredText(input.stripeEventId, "invalid_event_id");
  const eventType = requiredText(input.eventType, "invalid_event_type");
  if (typeof input.livemode !== "boolean") throw new StripeWebhookD1IngressError("invalid_livemode");
  if (!Number.isSafeInteger(input.normalizedSchemaVersion) || input.normalizedSchemaVersion < 1) {
    throw new StripeWebhookD1IngressError("invalid_schema_version");
  }
  if (!input.normalizedPayload || typeof input.normalizedPayload !== "object" || Array.isArray(input.normalizedPayload)) {
    throw new StripeWebhookD1IngressError("invalid_normalized_payload");
  }
  const normalizedPayload = JSON.stringify(input.normalizedPayload);
  if (typeof normalizedPayload !== "string" || new TextEncoder().encode(normalizedPayload).byteLength > 64 * 1024) {
    throw new StripeWebhookD1IngressError("normalized_payload_too_large");
  }
  const normalizedPayloadSha256 = requiredText(input.normalizedPayloadSha256, "invalid_normalized_payload_hash", 64);
  const rawPayloadSha256 = requiredText(input.rawPayloadSha256, "invalid_raw_payload_hash", 64);
  if (!SHA256_RE.test(normalizedPayloadSha256) || !SHA256_RE.test(rawPayloadSha256)) {
    throw new StripeWebhookD1IngressError("invalid_payload_hash");
  }
  return {
    stripeEventId,
    livemode: input.livemode ? 1 : 0,
    eventType,
    objectType: nullableText(input.objectType, "invalid_object_type"),
    objectId: nullableText(input.objectId, "invalid_object_id"),
    apiVersion: nullableText(input.apiVersion, "invalid_api_version"),
    normalizedSchemaVersion: input.normalizedSchemaVersion,
    normalizedPayload,
    normalizedPayloadSha256,
    rawPayloadSha256,
  };
}

function terminalDispatchState(receiptStatus: string, terminalAt: string | null) {
  if (receiptStatus === "applied" || receiptStatus === "ignored") {
    return { status: "completed", completedAt: terminalAt ?? new Date().toISOString() };
  }
  if (receiptStatus === "dead_letter") return { status: "dead_letter", completedAt: null };
  return { status: "pending", completedAt: null };
}

export async function acceptStripeWebhookReceiptIntoD1(args: {
  database: D1Database;
  event: VerifiedStripeEventForD1;
  now?: string;
  createId?: () => string;
}): Promise<StripeWebhookD1ReceiptResult> {
  const event = normalizeInput(args.event);
  const now = args.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new StripeWebhookD1IngressError("invalid_received_at");
  const createId = args.createId ?? (() => crypto.randomUUID());
  const proposedReceiptId = createId().toLowerCase();
  const proposedDispatchId = createId().toLowerCase();

  const receiptInsert = args.database.prepare(`
    INSERT INTO stripe_webhook_receipts (
      id, stripe_event_id, livemode, event_type, object_type, object_id, api_version,
      normalized_schema_version, normalized_payload, normalized_payload_sha256,
      raw_payload_sha256, status, delivery_count, first_received_at, last_received_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', 1, ?, ?, ?, ?)
    ON CONFLICT (livemode, stripe_event_id) DO UPDATE SET
      delivery_count = stripe_webhook_receipts.delivery_count + 1,
      last_received_at = excluded.last_received_at,
      updated_at = excluded.updated_at
    WHERE stripe_webhook_receipts.event_type = excluded.event_type
      AND stripe_webhook_receipts.object_type IS excluded.object_type
      AND stripe_webhook_receipts.object_id IS excluded.object_id
      AND stripe_webhook_receipts.api_version IS excluded.api_version
      AND stripe_webhook_receipts.normalized_schema_version = excluded.normalized_schema_version
      AND stripe_webhook_receipts.normalized_payload_sha256 = excluded.normalized_payload_sha256
      AND stripe_webhook_receipts.raw_payload_sha256 = excluded.raw_payload_sha256
      AND NOT EXISTS (
        SELECT 1
        FROM stripe_webhook_dispatches AS existing_dispatch
        WHERE existing_dispatch.receipt_id = stripe_webhook_receipts.id
          AND (
            (stripe_webhook_receipts.status NOT IN ('applied', 'ignored', 'dead_letter')
              AND existing_dispatch.status IN ('completed', 'dead_letter'))
            OR
            (stripe_webhook_receipts.status IN ('applied', 'ignored')
              AND (existing_dispatch.status <> 'completed'
                OR existing_dispatch.completed_at IS NOT stripe_webhook_receipts.terminal_at))
            OR
            (stripe_webhook_receipts.status = 'dead_letter'
              AND (existing_dispatch.status <> 'dead_letter' OR existing_dispatch.completed_at IS NOT NULL))
          )
      )
  `).bind(
    proposedReceiptId,
    event.stripeEventId,
    event.livemode,
    event.eventType,
    event.objectType,
    event.objectId,
    event.apiVersion,
    event.normalizedSchemaVersion,
    event.normalizedPayload,
    event.normalizedPayloadSha256,
    event.rawPayloadSha256,
    now,
    now,
    now,
    now,
  );

  const dispatchInsert = args.database.prepare(`
    INSERT INTO stripe_webhook_dispatches (
      id, receipt_id, stripe_event_id, livemode, status, available_at,
      completed_at, created_at, updated_at
    )
    SELECT ?, r.id, r.stripe_event_id, r.livemode,
      CASE
        WHEN r.status IN ('applied', 'ignored') THEN 'completed'
        WHEN r.status = 'dead_letter' THEN 'dead_letter'
        ELSE 'pending'
      END,
      ?,
      CASE
        WHEN r.status IN ('applied', 'ignored') THEN coalesce(r.terminal_at, ?)
        ELSE NULL
      END,
      ?, ?
    FROM stripe_webhook_receipts AS r
    WHERE r.livemode = ?
      AND r.stripe_event_id = ?
      AND r.event_type = ?
      AND r.object_type IS ?
      AND r.object_id IS ?
      AND r.api_version IS ?
      AND r.normalized_schema_version = ?
      AND r.normalized_payload_sha256 = ?
      AND r.raw_payload_sha256 = ?
    ON CONFLICT (receipt_id) DO NOTHING
  `).bind(
    proposedDispatchId,
    now,
    now,
    now,
    now,
    event.livemode,
    event.stripeEventId,
    event.eventType,
    event.objectType,
    event.objectId,
    event.apiVersion,
    event.normalizedSchemaVersion,
    event.normalizedPayloadSha256,
    event.rawPayloadSha256,
  );

  await args.database.batch([receiptInsert, dispatchInsert]);

  const persisted = await args.database.prepare(`
    SELECT r.id AS receipt_id, r.event_type, r.object_type, r.object_id, r.api_version,
      r.normalized_schema_version, r.normalized_payload_sha256, r.raw_payload_sha256,
      r.status AS receipt_status, r.terminal_at, r.delivery_count,
      d.id AS dispatch_id, d.status AS dispatch_status, d.completed_at
    FROM stripe_webhook_receipts AS r
    LEFT JOIN stripe_webhook_dispatches AS d
      ON d.receipt_id = r.id AND d.livemode = r.livemode AND d.stripe_event_id = r.stripe_event_id
    WHERE r.livemode = ? AND r.stripe_event_id = ?
  `).bind(event.livemode, event.stripeEventId).first<{
    receipt_id: string;
    event_type: string;
    object_type: string | null;
    object_id: string | null;
    api_version: string | null;
    normalized_schema_version: number;
    normalized_payload_sha256: string;
    raw_payload_sha256: string;
    receipt_status: string;
    terminal_at: string | null;
    delivery_count: number;
    dispatch_id: string | null;
    dispatch_status: string | null;
    completed_at: string | null;
  }>();

  if (!persisted) throw new StripeWebhookD1IngressError("receipt_readback_missing");
  if (
    persisted.event_type !== event.eventType ||
    persisted.object_type !== event.objectType ||
    persisted.object_id !== event.objectId ||
    persisted.api_version !== event.apiVersion ||
    persisted.normalized_schema_version !== event.normalizedSchemaVersion ||
    persisted.normalized_payload_sha256 !== event.normalizedPayloadSha256 ||
    persisted.raw_payload_sha256 !== event.rawPayloadSha256
  ) {
    throw new StripeWebhookD1IngressError("event_conflicts_with_immutable_receipt");
  }
  if (!persisted.dispatch_id || !persisted.dispatch_status) {
    throw new StripeWebhookD1IngressError("dispatch_readback_missing");
  }

  const receiptTerminal = TERMINAL_RECEIPT_STATUS.has(persisted.receipt_status);
  if (receiptTerminal) {
    const expected = terminalDispatchState(persisted.receipt_status, persisted.terminal_at);
    if (persisted.dispatch_status !== expected.status || persisted.completed_at !== expected.completedAt) {
      throw new StripeWebhookD1IngressError("terminal_receipt_dispatch_reconciliation_required");
    }
  } else if (persisted.dispatch_status === "completed" || persisted.dispatch_status === "dead_letter") {
    throw new StripeWebhookD1IngressError("nonterminal_receipt_dispatch_reconciliation_required");
  }

  return {
    receiptId: persisted.receipt_id,
    dispatchId: persisted.dispatch_id,
    outcome: persisted.receipt_id === proposedReceiptId
      ? "accepted"
      : receiptTerminal ? "duplicate_terminal" : "duplicate_nonterminal",
    receiptStatus: persisted.receipt_status,
    dispatchStatus: persisted.dispatch_status,
    deliveryCount: persisted.delivery_count,
  };
}
