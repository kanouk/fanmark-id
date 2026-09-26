/**
 * Signed Stripe receipt ingress primitives.
 *
 * This module is deliberately independent of a Deno `serve` call.  A future
 * Edge Function can provide the Stripe SDK instance and the Supabase RPC
 * client, while tests can exercise the same byte handling and normalizer in
 * Node.  It does not apply a billing effect and it never calls Stripe's API.
 */

export const NORMALIZED_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_MAX_NORMALIZED_BYTES = 64 * 1024;
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;
export const DEFAULT_PERSIST_TIMEOUT_MS = 5_000;

const MAX_STRING_BYTES = 256;
const MAX_METADATA_ENTRIES = 16;
const MAX_ARRAY_ENTRIES = 20;

const ALLOWED_METADATA_KEYS = new Set([
  "type",
  "user_id",
  "license_id",
  "fanmark_id",
  "months",
  "tier_level",
  "expected_total_yen",
  "allow_zero_total",
  "intent_id",
  "billing_intent_id",
  "request_id",
  "price_id",
  "plan_type",
]);

const CHECKOUT_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

const INVOICE_EVENT_TYPES = new Set([
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.payment_succeeded",
]);

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

type StripeRecord = Record<string, unknown>;

export interface StripeEventLike {
  id?: unknown;
  type?: unknown;
  object?: unknown;
  created?: unknown;
  api_version?: unknown;
  livemode?: unknown;
  data?: unknown;
}

export interface StripeWebhookVerifier {
  webhooks: {
    constructEventAsync(
      payload: string | Uint8Array,
      header: string,
      secret: string,
      tolerance?: number,
      cryptoProvider?: unknown,
      receivedAt?: number,
    ): Promise<StripeEventLike>;
  };
}

export interface NormalizedReceipt {
  schema_version: typeof NORMALIZED_SCHEMA_VERSION;
  event: {
    id: string;
    type: string;
    created: number;
    api_version: string | null;
    livemode: boolean;
  };
  object: {
    type: string | null;
    id: string | null;
  };
  branch: "checkout_session" | "subscription" | "invoice" | "unknown";
  reference: {
    object_type: string | null;
    object_id: string | null;
  };
  checkout_session?: JsonObject;
  subscription?: JsonObject;
  invoice?: JsonObject;
}

export type CheckoutExtensionPaymentAssessment =
  | { outcome: "grant"; reason: "paid" }
  | { outcome: "awaiting_payment_confirmation"; reason: "checkout_completed_unpaid" }
  | { outcome: "no_grant"; reason: "async_payment_failed" | "checkout_expired" }
  | { outcome: "reject"; reason: string };

export function buildPaidExtensionPriceMetadata(priceYen: number): {
  expected_total_yen: string;
  allow_zero_total: "false";
} {
  if (!Number.isSafeInteger(priceYen) || priceYen <= 0) {
    throw new Error("paid_extension_price_must_be_positive_integer_yen");
  }
  return {
    expected_total_yen: String(priceYen),
    allow_zero_total: "false",
  };
}

/**
 * Decide whether a signed Checkout Session is eligible to fulfill an extension.
 * New sessions carry the expected total and zero-total policy set by the
 * server-side price lookup. Legacy paid sessions remain compatible; this paid
 * path never grants a zero-total Session under the current Product policy.
 */
export function assessCheckoutExtensionPayment(
  eventType: string,
  sessionValue: unknown,
): CheckoutExtensionPaymentAssessment {
  if (eventType === "checkout.session.async_payment_failed") {
    return { outcome: "no_grant", reason: "async_payment_failed" };
  }
  if (eventType === "checkout.session.expired") {
    return { outcome: "no_grant", reason: "checkout_expired" };
  }
  if (
    eventType !== "checkout.session.completed" &&
    eventType !== "checkout.session.async_payment_succeeded"
  ) {
    return { outcome: "reject", reason: "unsupported_checkout_event" };
  }

  const session = asRecord(sessionValue);
  if (session === null) {
    return { outcome: "reject", reason: "checkout_session_missing" };
  }
  if (session.mode !== "payment" || session.status !== "complete") {
    return { outcome: "reject", reason: "checkout_session_not_complete_payment" };
  }

  const metadata = asRecord(session.metadata) ?? {};
  const expectedTotalValue = metadata.expected_total_yen;
  const allowZeroValue = metadata.allow_zero_total;
  const hasExpectedTotal = expectedTotalValue !== undefined && expectedTotalValue !== null;
  const hasZeroAuthorization = allowZeroValue !== undefined && allowZeroValue !== null;

  if (hasExpectedTotal !== hasZeroAuthorization) {
    return { outcome: "reject", reason: "checkout_price_expectation_incomplete" };
  }

  if (hasExpectedTotal) {
    if (
      typeof expectedTotalValue !== "string" ||
      !/^[1-9][0-9]*$/u.test(expectedTotalValue) ||
      (allowZeroValue !== "true" && allowZeroValue !== "false")
    ) {
      return { outcome: "reject", reason: "checkout_price_expectation_invalid" };
    }

    const expectedTotal = Number(expectedTotalValue);
    if (
      !Number.isSafeInteger(expectedTotal) ||
      expectedTotal <= 0 ||
      session.currency !== "jpy" ||
      session.amount_total !== expectedTotal ||
      (expectedTotal === 0) !== (allowZeroValue === "true")
    ) {
      return { outcome: "reject", reason: "checkout_total_mismatch" };
    }
  }

  if (session.payment_status === "paid") {
    return { outcome: "grant", reason: "paid" };
  }

  if (
    eventType === "checkout.session.completed" &&
    session.payment_status === "unpaid"
  ) {
    return {
      outcome: "awaiting_payment_confirmation",
      reason: "checkout_completed_unpaid",
    };
  }

  if (session.payment_status === "no_payment_required") {
    return { outcome: "reject", reason: "zero_total_not_authorized" };
  }

  return { outcome: "reject", reason: "checkout_payment_not_settled" };
}

export interface ReceiptPersistenceInput {
  stripeEventId: string;
  livemode: boolean;
  eventType: string;
  objectType: string | null;
  objectId: string | null;
  apiVersion: string | null;
  normalizedSchemaVersion: typeof NORMALIZED_SCHEMA_VERSION;
  normalizedPayload: JsonObject;
  normalizedPayloadSha256: string;
  rawPayloadSha256: string;
}

export type DurableReceiptOutcome =
  | "accepted"
  | "duplicate_nonterminal"
  | "duplicate_terminal";

export interface DurableReceiptResult {
  receipt_id: string;
  dispatch_id: string;
  outcome: DurableReceiptOutcome;
  receipt_status: string;
  dispatch_status: string;
  delivery_count: number;
}

export type PersistReceipt = (
  input: ReceiptPersistenceInput,
) => Promise<DurableReceiptResult>;

export interface SupabaseRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface StripeReceiptIngressOptions {
  stripe: StripeWebhookVerifier;
  webhookSecret: string;
  cryptoProvider?: unknown;
  persistReceipt: PersistReceipt;
  maxBodyBytes?: number;
  maxNormalizedBytes?: number;
  signatureToleranceSeconds?: number;
  persistTimeoutMs?: number;
  bodyReadTimeoutMs?: number;
  nowMs?: () => number;
}

export class ReceiptIngressError extends Error {
  readonly kind: "body_too_large" | "body_timeout" | "invalid_event" | "persistence";

  constructor(
    kind: ReceiptIngressError["kind"],
    message: string,
  ) {
    super(message);
    this.name = "ReceiptIngressError";
    this.kind = kind;
  }
}

function asRecord(value: unknown): StripeRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as StripeRecord;
}

function boundedString(value: unknown, maxBytes = MAX_STRING_BYTES): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (new TextEncoder().encode(value).byteLength > maxBytes) return null;
  return value;
}

function boundedNullableString(value: unknown, maxBytes = MAX_STRING_BYTES): string | null {
  if (value === null || value === undefined) return null;
  return boundedString(value, maxBytes);
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function idFrom(value: unknown): string | null {
  const direct = boundedString(value);
  if (direct) return direct;
  const object = asRecord(value);
  return boundedString(object?.id);
}

function objectTypeFrom(value: unknown): string | null {
  return boundedString(asRecord(value)?.object);
}

function boundedList(value: unknown, fieldName: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ENTRIES) {
      throw new ReceiptIngressError(
        "invalid_event",
        `${fieldName} exceeds the replay limit`,
      );
    }
    return value;
  }
  const list = asRecord(value);
  const data = list?.data;
  if (!Array.isArray(data)) {
    throw new ReceiptIngressError("invalid_event", `${fieldName} is malformed`);
  }
  if (list?.has_more === true || data.length > MAX_ARRAY_ENTRIES) {
    throw new ReceiptIngressError(
      "invalid_event",
      `${fieldName} is incomplete for deterministic replay`,
    );
  }
  return data;
}

function boundedRelationshipId(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) return null;
  const id = idFrom(value);
  if (id === null) {
    throw new ReceiptIngressError("invalid_event", `${fieldName} ID is malformed`);
  }
  return id;
}

function allowlistedMetadata(value: unknown): JsonObject {
  const metadata = asRecord(value);
  if (!metadata) return {};

  const hasExpectedTotal = Object.prototype.hasOwnProperty.call(metadata, "expected_total_yen");
  const hasZeroPolicy = Object.prototype.hasOwnProperty.call(metadata, "allow_zero_total");
  if (hasExpectedTotal !== hasZeroPolicy) {
    throw new ReceiptIngressError("invalid_event", "checkout price metadata is incomplete");
  }
  if (hasExpectedTotal) {
    const expectedTotal = metadata.expected_total_yen;
    const allowZero = metadata.allow_zero_total;
    if (
      typeof expectedTotal !== "string" ||
      !/^[1-9][0-9]{0,15}$/u.test(expectedTotal) ||
      allowZero !== "false"
    ) {
      throw new ReceiptIngressError("invalid_event", "checkout price metadata is invalid");
    }
  }

  const output: JsonObject = {};
  let count = 0;
  for (const key of [...ALLOWED_METADATA_KEYS].sort()) {
    if (count >= MAX_METADATA_ENTRIES) break;
    const item = boundedString(metadata[key]);
    if (item === null) continue;
    output[key] = item;
    count += 1;
  }
  return output;
}

function readBoundedIds(value: unknown): JsonValue[] {
  return boundedList(value, "invoice discounts").map((item) => {
    const id = boundedRelationshipId(item, "invoice discount");
    if (id === null) {
      throw new ReceiptIngressError("invalid_event", "invoice discount ID is missing");
    }
    return id;
  });
}

function readDiscountAmounts(value: unknown): JsonValue[] {
  return boundedList(value, "invoice discount amounts")
    .map((item) => {
      const row = asRecord(item);
      if (row === null) {
        throw new ReceiptIngressError("invalid_event", "invoice discount amount is malformed");
      }
      return {
        amount: safeInteger(row?.amount),
        currency: boundedNullableString(row?.currency),
        discount_id: boundedRelationshipId(row.discount, "invoice discount amount"),
      } satisfies JsonObject;
    });
}

function readCheckoutSession(object: StripeRecord, expectedId: string): JsonObject {
  return {
    id: expectedId,
    mode: boundedNullableString(object.mode),
    status: boundedNullableString(object.status),
    payment_status: boundedNullableString(object.payment_status),
    amount_total: safeInteger(object.amount_total),
    currency: boundedNullableString(object.currency),
    customer_id: boundedRelationshipId(object.customer, "Checkout customer"),
    subscription_id: boundedRelationshipId(object.subscription, "Checkout subscription"),
    payment_intent_id: boundedRelationshipId(object.payment_intent, "Checkout payment intent"),
    client_reference_id: boundedNullableString(object.client_reference_id),
    expires_at: safeInteger(object.expires_at),
    metadata: allowlistedMetadata(object.metadata),
  };
}

function readSubscriptionItems(value: unknown): JsonValue[] {
  return boundedList(value, "subscription items")
    .map((item) => {
      const row = asRecord(item);
      if (row === null) {
        throw new ReceiptIngressError("invalid_event", "subscription item is malformed");
      }
      const price = asRecord(row?.price);
      const recurring = asRecord(price?.recurring);
      return {
        id: boundedRelationshipId(row.id, "subscription item"),
        price_id: boundedRelationshipId(row.price, "subscription item price"),
        product_id: boundedRelationshipId(price?.product, "subscription product"),
        unit_amount: safeInteger(price?.unit_amount),
        currency: boundedNullableString(price?.currency),
        recurring_interval: boundedNullableString(recurring?.interval),
        recurring_interval_count: safeInteger(recurring?.interval_count),
        quantity: safeInteger(row.quantity),
        current_period_start: safeInteger(row?.current_period_start),
        current_period_end: safeInteger(row?.current_period_end),
      } satisfies JsonObject;
    });
}

function readSubscription(object: StripeRecord, expectedId: string): JsonObject {
  return {
    id: expectedId,
    customer_id: boundedRelationshipId(object.customer, "subscription customer"),
    status: boundedNullableString(object.status),
    current_period_start: safeInteger(object.current_period_start),
    current_period_end: safeInteger(object.current_period_end),
    cancel_at_period_end: typeof object.cancel_at_period_end === "boolean"
      ? object.cancel_at_period_end
      : null,
    cancel_at: safeInteger(object.cancel_at),
    canceled_at: safeInteger(object.canceled_at),
    ended_at: safeInteger(object.ended_at),
    trial_end: safeInteger(object.trial_end),
    items: readSubscriptionItems(object.items),
    metadata: allowlistedMetadata(object.metadata),
  };
}

type InvoiceApiGeneration = "legacy" | "modern" | "unknown";

function invoiceApiGeneration(apiVersion: string | null): InvoiceApiGeneration {
  if (apiVersion === null) return "unknown";
  const match = /^(\d{4}-\d{2}-\d{2})(?:\.[a-z0-9-]+)?$/i.exec(apiVersion);
  if (match === null) return "unknown";
  const parsedDate = new Date(`${match[1]}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== match[1]
  ) {
    return "unknown";
  }
  return match[1] >= "2025-03-31" ? "modern" : "legacy";
}

function resolveInvoiceSubscription(
  object: StripeRecord,
  apiVersion: string | null,
): { id: string | null; source: string; parentType: string | null; parentPresent: boolean } {
  const hasParent = Object.prototype.hasOwnProperty.call(object, "parent");
  const parent = asRecord(object.parent);
  const parentType = boundedString(parent?.type);
  const details = asRecord(parent?.subscription_details);
  const hasNestedSubscription = details !== null &&
    Object.prototype.hasOwnProperty.call(details, "subscription");
  const nestedValue = details?.subscription;
  const nestedId = hasNestedSubscription ? idFrom(nestedValue) : null;
  const legacyValue = object.subscription;
  const hasLegacySubscription = Object.prototype.hasOwnProperty.call(object, "subscription");
  const legacyId = hasLegacySubscription ? idFrom(legacyValue) : null;

  if (hasNestedSubscription && nestedValue !== null && nestedId === null) {
    throw new ReceiptIngressError(
      "invalid_event",
      "invoice subscription relationship is malformed",
    );
  }
  if (hasLegacySubscription && legacyValue !== null && legacyId === null) {
    throw new ReceiptIngressError(
      "invalid_event",
      "invoice subscription relationship is malformed",
    );
  }
  if (nestedId !== null && legacyId !== null && nestedId !== legacyId) {
    throw new ReceiptIngressError(
      "invalid_event",
      "invoice subscription relationship conflicts",
    );
  }
  if (nestedId !== null && parentType !== "subscription_details") {
    throw new ReceiptIngressError(
      "invalid_event",
      "invoice parent type is required for a nested subscription relationship",
    );
  }

  const apiGeneration = invoiceApiGeneration(apiVersion);
  if (apiGeneration === "modern") {
    if (hasParent && parentType !== null && parentType !== "subscription_details") {
      if (legacyId !== null || nestedId !== null) {
        throw new ReceiptIngressError(
          "invalid_event",
          "invoice parent relationship is unsupported",
        );
      }
      return { id: null, source: "none", parentType, parentPresent: hasParent };
    }
    if (nestedId !== null) {
      return { id: nestedId, source: "basil_parent", parentType, parentPresent: hasParent };
    }
    if (legacyId !== null) {
      throw new ReceiptIngressError(
        "invalid_event",
        "Basil invoice is missing its parent subscription relationship",
      );
    }
    if (hasParent) {
      return { id: null, source: "basil_parent_missing", parentType, parentPresent: hasParent };
    }
    return { id: null, source: "none", parentType, parentPresent: hasParent };
  }

  if (apiGeneration === "legacy" && legacyId !== null) {
    return { id: legacyId, source: "legacy_top_level", parentType, parentPresent: hasParent };
  }
  if (nestedId !== null) {
    return {
      id: nestedId,
      source: apiGeneration === "legacy" ? "parent_subscription" : "parent_subscription_unversioned",
      parentType,
      parentPresent: hasParent,
    };
  }
  if (apiGeneration === "unknown" && legacyId !== null) {
    throw new ReceiptIngressError(
      "invalid_event",
      "invoice API version is required for a top-level subscription relationship",
    );
  }
  return { id: null, source: "none", parentType, parentPresent: hasParent };
}

function readInvoice(
  object: StripeRecord,
  expectedId: string,
  apiVersion: string | null,
): JsonObject {
  const relationship = resolveInvoiceSubscription(object, apiVersion);
  return {
    id: expectedId,
    customer_id: boundedRelationshipId(object.customer, "invoice customer"),
    subscription_id: relationship.id,
    subscription_relation_source: relationship.source,
    subscription_parent_type: relationship.parentType,
    subscription_parent_present: relationship.parentPresent,
    status: boundedNullableString(object.status),
    amount_due: safeInteger(object.amount_due),
    amount_paid: safeInteger(object.amount_paid),
    amount_remaining: safeInteger(object.amount_remaining),
    total: safeInteger(object.total),
    currency: boundedNullableString(object.currency),
    next_payment_attempt: safeInteger(object.next_payment_attempt),
    attempt_count: safeInteger(object.attempt_count),
    payment_intent_id: boundedRelationshipId(object.payment_intent, "invoice payment intent"),
    discount_ids: readBoundedIds(object.discounts),
    discount_amounts: readDiscountAmounts(object.total_discount_amounts),
    metadata: allowlistedMetadata(object.metadata),
  };
}

function eventEnvelope(event: StripeEventLike): NormalizedReceipt["event"] {
  const id = boundedString(event.id);
  const type = boundedString(event.type);
  const created = safeInteger(event.created);
  const apiVersion = event.api_version === null || event.api_version === undefined
    ? null
    : boundedString(event.api_version);

  if (id === null || type === null || created === null || typeof event.livemode !== "boolean") {
    throw new ReceiptIngressError(
      "invalid_event",
      "Stripe event envelope is incomplete",
    );
  }
  if (event.api_version !== null && event.api_version !== undefined && apiVersion === null) {
    throw new ReceiptIngressError(
      "invalid_event",
      "Stripe event API version is invalid",
    );
  }

  return {
    id,
    type,
    created,
    api_version: apiVersion,
    livemode: event.livemode,
  };
}

function requireObject(eventType: string, value: unknown, expectedId: string): StripeRecord {
  const object = asRecord(value);
  if (object === null) {
    throw new ReceiptIngressError(
      "invalid_event",
      `${eventType} object is missing`,
    );
  }
  const actualId = idFrom(object.id);
  if (actualId === null || actualId !== expectedId) {
    throw new ReceiptIngressError(
      "invalid_event",
      `${eventType} object ID is invalid`,
    );
  }
  return object;
}

function requireObjectType(
  eventType: string,
  object: StripeRecord,
  expectedType: string,
): string {
  const actualType = objectTypeFrom(object);
  if (actualType !== null && actualType !== expectedType) {
    throw new ReceiptIngressError(
      "invalid_event",
      `${eventType} object type is invalid`,
    );
  }
  return actualType ?? expectedType;
}

export function normalizeStripeEvent(event: StripeEventLike): NormalizedReceipt {
  const envelope = eventEnvelope(event);
  const data = asRecord(event.data);
  const rawObject = data?.object;
  const rawObjectId = idFrom(asRecord(rawObject)?.id);
  const rawObjectType = objectTypeFrom(rawObject);

  if (CHECKOUT_EVENT_TYPES.has(envelope.type)) {
    const object = requireObject(envelope.type, rawObject, rawObjectId ?? "");
    const objectId = idFrom(object.id) as string;
    const objectType = requireObjectType(envelope.type, object, "checkout.session");
    return {
      schema_version: NORMALIZED_SCHEMA_VERSION,
      event: envelope,
      object: { type: objectType, id: objectId },
      branch: "checkout_session",
      reference: { object_type: objectType, object_id: objectId },
      checkout_session: readCheckoutSession(object, objectId),
    };
  }

  if (SUBSCRIPTION_EVENT_TYPES.has(envelope.type)) {
    const object = requireObject(envelope.type, rawObject, rawObjectId ?? "");
    const objectId = idFrom(object.id) as string;
    const objectType = requireObjectType(envelope.type, object, "subscription");
    return {
      schema_version: NORMALIZED_SCHEMA_VERSION,
      event: envelope,
      object: { type: objectType, id: objectId },
      branch: "subscription",
      reference: { object_type: objectType, object_id: objectId },
      subscription: readSubscription(object, objectId),
    };
  }

  if (INVOICE_EVENT_TYPES.has(envelope.type)) {
    const object = requireObject(envelope.type, rawObject, rawObjectId ?? "");
    const objectId = idFrom(object.id) as string;
    const objectType = requireObjectType(envelope.type, object, "invoice");
    return {
      schema_version: NORMALIZED_SCHEMA_VERSION,
      event: envelope,
      object: { type: objectType, id: objectId },
      branch: "invoice",
      reference: { object_type: objectType, object_id: objectId },
      invoice: readInvoice(object, objectId, envelope.api_version),
    };
  }

  return {
    schema_version: NORMALIZED_SCHEMA_VERSION,
    event: envelope,
    object: { type: rawObjectType, id: rawObjectId },
    branch: "unknown",
    reference: { object_type: rawObjectType, object_id: rawObjectId },
  };
}

function canonicalJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value as JsonPrimitive;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite JSON number");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item));
  const object = asRecord(value);
  if (object === null) throw new TypeError("unsupported JSON value");
  const output: JsonObject = {};
  for (const key of Object.keys(object).sort()) {
    const item = object[key];
    if (item === undefined) throw new TypeError("undefined is not JSON");
    output[key] = canonicalJsonValue(item);
  }
  return output;
}

export function canonicalizeNormalizedPayload(value: JsonValue): string {
  return JSON.stringify(canonicalJsonValue(value));
}

export async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildReceiptPersistenceInput(
  event: StripeEventLike,
  rawBody: Uint8Array,
  maxNormalizedBytes = DEFAULT_MAX_NORMALIZED_BYTES,
): Promise<ReceiptPersistenceInput> {
  const normalized = normalizeStripeEvent(event);
  const canonical = canonicalizeNormalizedPayload(normalized as unknown as JsonObject);
  const canonicalBytes = new TextEncoder().encode(canonical);
  if (canonicalBytes.byteLength > maxNormalizedBytes) {
    throw new ReceiptIngressError(
      "invalid_event",
      "normalized event exceeds the storage limit",
    );
  }

  return {
    stripeEventId: normalized.event.id,
    livemode: normalized.event.livemode,
    eventType: normalized.event.type,
    objectType: normalized.object.type,
    objectId: normalized.object.id,
    apiVersion: normalized.event.api_version,
    normalizedSchemaVersion: NORMALIZED_SCHEMA_VERSION,
    normalizedPayload: normalized as unknown as JsonObject,
    normalizedPayloadSha256: await sha256Hex(canonicalBytes),
    rawPayloadSha256: await sha256Hex(rawBody),
  };
}

function jsonResponse(status: number, body: JsonObject): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
  });
}

async function readBodyWithLimit(
  request: Request,
  maxBodyBytes: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength)) {
    const declaredLength = Number(contentLength);
    if (Number.isSafeInteger(declaredLength) && declaredLength > maxBodyBytes) {
      throw new ReceiptIngressError("body_too_large", "request body exceeds the limit");
    }
  }

  if (request.body === null) return new Uint8Array();

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const readPromise = (async () => {
    reader = request.body?.getReader() ?? null;
    if (reader === null) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = result.value;
        if (!(chunk instanceof Uint8Array)) {
          throw new ReceiptIngressError("invalid_event", "request body stream is invalid");
        }
        total += chunk.byteLength;
        if (total > maxBodyBytes) {
          // Cancellation is intentionally fire-and-forget. A broken client
          // must not hold the response open while its stream's cancel hook
          // waits on the network.
          void reader.cancel().catch(() => undefined);
          throw new ReceiptIngressError("body_too_large", "request body exceeds the limit");
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return body;
  })();

  const timeoutPromise = new Promise<Uint8Array>((_, reject) => {
    timer = setTimeout(() => {
      // See the size-limit path above: never await an untrusted stream's
      // cancellation while deciding the HTTP response.
      if (reader !== null) void reader.cancel().catch(() => undefined);
      reject(new ReceiptIngressError("body_timeout", "request body read timed out"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([readPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function readStripeWebhookBody(
  request: Request,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  timeoutMs = DEFAULT_PERSIST_TIMEOUT_MS,
): Promise<Uint8Array> {
  return readBodyWithLimit(request, maxBodyBytes, timeoutMs);
}

function durableResult(value: unknown): DurableReceiptResult {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("receipt persistence returned an invalid durable result");
  }
  const row = value[0];
  const object = asRecord(row);
  const outcome = object?.outcome;
  const receiptStatus = object?.receipt_status;
  const dispatchStatus = object?.dispatch_status;
  const deliveryCount = object?.delivery_count;
  const validDeliveryCount =
    typeof deliveryCount === "number" &&
    Number.isSafeInteger(deliveryCount) &&
    deliveryCount > 0;
  const validOutcome =
    outcome === "accepted" ||
    outcome === "duplicate_nonterminal" ||
    outcome === "duplicate_terminal";
  const validStatusPair =
    (outcome === "accepted" && receiptStatus === "received" && dispatchStatus === "pending") ||
    (outcome === "duplicate_nonterminal" &&
      ["received", "processing", "retryable"].includes(String(receiptStatus)) &&
      ["pending", "processing", "retryable"].includes(String(dispatchStatus))) ||
    (outcome === "duplicate_terminal" &&
      ((["applied", "ignored"].includes(String(receiptStatus)) && dispatchStatus === "completed") ||
        (receiptStatus === "dead_letter" && dispatchStatus === "dead_letter")));
  if (
    typeof object?.receipt_id !== "string" ||
    object.receipt_id.trim().length === 0 ||
    typeof object.dispatch_id !== "string" ||
    object.dispatch_id.trim().length === 0 ||
    !validOutcome ||
    !validStatusPair ||
    !validDeliveryCount
  ) {
    throw new Error("receipt persistence returned an invalid durable result");
  }
  return {
    receipt_id: object.receipt_id,
    dispatch_id: object.dispatch_id,
    outcome,
    receipt_status: receiptStatus as string,
    dispatch_status: dispatchStatus as string,
    delivery_count: deliveryCount as number,
  };
}

export function createSupabaseReceiptPersister(
  client: SupabaseRpcClient,
): PersistReceipt {
  return async (input) => {
    let result: { data: unknown; error: unknown };
    try {
      result = await client.rpc("accept_stripe_webhook_receipt", {
        p_stripe_event_id: input.stripeEventId,
        p_livemode: input.livemode,
        p_event_type: input.eventType,
        p_object_type: input.objectType,
        p_object_id: input.objectId,
        p_api_version: input.apiVersion,
        p_normalized_schema_version: input.normalizedSchemaVersion,
        p_normalized_payload: input.normalizedPayload,
        p_normalized_payload_sha256: input.normalizedPayloadSha256,
        p_raw_payload_sha256: input.rawPayloadSha256,
      });
    } catch {
      throw new Error("receipt persistence failed");
    }
    if (result.error !== null && result.error !== undefined) {
      throw new Error("receipt persistence failed");
    }
    return durableResult(result.data);
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("receipt persistence timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createStripeReceiptIngress(
  options: StripeReceiptIngressOptions,
): (request: Request) => Promise<Response> {
  if (typeof options.webhookSecret !== "string" || options.webhookSecret.length === 0) {
    throw new Error("webhook secret is required");
  }

  const positiveOption = (
    value: number | undefined,
    fallback: number,
    name: string,
    maximum: number,
  ): number => {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
      throw new Error(`${name} must be a positive bounded integer`);
    }
    return resolved;
  };
  const maxBodyBytes = positiveOption(options.maxBodyBytes, DEFAULT_MAX_BODY_BYTES, "maxBodyBytes", 16 * 1024 * 1024);
  const maxNormalizedBytes = positiveOption(
    options.maxNormalizedBytes,
    DEFAULT_MAX_NORMALIZED_BYTES,
    "maxNormalizedBytes",
    2 * 1024 * 1024,
  );
  const tolerance = positiveOption(
    options.signatureToleranceSeconds,
    DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
    "signatureToleranceSeconds",
    86_400,
  );
  const persistTimeoutMs = positiveOption(
    options.persistTimeoutMs,
    DEFAULT_PERSIST_TIMEOUT_MS,
    "persistTimeoutMs",
    60_000,
  );
  const bodyReadTimeoutMs = positiveOption(
    options.bodyReadTimeoutMs,
    DEFAULT_PERSIST_TIMEOUT_MS,
    "bodyReadTimeoutMs",
    60_000,
  );
  const nowMs = options.nowMs ?? (() => Date.now());

  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: {
          allow: "POST",
          "cache-control": "no-store",
          "content-type": "application/json",
        },
      });
    }

    const signature = request.headers.get("stripe-signature");
    if (signature === null || signature.length === 0) {
      return jsonResponse(400, { error: "Invalid signature" });
    }

    let rawBody: Uint8Array;
    try {
      rawBody = await readBodyWithLimit(request, maxBodyBytes, bodyReadTimeoutMs);
    } catch (error) {
      if (error instanceof ReceiptIngressError && error.kind === "body_too_large") {
        return jsonResponse(413, { error: "Request body too large" });
      }
      if (error instanceof ReceiptIngressError && error.kind === "body_timeout") {
        return jsonResponse(408, { error: "Request body read timed out" });
      }
      return jsonResponse(400, { error: "Invalid request body" });
    }

    let event: StripeEventLike;
    try {
      event = await options.stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        options.webhookSecret,
        tolerance,
        options.cryptoProvider,
        nowMs(),
      );
    } catch {
      return jsonResponse(400, { error: "Invalid signature" });
    }

    let input: ReceiptPersistenceInput;
    try {
      input = await buildReceiptPersistenceInput(event, rawBody, maxNormalizedBytes);
    } catch (error) {
      if (error instanceof ReceiptIngressError && error.kind === "invalid_event") {
        return jsonResponse(400, { error: "Invalid event" });
      }
      return jsonResponse(400, { error: "Invalid event" });
    }

    let durable: DurableReceiptResult;
    try {
      durable = durableResult([
        await withTimeout(options.persistReceipt(input), persistTimeoutMs),
      ]);
    } catch {
      return jsonResponse(503, { error: "Receipt persistence unavailable" });
    }

    // Every 2xx response is based on the validated result returned by the
    // durable receipt RPC.  A duplicate is safe to acknowledge only after
    // that RPC has read the existing receipt/dispatch pair.
    return jsonResponse(200, {
      received: true,
      outcome: durable.outcome,
      receipt_status: durable.receipt_status,
      dispatch_status: durable.dispatch_status,
    });
  };
}
