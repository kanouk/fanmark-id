/**
 * Receipt-worker primitives for the non-granting Stripe invoice projection.
 *
 * The provider pins each Stripe request to the Basil API version and the
 * caller supplies a claimed dispatch row. This module acquires a customer fence before
 * remote reads, verifies the current invoice/subscription identities, and
 * delegates the final state transition to one service-only SQL transaction.
 * It never creates a Stripe object, grants a license, changes plan_type, or
 * sends a notification.
 */

export const PINNED_STRIPE_API_VERSION = "2025-08-27.basil" as const;

const INVOICE_EVENT_TYPES = new Set([
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.payment_succeeded",
]);

const RETRY_MESSAGE = "Invoice projection requires retry or review";
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

export type InvoiceProjectionOutcome =
  | "paid"
  | "payment_failed"
  | "requires_action"
  | "uncollectible";

export type InvoiceProjectionResult = {
  status: "applied" | "retryable" | "stale";
  code: string;
  outcome?: InvoiceProjectionOutcome;
  applicationId?: string;
  currentInvoiceId?: string;
  invoiceAttemptKey?: string;
};

export interface ClaimedInvoiceDispatch {
  receipt_id: string;
  dispatch_id: string;
  stripe_event_id: string;
  livemode: boolean;
  event_type: string;
  object_type: string | null;
  object_id: string | null;
  api_version: string | null;
  normalized_schema_version: number;
  normalized_payload: Record<string, unknown>;
  normalized_payload_sha256: string;
  raw_payload_sha256: string;
  attempt_count: number;
  claim_generation: number | string;
  lease_token: string;
  lease_until: string;
}

export interface StripeInvoiceProjectionRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface StripeInvoiceProjectionProvider {
  retrieveInvoice(invoiceId: string): PromiseLike<unknown>;
  retrieveSubscription(subscriptionId: string): PromiseLike<unknown>;
}

/**
 * Structural surface accepted by the helper below. The narrow signatures
 * keep this module compatible with Stripe 18.5.0 in both Deno and Node while
 * requiring per-request API-version options.
 */
export interface StripeInvoiceApiClient {
  invoices: {
    retrieve: (
      id: string,
      params: { expand: string[] },
      options: { apiVersion: typeof PINNED_STRIPE_API_VERSION },
    ) => PromiseLike<unknown>;
  };
  subscriptions: {
    retrieve: (
      id: string,
      params: { expand: string[] },
      options: { apiVersion: typeof PINNED_STRIPE_API_VERSION },
    ) => PromiseLike<unknown>;
  };
}

export const STRIPE_INVOICE_EXPANSIONS = [
  "payments.data.payment.payment_intent",
] as const;

export const STRIPE_SUBSCRIPTION_EXPANSIONS = [
  "latest_invoice",
] as const;

export interface InvoiceProjectionFence {
  stripe_customer_id: string;
  livemode: boolean;
  fence_generation: number | string;
  fence_token: string;
  lease_until: string;
}

export interface InvoiceProjectionApplication {
  application_id: string;
  receipt_id: string;
  dispatch_id: string;
  outcome: string;
  ledger_status: string;
  receipt_status: string;
  dispatch_status: string;
  local_user_id: string;
  source_invoice_id: string;
  current_invoice_id: string;
  invoice_attempt_key: string;
  fence_generation: number | string;
}

type ParsedApplicationExpectation = {
  dispatch: ClaimedInvoiceDispatch;
  sourceInvoiceId: string;
  currentInvoiceId: string;
  invoiceAttemptKey: string;
  fenceGeneration: number | string;
  currentOutcome: InvoiceProjectionOutcome;
};

export interface InvoiceProjectionRuntime {
  acquireFence(input: {
    dispatch: ClaimedInvoiceDispatch;
    stripeCustomerId: string;
  }): Promise<InvoiceProjectionFence | null>;
  releaseFence(input: {
    dispatch: ClaimedInvoiceDispatch;
    stripeCustomerId: string;
    fence: InvoiceProjectionFence;
  }): Promise<boolean>;
  apply(input: {
    dispatch: ClaimedInvoiceDispatch;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    sourceInvoiceId: string;
    currentInvoiceId: string;
    invoiceAttemptKey: string;
    fence: InvoiceProjectionFence;
    currentOutcome: InvoiceProjectionOutcome;
    currentInvoiceStatus: string;
    paymentIntentStatus: string | null;
    nextPaymentAttempt: string | null;
  }): Promise<InvoiceProjectionApplication>;
  retry(input: {
    dispatch: ClaimedInvoiceDispatch;
    errorCode: string;
  }): Promise<boolean>;
}

export interface InvoiceProjectionRuntimeOptions {
  retryAfterSeconds?: number;
}

export class InvoiceProjectionError extends Error {
  readonly code: string;

  constructor(code: string, message = RETRY_MESSAGE) {
    super(message);
    this.name = "InvoiceProjectionError";
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, maxBytes = 512): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (new TextEncoder().encode(value).byteLength > maxBytes) return null;
  return value;
}

function idFrom(value: unknown): string | null {
  const direct = boundedString(value, 256);
  if (direct !== null) return direct;
  return boundedString(asRecord(value)?.id, 256);
}

function requireId(value: unknown, code: string): string {
  const id = idFrom(value);
  if (id === null) throw new InvoiceProjectionError(code);
  return id;
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  const record = asRecord(value);
  if (record === null) throw new InvoiceProjectionError(code);
  return record;
}

function requireMode(value: unknown, expected: boolean, code: string): void {
  if (typeof value !== "boolean" || value !== expected) {
    throw new InvoiceProjectionError(code);
  }
}

function requireObjectType(value: Record<string, unknown>, expected: string, code: string): void {
  if (value.object !== undefined && value.object !== expected) {
    throw new InvoiceProjectionError(code);
  }
}

function resolveBasilInvoiceSubscription(value: Record<string, unknown>, code: string): string {
  const parent = asRecord(value.parent);
  const details = asRecord(parent?.subscription_details);
  if (parent === null || parent.type !== "subscription_details" || details === null) {
    throw new InvoiceProjectionError(code);
  }
  if (!Object.prototype.hasOwnProperty.call(details, "subscription")) {
    throw new InvoiceProjectionError(code);
  }
  const subscription = details.subscription;
  const subscriptionId = idFrom(subscription);
  if (subscription === null || subscription === undefined || subscriptionId === null) {
    throw new InvoiceProjectionError(code);
  }
  // Basil moved the relationship under parent.subscription_details. A
  // non-null legacy top-level relationship is an incompatible/mixed-version
  // response, never a fallback source for a pinned request.
  if (Object.prototype.hasOwnProperty.call(value, "subscription")
    && value.subscription !== null && value.subscription !== undefined) {
    throw new InvoiceProjectionError(code);
  }
  return subscriptionId;
}

function readLatestInvoiceId(subscription: Record<string, unknown>): string {
  return requireId(subscription.latest_invoice, "invoice_latest_relation_review_required");
}

function readBasilPaymentIntent(
  invoice: Record<string, unknown>,
  expected: { invoiceId: string; customerId: string; livemode: boolean },
): { id: string | null; status: string | null } {
  if (Object.prototype.hasOwnProperty.call(invoice, "payment_intent")) {
    throw new InvoiceProjectionError("invoice_payment_relation_review_required");
  }
  const rawPayments = invoice.payments;
  if (rawPayments === null || rawPayments === undefined) return { id: null, status: null };
  const payments = asRecord(rawPayments);
  if (payments === null || payments.object !== "list") {
    throw new InvoiceProjectionError("invoice_payment_relation_review_required");
  }
  if (payments.has_more !== false) {
    throw new InvoiceProjectionError("invoice_payment_relation_review_required");
  }
  const data = payments.data;
  if (!Array.isArray(data)) {
    throw new InvoiceProjectionError("invoice_payment_relation_review_required");
  }
  const paymentIntents: Array<{
    id: string;
    status: string | null;
    invoicePaymentStatus: string;
  }> = [];
  let activePaymentCount = 0;
  for (const item of data) {
    const invoicePayment = asRecord(item);
    const payment = asRecord(invoicePayment?.payment);
    if (invoicePayment === null || payment === null) {
      throw new InvoiceProjectionError("invoice_payment_relation_review_required");
    }
    requireObjectType(invoicePayment, "invoice_payment", "invoice_payment_relation_review_required");
    if (requireId(invoicePayment.invoice, "invoice_payment_relation_review_required") !== expected.invoiceId) {
      throw new InvoiceProjectionError("invoice_payment_relation_review_required");
    }
    requireMode(invoicePayment.livemode, expected.livemode, "invoice_payment_relation_review_required");
    const invoicePaymentStatus = boundedString(invoicePayment.status, 64);
    if (invoicePaymentStatus === null
      || !new Set(["open", "paid", "canceled"]).has(invoicePaymentStatus)) {
      throw new InvoiceProjectionError("invoice_payment_relation_review_required");
    }
    if (invoicePaymentStatus === "open") activePaymentCount += 1;
    const type = boundedString(payment.type, 64);
    if (type === null) {
      throw new InvoiceProjectionError("invoice_payment_relation_review_required");
    }
    if (type !== "payment_intent") {
      if (type !== "charge") {
        throw new InvoiceProjectionError("invoice_payment_relation_review_required");
      }
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(payment, "payment_intent")
      || payment.payment_intent === null || payment.payment_intent === undefined) {
      throw new InvoiceProjectionError("invoice_payment_relation_review_required");
    }
    const paymentIntent = payment.payment_intent;
    const paymentIntentId = idFrom(paymentIntent);
    if (paymentIntentId === null) {
      throw new InvoiceProjectionError("invoice_payment_relation_review_required");
    }
    const expanded = asRecord(paymentIntent);
    if (expanded === null) {
      throw new InvoiceProjectionError("invoice_payment_relation_review_required");
    }
    requireObjectType(expanded, "payment_intent", "invoice_payment_relation_review_required");
    if (requireId(expanded.id, "invoice_payment_relation_review_required") !== paymentIntentId
      || requireId(expanded.customer, "invoice_payment_relation_review_required") !== expected.customerId) {
      throw new InvoiceProjectionError("invoice_payment_relation_review_required");
    }
    requireMode(expanded.livemode, expected.livemode, "invoice_payment_relation_review_required");
    const status = boundedString(expanded.status, 128);
    if (status === null) {
      throw new InvoiceProjectionError("invoice_payment_relation_review_required");
    }
    paymentIntents.push({ id: paymentIntentId, status, invoicePaymentStatus });
  }
  if (activePaymentCount > 1) {
    throw new InvoiceProjectionError("invoice_payment_relation_review_required");
  }
  if (boundedString(invoice.status, 128) === "open") {
    const active = paymentIntents.filter((payment) => payment.invoicePaymentStatus === "open");
    if (active.length !== 1) return { id: null, status: null };
    return active[0];
  }
  if (paymentIntents.length > 1) {
    throw new InvoiceProjectionError("invoice_payment_relation_review_required");
  }
  return paymentIntents[0] ?? { id: null, status: null };
}

function readNextPaymentAttempt(invoice: Record<string, unknown>): string | null {
  const value = invoice.next_payment_attempt;
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvoiceProjectionError("invoice_next_payment_attempt_review_required");
  }
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) {
    throw new InvoiceProjectionError("invoice_next_payment_attempt_review_required");
  }
  return date.toISOString();
}

function readAttemptCount(invoice: Record<string, unknown>): number | null {
  const value = invoice.attempt_count;
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvoiceProjectionError("invoice_attempt_count_review_required");
  }
  return value;
}

function classifyCurrentInvoice(
  invoiceStatus: string,
  paymentIntentStatus: string | null,
): InvoiceProjectionOutcome {
  switch (invoiceStatus) {
    case "paid":
      return "paid";
    case "uncollectible":
      return "uncollectible";
    case "void":
      throw new InvoiceProjectionError("invoice_void_lifecycle_review_required");
    case "open":
      if (paymentIntentStatus === "requires_action") return "requires_action";
      if (paymentIntentStatus === "requires_payment_method" || paymentIntentStatus === "canceled") {
        return "payment_failed";
      }
      throw new InvoiceProjectionError("invoice_current_state_review_required");
    default:
      throw new InvoiceProjectionError("invoice_current_state_review_required");
  }
}

function readSourceInvoice(
  dispatch: ClaimedInvoiceDispatch,
): { invoiceId: string; customerId: string; subscriptionId: string } {
  if (dispatch.normalized_schema_version !== 1) {
    throw new InvoiceProjectionError("invoice_schema_review_required");
  }
  if (!INVOICE_EVENT_TYPES.has(dispatch.event_type) || dispatch.object_type !== "invoice") {
    throw new InvoiceProjectionError("invoice_event_type_review_required");
  }
  const invoice = asRecord(dispatch.normalized_payload.invoice);
  const objectId = boundedString(dispatch.object_id, 256);
  const invoiceId = requireId(invoice?.id ?? objectId, "invoice_relation_review_required");
  if (objectId !== null && objectId !== invoiceId) {
    throw new InvoiceProjectionError("invoice_identity_review_required");
  }
  const customerId = requireId(invoice?.customer_id, "invoice_customer_mapping_review_required");
  const subscriptionId = requireId(invoice?.subscription_id, "invoice_relation_review_required");
  return { invoiceId, customerId, subscriptionId };
}

function verifyInvoice(
  rawInvoice: unknown,
  expected: { invoiceId: string; customerId: string; subscriptionId: string; livemode: boolean },
): Record<string, unknown> {
  const invoice = requireRecord(rawInvoice, "invoice_identity_review_required");
  requireObjectType(invoice, "invoice", "invoice_identity_review_required");
  if (requireId(invoice.id, "invoice_identity_review_required") !== expected.invoiceId) {
    throw new InvoiceProjectionError("invoice_identity_review_required");
  }
  requireMode(invoice.livemode, expected.livemode, "invoice_mode_review_required");
  if (requireId(invoice.customer, "invoice_customer_mapping_review_required") !== expected.customerId) {
    throw new InvoiceProjectionError("invoice_identity_review_required");
  }
  if (resolveBasilInvoiceSubscription(invoice, "invoice_relation_review_required") !== expected.subscriptionId) {
    throw new InvoiceProjectionError("invoice_identity_review_required");
  }
  return invoice;
}

function verifySubscription(
  rawSubscription: unknown,
  expected: { subscriptionId: string; customerId: string; livemode: boolean },
): Record<string, unknown> {
  const subscription = requireRecord(rawSubscription, "subscription_identity_review_required");
  requireObjectType(subscription, "subscription", "subscription_identity_review_required");
  if (requireId(subscription.id, "subscription_identity_review_required") !== expected.subscriptionId) {
    throw new InvoiceProjectionError("subscription_identity_review_required");
  }
  requireMode(subscription.livemode, expected.livemode, "subscription_mode_review_required");
  if (requireId(subscription.customer, "subscription_identity_review_required") !== expected.customerId) {
    throw new InvoiceProjectionError("subscription_identity_review_required");
  }
  readLatestInvoiceId(subscription);
  return subscription;
}

function makeInvoiceAttemptKey(
  invoiceId: string,
  paymentIntentId: string | null,
  attemptCount: number | null,
  outcome: InvoiceProjectionOutcome,
): string {
  const subject = paymentIntentId ?? `invoice:${invoiceId}`;
  const attempt = attemptCount === null ? "unknown" : String(attemptCount);
  const key = `${subject}:attempt:${attempt}:outcome:${outcome}`;
  if (new TextEncoder().encode(key).byteLength > 512) {
    throw new InvoiceProjectionError("invoice_attempt_key_review_required");
  }
  return key;
}

async function resolvePromise<T>(value: PromiseLike<T>): Promise<T> {
  return await value;
}

function rpcErrorCode(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    if (code === "P0002") return "invoice_customer_mapping_review_required";
    if (code === "P0003") return "invoice_subscription_mapping_review_required";
    if (code === "P0001") return "invoice_projection_retryable";
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(code)) {
      return `rpc_${code}`;
    }
  }
  return "invoice_projection_rpc_failed";
}

async function rpcRows(
  client: StripeInvoiceProjectionRpcClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown[]> {
  const response = await resolvePromise(client.rpc(functionName, args));
  if (response.error !== null && response.error !== undefined) {
    throw new InvoiceProjectionError(rpcErrorCode(response.error));
  }
  if (response.data === null || response.data === undefined) return [];
  if (!Array.isArray(response.data)) {
    throw new InvoiceProjectionError("invoice_projection_rpc_shape_invalid");
  }
  return response.data;
}

function oneRow<T extends object>(rows: unknown[], code: string): T {
  if (rows.length !== 1 || rows[0] === null || typeof rows[0] !== "object") {
    throw new InvoiceProjectionError(code);
  }
  return rows[0] as T;
}

function boundedGeneration(value: unknown, code: string): number | string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return value;
  throw new InvoiceProjectionError(code);
}

function requireRpcString(row: Record<string, unknown>, key: string, code: string): string {
  const value = boundedString(row[key]);
  if (value === null) throw new InvoiceProjectionError(code);
  return value;
}

function requireRpcTimestamp(row: Record<string, unknown>, key: string, code: string): string {
  const raw = row[key];
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
  return requireRpcString(row, key, code);
}

function parseFence(row: unknown): InvoiceProjectionFence {
  const value = requireRecord(row, "invoice_projection_rpc_shape_invalid");
  return {
    stripe_customer_id: requireRpcString(value, "stripe_customer_id", "invoice_projection_rpc_shape_invalid"),
    livemode: value.livemode === true || value.livemode === false
      ? value.livemode
      : (() => { throw new InvoiceProjectionError("invoice_projection_rpc_shape_invalid"); })(),
    fence_generation: boundedGeneration(value.fence_generation, "invoice_projection_rpc_shape_invalid"),
    fence_token: requireRpcString(value, "fence_token", "invoice_projection_rpc_shape_invalid"),
    lease_until: requireRpcTimestamp(value, "lease_until", "invoice_projection_rpc_shape_invalid"),
  };
}

function sameGeneration(left: number | string, right: number | string): boolean {
  return String(left) === String(right);
}

function parseApplication(
  row: unknown,
  expected: ParsedApplicationExpectation,
): InvoiceProjectionApplication {
  const value = requireRecord(row, "invoice_projection_rpc_shape_invalid");
  const parsed = {
    application_id: requireRpcString(value, "application_id", "invoice_projection_rpc_shape_invalid"),
    receipt_id: requireRpcString(value, "receipt_id", "invoice_projection_rpc_shape_invalid"),
    dispatch_id: requireRpcString(value, "dispatch_id", "invoice_projection_rpc_shape_invalid"),
    outcome: requireRpcString(value, "outcome", "invoice_projection_rpc_shape_invalid"),
    ledger_status: requireRpcString(value, "ledger_status", "invoice_projection_rpc_shape_invalid"),
    receipt_status: requireRpcString(value, "receipt_status", "invoice_projection_rpc_shape_invalid"),
    dispatch_status: requireRpcString(value, "dispatch_status", "invoice_projection_rpc_shape_invalid"),
    local_user_id: requireRpcString(value, "local_user_id", "invoice_projection_rpc_shape_invalid"),
    source_invoice_id: requireRpcString(value, "source_invoice_id", "invoice_projection_rpc_shape_invalid"),
    current_invoice_id: requireRpcString(value, "current_invoice_id", "invoice_projection_rpc_shape_invalid"),
    invoice_attempt_key: requireRpcString(value, "invoice_attempt_key", "invoice_projection_rpc_shape_invalid"),
    fence_generation: boundedGeneration(value.fence_generation, "invoice_projection_rpc_shape_invalid"),
  };
  const ledgerStatuses = new Set(["applied"]);
  const receiptStatuses = new Set(["applied"]);
  const dispatchStatuses = new Set(["completed"]);
  if (!ledgerStatuses.has(parsed.ledger_status)
    || !receiptStatuses.has(parsed.receipt_status)
    || !dispatchStatuses.has(parsed.dispatch_status)) {
    throw new InvoiceProjectionError("invoice_projection_rpc_shape_invalid");
  }
  if (parsed.receipt_id !== expected.dispatch.receipt_id
    || parsed.dispatch_id !== expected.dispatch.dispatch_id
    || parsed.source_invoice_id !== expected.sourceInvoiceId) {
    throw new InvoiceProjectionError("invoice_projection_rpc_shape_invalid");
  }
  if (parsed.outcome !== expected.currentOutcome && parsed.outcome !== "duplicate_applied") {
    throw new InvoiceProjectionError("invoice_projection_rpc_shape_invalid");
  }
  if (parsed.outcome !== "duplicate_applied"
    && !sameGeneration(parsed.fence_generation, expected.fenceGeneration)) {
    throw new InvoiceProjectionError("invoice_projection_rpc_shape_invalid");
  }
  if (parsed.outcome !== "duplicate_applied"
    && (parsed.source_invoice_id !== expected.sourceInvoiceId
      || parsed.current_invoice_id !== expected.currentInvoiceId
      || parsed.invoice_attempt_key !== expected.invoiceAttemptKey)) {
    throw new InvoiceProjectionError("invoice_projection_rpc_shape_invalid");
  }
  return parsed;
}

function parseRetryResult(
  row: unknown,
  dispatch: ClaimedInvoiceDispatch,
): boolean {
  const value = requireRecord(row, "invoice_projection_rpc_shape_invalid");
  const receiptId = requireRpcString(value, "receipt_id", "invoice_projection_rpc_shape_invalid");
  const dispatchId = requireRpcString(value, "dispatch_id", "invoice_projection_rpc_shape_invalid");
  const eventId = requireRpcString(value, "stripe_event_id", "invoice_projection_rpc_shape_invalid");
  const status = requireRpcString(value, "receipt_status", "invoice_projection_rpc_shape_invalid");
  const dispatchStatus = requireRpcString(value, "dispatch_status", "invoice_projection_rpc_shape_invalid");
  const generation = boundedGeneration(value.claim_generation, "invoice_projection_rpc_shape_invalid");
  const availableAt = requireRpcTimestamp(value, "available_at", "invoice_projection_rpc_shape_invalid");
  const attemptCount = value.attempt_count;
  if (receiptId !== dispatch.receipt_id || dispatchId !== dispatch.dispatch_id
    || eventId !== dispatch.stripe_event_id
    || (value.livemode !== undefined && value.livemode !== dispatch.livemode)
    || status !== "retryable" || dispatchStatus !== "retryable"
    || !sameGeneration(generation, dispatch.claim_generation)
    || !availableAt
    || typeof attemptCount !== "number" || !Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new InvoiceProjectionError("invoice_projection_rpc_shape_invalid");
  }
  return true;
}

export function createSupabaseInvoiceProjectionRuntime(
  client: StripeInvoiceProjectionRpcClient,
  options: InvoiceProjectionRuntimeOptions = {},
): InvoiceProjectionRuntime {
  const retryAfterSeconds = options.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
  if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 0 || retryAfterSeconds > 86400) {
    throw new InvoiceProjectionError("invoice_projection_runtime_options_invalid");
  }
  return {
    async acquireFence({ dispatch, stripeCustomerId }) {
      const rows = await rpcRows(client, "acquire_stripe_customer_fence", {
        p_receipt_id: dispatch.receipt_id,
        p_dispatch_id: dispatch.dispatch_id,
        p_livemode: dispatch.livemode,
        p_lease_token: dispatch.lease_token,
        p_claim_generation: dispatch.claim_generation,
        p_stripe_customer_id: stripeCustomerId,
        p_lease_seconds: 300,
      });
      return rows.length === 0 ? null : parseFence(oneRow(rows, "invoice_projection_rpc_shape_invalid"));
    },

    async releaseFence({ dispatch, stripeCustomerId, fence }) {
      const rows = await rpcRows(client, "release_stripe_customer_fence", {
        p_receipt_id: dispatch.receipt_id,
        p_dispatch_id: dispatch.dispatch_id,
        p_livemode: dispatch.livemode,
        p_lease_token: dispatch.lease_token,
        p_claim_generation: dispatch.claim_generation,
        p_stripe_customer_id: stripeCustomerId,
        p_fence_token: fence.fence_token,
        p_fence_generation: fence.fence_generation,
      });
      const row = oneRow<Record<string, unknown>>(rows, "invoice_projection_rpc_shape_invalid");
      if (typeof row.released !== "boolean") {
        throw new InvoiceProjectionError("invoice_projection_rpc_shape_invalid");
      }
      return row.released;
    },

    async apply({
      dispatch,
      stripeCustomerId,
      stripeSubscriptionId,
      sourceInvoiceId,
      currentInvoiceId,
      invoiceAttemptKey,
      fence,
      currentOutcome,
      currentInvoiceStatus,
      paymentIntentStatus,
      nextPaymentAttempt,
    }) {
      const rows = await rpcRows(client, "apply_stripe_invoice_projection", {
        p_receipt_id: dispatch.receipt_id,
        p_dispatch_id: dispatch.dispatch_id,
        p_livemode: dispatch.livemode,
        p_lease_token: dispatch.lease_token,
        p_claim_generation: dispatch.claim_generation,
        p_stripe_customer_id: stripeCustomerId,
        p_stripe_subscription_id: stripeSubscriptionId,
        p_source_invoice_id: sourceInvoiceId,
        p_current_invoice_id: currentInvoiceId,
        p_invoice_attempt_key: invoiceAttemptKey,
        p_fence_token: fence.fence_token,
        p_fence_generation: fence.fence_generation,
        p_source_event_type: dispatch.event_type,
        p_current_outcome: currentOutcome,
        p_current_invoice_status: currentInvoiceStatus,
        p_payment_intent_status: paymentIntentStatus,
        p_next_payment_attempt: nextPaymentAttempt,
      });
      return parseApplication(oneRow(rows, "invoice_projection_rpc_shape_invalid"), {
        dispatch,
        sourceInvoiceId,
        currentInvoiceId,
        invoiceAttemptKey,
        fenceGeneration: fence.fence_generation,
        currentOutcome,
      });
    },

    async retry({ dispatch, errorCode }) {
      const rows = await rpcRows(client, "retry_stripe_webhook_dispatch", {
        p_receipt_id: dispatch.receipt_id,
        p_dispatch_id: dispatch.dispatch_id,
        p_livemode: dispatch.livemode,
        p_lease_token: dispatch.lease_token,
        p_claim_generation: dispatch.claim_generation,
        p_retry_after_seconds: retryAfterSeconds,
        p_error_code: errorCode,
        p_error_message: RETRY_MESSAGE,
      });
      if (rows.length === 0) return false;
      if (rows.length !== 1) {
        throw new InvoiceProjectionError("invoice_projection_rpc_shape_invalid");
      }
      return parseRetryResult(rows[0], dispatch);
    },
  };
}

export function createStripeInvoiceProjectionProvider(
  stripe: StripeInvoiceApiClient,
): StripeInvoiceProjectionProvider {
  return {
    retrieveInvoice(invoiceId) {
      return stripe.invoices.retrieve(
        invoiceId,
        { expand: [...STRIPE_INVOICE_EXPANSIONS] },
        { apiVersion: PINNED_STRIPE_API_VERSION },
      );
    },
    retrieveSubscription(subscriptionId) {
      return stripe.subscriptions.retrieve(
        subscriptionId,
        { expand: [...STRIPE_SUBSCRIPTION_EXPANSIONS] },
        { apiVersion: PINNED_STRIPE_API_VERSION },
      );
    },
  };
}

async function retryAfterFailure(
  runtime: InvoiceProjectionRuntime,
  dispatch: ClaimedInvoiceDispatch,
  errorCode: string,
  fence: InvoiceProjectionFence | null,
  customerId: string | null,
): Promise<InvoiceProjectionResult> {
  if (fence !== null && customerId !== null) {
    try {
      await runtime.releaseFence({ dispatch, stripeCustomerId: customerId, fence });
    } catch {
      // The dispatch retry still carries the lease guard. A failed release is
      // safe because the fence has its own expiry and cannot be stolen by an
      // older generation.
    }
  }
  let retried: boolean;
  try {
    retried = await runtime.retry({ dispatch, errorCode });
  } catch {
    return { status: "retryable", code: "invoice_retry_persistence_failed" };
  }
  return retried
    ? { status: "retryable", code: errorCode }
    : { status: "stale", code: "invoice_projection_lease_stale" };
}

export async function processStripeInvoiceDispatch(
  dispatch: ClaimedInvoiceDispatch,
  dependencies: {
    provider: StripeInvoiceProjectionProvider;
    runtime: InvoiceProjectionRuntime;
  },
): Promise<InvoiceProjectionResult> {
  let source: { invoiceId: string; customerId: string; subscriptionId: string };
  try {
    source = readSourceInvoice(dispatch);
  } catch (error) {
    const projectionError = error instanceof InvoiceProjectionError
      ? error
      : new InvoiceProjectionError("invoice_relation_review_required");
    return retryAfterFailure(dependencies.runtime, dispatch, projectionError.code, null, null);
  }

  let fence: InvoiceProjectionFence | null = null;
  try {
    fence = await dependencies.runtime.acquireFence({
      dispatch,
      stripeCustomerId: source.customerId,
    });
  } catch {
    return retryAfterFailure(dependencies.runtime, dispatch, "invoice_fence_retryable", null, null);
  }
  if (fence === null) {
    return { status: "stale", code: "invoice_customer_fence_busy" };
  }
  if (fence.stripe_customer_id !== source.customerId || fence.livemode !== dispatch.livemode) {
    return retryAfterFailure(
      dependencies.runtime,
      dispatch,
      "invoice_fence_identity_review_required",
      fence,
      source.customerId,
    );
  }

  try {
    const rawSourceInvoice = await resolvePromise(
      dependencies.provider.retrieveInvoice(source.invoiceId),
    );
    const rawSubscription = await resolvePromise(
      dependencies.provider.retrieveSubscription(source.subscriptionId),
    );
    const sourceInvoice = verifyInvoice(rawSourceInvoice, {
      invoiceId: source.invoiceId,
      customerId: source.customerId,
      subscriptionId: source.subscriptionId,
      livemode: dispatch.livemode,
    });
    const subscription = verifySubscription(rawSubscription, {
      subscriptionId: source.subscriptionId,
      customerId: source.customerId,
      livemode: dispatch.livemode,
    });

    const latestInvoiceId = readLatestInvoiceId(subscription);
    const currentInvoice = latestInvoiceId === source.invoiceId
      ? sourceInvoice
      : verifyInvoice(
        await resolvePromise(dependencies.provider.retrieveInvoice(latestInvoiceId)),
        {
          invoiceId: latestInvoiceId,
          customerId: source.customerId,
          subscriptionId: source.subscriptionId,
          livemode: dispatch.livemode,
        },
      );
    const currentInvoiceStatus = boundedString(currentInvoice.status, 128);
    if (currentInvoiceStatus === null) {
      throw new InvoiceProjectionError("invoice_current_state_review_required");
    }
    const paymentIntent = readBasilPaymentIntent(currentInvoice, {
      invoiceId: latestInvoiceId,
      customerId: source.customerId,
      livemode: dispatch.livemode,
    });
    const paymentIntentStatus = paymentIntent.status;
    const outcome = classifyCurrentInvoice(currentInvoiceStatus, paymentIntentStatus);
    const paymentIntentId = paymentIntent.id;
    const invoiceAttemptKey = makeInvoiceAttemptKey(
      latestInvoiceId,
      paymentIntentId,
      readAttemptCount(currentInvoice),
      outcome,
    );

    const applied = await dependencies.runtime.apply({
      dispatch,
      stripeCustomerId: source.customerId,
      stripeSubscriptionId: source.subscriptionId,
      sourceInvoiceId: source.invoiceId,
      currentInvoiceId: latestInvoiceId,
      invoiceAttemptKey,
      fence,
      currentOutcome: outcome,
      currentInvoiceStatus,
      paymentIntentStatus,
      nextPaymentAttempt: readNextPaymentAttempt(currentInvoice),
    });
    const duplicate = applied.outcome === "duplicate_applied";
    return {
      status: "applied",
      code: duplicate ? "duplicate_applied" : "applied",
      ...(duplicate ? {} : { outcome }),
      applicationId: applied.application_id,
      currentInvoiceId: applied.current_invoice_id,
      invoiceAttemptKey: applied.invoice_attempt_key,
    };
  } catch (error) {
    const projectionError = error instanceof InvoiceProjectionError
      ? error
      : new InvoiceProjectionError("invoice_reconciliation_retryable");
    return retryAfterFailure(
      dependencies.runtime,
      dispatch,
      projectionError.code,
      fence,
      source.customerId,
    );
  }
}
