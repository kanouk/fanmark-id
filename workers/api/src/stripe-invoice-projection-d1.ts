import {
  processStripeInvoiceDispatch,
  type ClaimedInvoiceDispatch,
  type InvoiceProjectionApplication,
  type InvoiceProjectionFence,
  type InvoiceProjectionRuntime,
  type StripeInvoiceProjectionProvider,
} from "../../../supabase/functions/_shared/stripe-invoice-projection/index.ts";
import type { StripeWebhookD1Claim } from "./stripe-webhook-d1-dispatch.ts";
import { retryStripeWebhookDispatchInD1 } from "./stripe-webhook-d1-dispatch.ts";

const FENCE_LEASE_SECONDS = 300;
const RETRY_AFTER_SECONDS = 60;
const MAX_GENERATION = Number.MAX_SAFE_INTEGER;

export interface StripeInvoiceD1ProjectionResult {
  status: "applied" | "retryable" | "stale";
  code: string;
  outcome?: string;
  applicationId?: string;
  currentInvoiceId?: string;
  invoiceAttemptKey?: string;
}

function isoTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error("invoice_projection_timestamp_invalid");
  }
  return parsed;
}

function requireText(value: unknown, code: string, maxLength = 512): string {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (normalized.length === 0 || new TextEncoder().encode(normalized).byteLength > maxLength) {
    throw new Error(code);
  }
  return normalized;
}

function requireGeneration(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_GENERATION) {
    throw new Error("invoice_projection_fence_shape_invalid");
  }
  return value as number;
}

function toClaimedDispatch(claim: StripeWebhookD1Claim): ClaimedInvoiceDispatch {
  return {
    receipt_id: claim.receiptId,
    dispatch_id: claim.dispatchId,
    stripe_event_id: claim.stripeEventId,
    livemode: claim.livemode,
    event_type: claim.eventType,
    object_type: claim.objectType,
    object_id: claim.objectId,
    api_version: claim.apiVersion,
    normalized_schema_version: claim.normalizedSchemaVersion,
    normalized_payload: claim.normalizedPayload,
    normalized_payload_sha256: claim.normalizedPayloadSha256,
    raw_payload_sha256: claim.rawPayloadSha256,
    attempt_count: claim.attemptCount,
    claim_generation: claim.claimGeneration,
    lease_token: claim.leaseToken,
    lease_until: claim.leaseUntil,
  };
}

export function createD1InvoiceProjectionRuntime(args: {
  database: D1Database;
  now: string;
  getNow?: () => string;
  createId?: () => string;
  createFenceToken?: () => string;
}): InvoiceProjectionRuntime {
  isoTimestamp(args.now);
  const currentNow = () => {
    const value = args.getNow?.() ?? new Date().toISOString();
    isoTimestamp(value);
    return value;
  };
  const createId = args.createId ?? (() => crypto.randomUUID());
  const createFenceToken = args.createFenceToken ?? (() => crypto.randomUUID());

  return {
    async acquireFence({ dispatch, stripeCustomerId }) {
      const customerId = requireText(stripeCustomerId, "invoice_customer_mapping_review_required", 255);
      const leaseToken = requireText(createFenceToken(), "invoice_projection_fence_token_invalid", 64);
      const now = currentNow();
      const leaseUntil = new Date(Date.parse(now) + FENCE_LEASE_SECONDS * 1000).toISOString();
      const row = await args.database.prepare(`
        INSERT INTO stripe_sync_fences (
          livemode, stripe_customer_id, owner_token, generation, lease_until,
          created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT (livemode, stripe_customer_id) DO UPDATE SET
          owner_token = excluded.owner_token,
          generation = stripe_sync_fences.generation + 1,
          lease_until = excluded.lease_until,
          last_error_code = NULL,
          updated_at = excluded.updated_at
        WHERE (stripe_sync_fences.lease_until IS NULL OR stripe_sync_fences.lease_until <= ?)
          AND stripe_sync_fences.generation < ?
        RETURNING livemode, stripe_customer_id, owner_token, generation, lease_until
      `).bind(
        dispatch.livemode ? 1 : 0, customerId, leaseToken, leaseUntil, now, now,
        now, MAX_GENERATION,
      ).first<Record<string, unknown>>();
      if (!row) return null;
      if (row.stripe_customer_id !== customerId || row.livemode !== (dispatch.livemode ? 1 : 0)) {
        throw new Error("invoice_projection_fence_identity_invalid");
      }
      return {
        stripe_customer_id: customerId,
        livemode: dispatch.livemode,
        fence_generation: requireGeneration(row.generation),
        fence_token: requireText(row.owner_token, "invoice_projection_fence_shape_invalid", 64),
        lease_until: requireText(row.lease_until, "invoice_projection_fence_shape_invalid", 64),
      };
    },

    async releaseFence({ dispatch, stripeCustomerId, fence }) {
      const now = currentNow();
      const result = await args.database.prepare(`
        UPDATE stripe_sync_fences
        SET owner_token = NULL, lease_until = NULL, updated_at = ?
        WHERE livemode = ? AND stripe_customer_id = ?
          AND owner_token = ? AND generation = ? AND lease_until > ?
          AND EXISTS (
            SELECT 1 FROM stripe_webhook_dispatches AS d
            WHERE d.id = ? AND d.receipt_id = ? AND d.livemode = ?
              AND d.status = 'processing' AND d.lease_token = ?
              AND d.claim_generation = ? AND d.lease_until > ?
          )
      `).bind(
        now, dispatch.livemode ? 1 : 0, stripeCustomerId, fence.fence_token,
        fence.fence_generation, now, dispatch.dispatch_id, dispatch.receipt_id,
        dispatch.livemode ? 1 : 0, dispatch.lease_token, dispatch.claim_generation,
        now,
      ).run();
      return result.meta.changes === 1;
    },

    async apply(input) {
      const { dispatch, stripeCustomerId, stripeSubscriptionId, sourceInvoiceId,
        currentInvoiceId, invoiceAttemptKey, fence, currentOutcome, currentInvoiceStatus,
        paymentIntentStatus, nextPaymentAttempt } = input;
      const now = currentNow();
      const applicationId = requireText(createId(), "invoice_projection_application_id_invalid", 64).toLowerCase();
      const livemode = dispatch.livemode ? 1 : 0;
      const effectKey = `invoice-projection:${dispatch.stripe_event_id}`;
      const parsed = JSON.stringify({
        source_event_type: dispatch.event_type,
        source_invoice_id: sourceInvoiceId,
        current_invoice_id: currentInvoiceId,
        invoice_attempt_key: invoiceAttemptKey,
        invoice_status: currentInvoiceStatus,
        payment_intent_status: paymentIntentStatus,
        outcome: currentOutcome,
      });

      const statements = [
        args.database.prepare(`
          INSERT INTO stripe_application_ledger (
            id, receipt_id, dispatch_id, stripe_event_id, livemode, effect_kind,
            effect_key, stripe_customer_id, stripe_subscription_id, source_invoice_id,
            current_invoice_id, invoice_attempt_key, local_user_id, fence_generation,
            input_hash, current_outcome, current_invoice_status, payment_intent_status,
            status, result_summary, attempt_count, created_at, updated_at
          )
          SELECT ?, r.id, d.id, r.stripe_event_id, r.livemode, 'invoice_projection',
            ?, ?, ?, ?, ?, ?, us.user_id, ?, r.normalized_payload_sha256, ?, ?, ?,
            'applying', ?, 1, ?, ?
          FROM stripe_webhook_receipts AS r
          JOIN stripe_webhook_dispatches AS d
            ON d.id = ? AND d.receipt_id = r.id AND d.livemode = r.livemode
              AND d.stripe_event_id = r.stripe_event_id
          JOIN user_settings AS us ON us.stripe_customer_id = ?
          JOIN user_subscriptions AS sub ON sub.user_id = us.user_id
            AND sub.stripe_customer_id = ? AND sub.stripe_subscription_id = ?
          JOIN stripe_sync_fences AS f ON f.livemode = r.livemode
            AND f.stripe_customer_id = ? AND f.owner_token = ? AND f.generation = ?
          WHERE r.id = ? AND r.livemode = ? AND r.status = 'processing'
            AND r.event_type = ? AND r.object_type = 'invoice' AND r.object_id = ?
            AND json_extract(r.normalized_payload, '$.branch') = 'invoice'
            AND json_extract(r.normalized_payload, '$.invoice.id') = ?
            AND json_extract(r.normalized_payload, '$.invoice.customer_id') = ?
            AND json_extract(r.normalized_payload, '$.invoice.subscription_id') = ?
            AND d.status = 'processing' AND d.lease_token = ?
            AND d.claim_generation = ? AND d.lease_until > ?
            AND f.lease_until > ?
            AND (SELECT count(*) FROM user_settings WHERE stripe_customer_id = ?) = 1
            AND (SELECT count(*) FROM user_subscriptions
              WHERE user_id = us.user_id AND stripe_customer_id = ?
                AND stripe_subscription_id = ?) = 1
        `).bind(
          applicationId, effectKey, stripeCustomerId, stripeSubscriptionId,
          sourceInvoiceId, currentInvoiceId, invoiceAttemptKey, fence.fence_generation,
          currentOutcome, currentInvoiceStatus, paymentIntentStatus, parsed,
          now, now, dispatch.dispatch_id, stripeCustomerId,
          stripeCustomerId, stripeSubscriptionId, stripeCustomerId, fence.fence_token,
          fence.fence_generation, dispatch.receipt_id, livemode, dispatch.event_type,
          sourceInvoiceId, sourceInvoiceId, stripeCustomerId, stripeSubscriptionId,
          dispatch.lease_token, dispatch.claim_generation, now, now,
          stripeCustomerId, stripeCustomerId, stripeSubscriptionId,
        ),
        args.database.prepare(`
          UPDATE user_subscriptions
          SET payment_failure_at = CASE WHEN ? = 'paid' THEN NULL ELSE ? END,
              next_payment_attempt = CASE
                WHEN ? = 'paid' OR ? = 'uncollectible' THEN NULL ELSE ? END,
              payment_failure_type = CASE
                WHEN ? = 'paid' THEN NULL
                WHEN ? = 'requires_action' THEN 'invoice.payment_action_required'
                ELSE 'invoice.payment_failed' END,
              updated_at = ?
          WHERE user_id = (SELECT local_user_id FROM stripe_application_ledger
            WHERE id = ? AND status = 'applying')
            AND stripe_customer_id = ? AND stripe_subscription_id = ?
            AND EXISTS (SELECT 1 FROM stripe_application_ledger
              WHERE id = ? AND status = 'applying')
        `).bind(
          currentOutcome, now, currentOutcome, currentOutcome, nextPaymentAttempt,
          currentOutcome, currentOutcome, now, applicationId,
          stripeCustomerId, stripeSubscriptionId, applicationId,
        ),
        args.database.prepare(`
          UPDATE stripe_application_ledger
          SET status = 'applied', applied_at = ?, updated_at = ?
          WHERE id = ? AND status = 'applying' AND changes() = 1
        `).bind(now, now, applicationId),
        args.database.prepare(`
          UPDATE stripe_sync_fences
          SET owner_token = NULL, lease_until = NULL,
              last_reconciled_at = ?, last_invoice_id = ?,
              last_invoice_attempt_key = ?, last_error_code = NULL, updated_at = ?
          WHERE livemode = ? AND stripe_customer_id = ?
            AND owner_token = ? AND generation = ? AND changes() = 1
        `).bind(
          now, currentInvoiceId, invoiceAttemptKey, now, livemode,
          stripeCustomerId, fence.fence_token, fence.fence_generation,
        ),
        args.database.prepare(`
          UPDATE stripe_webhook_dispatches
          SET status = 'completed', claimed_at = NULL, lease_until = NULL,
              lease_token = NULL, completed_at = ?, last_error_code = NULL,
              last_error_message = NULL, updated_at = ?
          WHERE id = ? AND receipt_id = ? AND livemode = ? AND status = 'processing'
            AND lease_token = ? AND claim_generation = ? AND lease_until > ?
            AND EXISTS (SELECT 1 FROM stripe_application_ledger
              WHERE id = ? AND status = 'applied')
        `).bind(
          now, now, dispatch.dispatch_id, dispatch.receipt_id, livemode,
          dispatch.lease_token, dispatch.claim_generation, now, applicationId,
        ),
        args.database.prepare(`
          UPDATE stripe_webhook_receipts
          SET status = 'applied', terminal_at = ?, last_error_code = NULL,
              last_error_message = NULL, updated_at = ?
          WHERE id = ? AND livemode = ? AND status = 'processing'
            AND EXISTS (SELECT 1 FROM stripe_application_ledger
              WHERE id = ? AND status = 'applied')
            AND EXISTS (SELECT 1 FROM stripe_webhook_dispatches
              WHERE id = ? AND status = 'completed' AND completed_at = ?)
        `).bind(now, now, dispatch.receipt_id, livemode, applicationId,
          dispatch.dispatch_id, now),
      ];

      const results = await args.database.batch(statements);
      if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1 ||
          results[2]?.meta.changes !== 1 || results[3]?.meta.changes !== 1 ||
          results[4]?.meta.changes !== 1 || results[5]?.meta.changes !== 1) {
        throw new Error("invoice_projection_transaction_precondition_failed");
      }
      const row = await args.database.prepare(`
        SELECT id AS application_id, receipt_id, dispatch_id, current_outcome AS outcome,
          status AS ledger_status, local_user_id, source_invoice_id, current_invoice_id,
          invoice_attempt_key, fence_generation
        FROM stripe_application_ledger WHERE id = ?
      `).bind(applicationId).first<Record<string, unknown>>();
      if (!row || row.ledger_status !== "applied") {
        throw new Error("invoice_projection_application_readback_failed");
      }
      const application: InvoiceProjectionApplication = {
        application_id: requireText(row.application_id, "invoice_projection_application_shape_invalid"),
        receipt_id: requireText(row.receipt_id, "invoice_projection_application_shape_invalid"),
        dispatch_id: requireText(row.dispatch_id, "invoice_projection_application_shape_invalid"),
        outcome: requireText(row.outcome, "invoice_projection_application_shape_invalid"),
        ledger_status: requireText(row.ledger_status, "invoice_projection_application_shape_invalid"),
        receipt_status: "applied",
        dispatch_status: "completed",
        local_user_id: requireText(row.local_user_id, "invoice_projection_application_shape_invalid"),
        source_invoice_id: requireText(row.source_invoice_id, "invoice_projection_application_shape_invalid"),
        current_invoice_id: requireText(row.current_invoice_id, "invoice_projection_application_shape_invalid"),
        invoice_attempt_key: requireText(row.invoice_attempt_key, "invoice_projection_application_shape_invalid"),
        fence_generation: requireGeneration(row.fence_generation),
      };
      return application;
    },

    async retry({ dispatch, errorCode }) {
      const now = currentNow();
      const retry = await retryStripeWebhookDispatchInD1({
        database: args.database,
        identity: {
          receiptId: dispatch.receipt_id,
          dispatchId: dispatch.dispatch_id,
          livemode: dispatch.livemode,
          leaseToken: dispatch.lease_token,
          claimGeneration: Number(dispatch.claim_generation),
        },
        now,
        retryAfterSeconds: RETRY_AFTER_SECONDS,
        errorCode,
      });
      return retry !== null;
    },
  };
}

export async function applyStripeInvoiceReceiptInD1(args: {
  database: D1Database;
  claim: StripeWebhookD1Claim;
  now: string;
  getNow?: () => string;
  provider: StripeInvoiceProjectionProvider;
  createId?: () => string;
  createFenceToken?: () => string;
}): Promise<StripeInvoiceD1ProjectionResult> {
  const runtime = createD1InvoiceProjectionRuntime(args);
  return processStripeInvoiceDispatch(toClaimedDispatch(args.claim), {
    provider: args.provider,
    runtime,
  });
}
