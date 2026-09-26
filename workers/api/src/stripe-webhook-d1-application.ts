import type { StripeWebhookD1LeaseIdentity } from "./stripe-webhook-d1-dispatch.ts";

type JsonObject = Record<string, unknown>;
type ApplicationOutcome = "applied" | "duplicate_session" | "awaiting_payment" | "no_grant" | "dead_letter";

export interface StripeExtensionD1ApplicationResult {
  receiptId: string;
  applicationId: string | null;
  outcome: ApplicationOutcome;
  receiptStatus: string;
  dispatchStatus: string;
  licenseEnd: string | null;
  errorCode: string | null;
}

export class StripeWebhookD1ApplicationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "StripeWebhookD1ApplicationError";
    this.code = code;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PAYMENT_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

interface ReceiptRow {
  receipt_id: string;
  stripe_event_id: string;
  livemode: number;
  event_type: string;
  object_type: string | null;
  object_id: string | null;
  normalized_payload: string;
  status: string;
  terminal_at: string | null;
  dispatch_id: string;
  dispatch_status: string;
  lease_token: string | null;
  claim_generation: number;
  lease_until: string | null;
}

interface IntentRow {
  id: string;
  user_id: string;
  license_id: string;
  fanmark_id: string;
  tier_level: number;
  months: number;
  stripe_price_id: string;
  currency: string;
  expected_total_yen: number;
  allow_zero_total: number;
  livemode: number;
  stripe_checkout_session_id: string | null;
  status: string;
}

interface LicenseRow {
  id: string;
  fanmark_id: string;
  user_id: string | null;
  license_end: string | null;
  status: string;
  is_returned: number;
  is_transferred: number;
  transfer_locked_until: string | null;
  display_fanmark: string | null;
  fanmark_status: string;
  tier_level: number;
}

function requireUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new StripeWebhookD1ApplicationError(code);
  return value.toLowerCase();
}

function record(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function requiredText(value: unknown, code: string, maxLength = 255): string {
  if (typeof value !== "string") throw new StripeWebhookD1ApplicationError(code);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) throw new StripeWebhookD1ApplicationError(code);
  return normalized;
}

function positiveInteger(value: unknown, code: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new StripeWebhookD1ApplicationError(code);
  }
  return value as number;
}

interface UtcParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  fraction: string;
}

function parseUtcTimestamp(value: unknown, code: string): UtcParts {
  if (typeof value !== "string") throw new StripeWebhookD1ApplicationError(code);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$/u.exec(value);
  if (!match) throw new StripeWebhookD1ApplicationError(code);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText = ""] = match;
  const parts = {
    year: Number(yearText), month: Number(monthText), day: Number(dayText),
    hour: Number(hourText), minute: Number(minuteText), second: Number(secondText),
    fraction: fractionText.padEnd(6, "0"),
  };
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, Number(parts.fraction.slice(0, 3)));
  if (
    parts.month < 1 || parts.month > 12 || parts.day < 1 ||
    date.getUTCFullYear() !== parts.year || date.getUTCMonth() + 1 !== parts.month ||
    date.getUTCDate() !== parts.day || date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute || date.getUTCSeconds() !== parts.second
  ) throw new StripeWebhookD1ApplicationError(code);
  return parts;
}

function canonicalUtc(parts: UtcParts): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${parts.fraction}Z`;
}

function addMonthsAndRoundUp(baseValue: string, months: number): string {
  const base = parseUtcTimestamp(baseValue, "invalid_license_end");
  const absoluteMonth = base.year * 12 + (base.month - 1) + months;
  const year = Math.floor(absoluteMonth / 12);
  const month = absoluteMonth % 12 + 1;
  if (year < 100 || year > 9998) throw new StripeWebhookD1ApplicationError("license_end_out_of_range");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, month - 1, Math.min(base.day, lastDay)));
  const exactMidnight = base.hour === 0 && base.minute === 0 && base.second === 0 && /^0{6}$/u.test(base.fraction);
  if (!exactMidnight) date.setUTCDate(date.getUTCDate() + 1);
  return `${date.toISOString().slice(0, 10)}T00:00:00.000000Z`;
}

function leaseValues(identity: StripeWebhookD1LeaseIdentity, now: string) {
  const receiptId = requireUuid(identity.receiptId, "invalid_receipt_id");
  const dispatchId = requireUuid(identity.dispatchId, "invalid_dispatch_id");
  const leaseToken = requireUuid(identity.leaseToken, "invalid_lease_token");
  if (!Number.isSafeInteger(identity.claimGeneration) || identity.claimGeneration < 1) {
    throw new StripeWebhookD1ApplicationError("invalid_claim_generation");
  }
  if (typeof identity.livemode !== "boolean") throw new StripeWebhookD1ApplicationError("invalid_livemode");
  parseUtcTimestamp(now, "invalid_timestamp");
  return { receiptId, dispatchId, leaseToken, generation: identity.claimGeneration, livemode: identity.livemode ? 1 : 0, now };
}

async function markDeadLetter(args: {
  database: D1Database;
  identity: StripeWebhookD1LeaseIdentity;
  now: string;
  errorCode: string;
  receiptId: string;
}): Promise<StripeExtensionD1ApplicationResult> {
  const lease = leaseValues(args.identity, args.now);
  const result = await args.database.batch([
    args.database.prepare(`
      UPDATE stripe_webhook_receipts
      SET status = 'dead_letter', terminal_at = ?, last_error_code = ?,
          last_error_message = NULL, updated_at = ?
      WHERE id = ? AND livemode = ? AND status = 'processing'
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = stripe_webhook_receipts.id
            AND d.livemode = stripe_webhook_receipts.livemode
            AND d.status = 'processing' AND d.lease_token = ?
            AND d.claim_generation = ? AND d.lease_until > ?
        )
    `).bind(lease.now, args.errorCode, lease.now, lease.receiptId, lease.livemode,
      lease.dispatchId, lease.leaseToken, lease.generation, lease.now),
    args.database.prepare(`
      UPDATE stripe_webhook_dispatches
      SET status = 'dead_letter', claimed_at = NULL, lease_until = NULL, lease_token = NULL,
          completed_at = NULL, last_error_code = ?, last_error_message = NULL, updated_at = ?
      WHERE id = ? AND receipt_id = ? AND livemode = ? AND status = 'processing'
        AND lease_token = ? AND claim_generation = ? AND lease_until > ?
        AND changes() = 1
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_receipts AS r
          WHERE r.id = stripe_webhook_dispatches.receipt_id
            AND r.status = 'dead_letter' AND r.terminal_at = ?
        )
    `).bind(args.errorCode, lease.now, lease.dispatchId, lease.receiptId, lease.livemode,
      lease.leaseToken, lease.generation, lease.now, lease.now),
  ]);
  if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1) {
    throw new StripeWebhookD1ApplicationError("lease_lost_before_dead_letter");
  }
  return readResult(args.database, lease.receiptId, args.receiptId, "dead_letter", args.errorCode);
}

async function markTerminalWithoutGrant(args: {
  database: D1Database;
  identity: StripeWebhookD1LeaseIdentity;
  now: string;
  receiptId: string;
  intentId: string;
  sessionId: string;
  outcome: "awaiting_payment" | "no_grant";
  sessionStatus: string;
  paymentStatus: string | null;
  intentStatus: "awaiting_payment_confirmation" | "failed" | "expired";
  applicationId: string;
  metadata: ExtensionMetadata;
}): Promise<StripeExtensionD1ApplicationResult> {
  const lease = leaseValues(args.identity, args.now);
  const params = args.metadata;
  const terminalReceiptStatus = "ignored";
  await args.database.batch([
    args.database.prepare(`
      UPDATE stripe_extension_checkout_intents
      SET stripe_checkout_session_id = coalesce(stripe_checkout_session_id, ?),
          stripe_session_status = ?, stripe_payment_status = ?, status = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND license_id = ? AND fanmark_id = ?
        AND tier_level = ? AND months = ? AND stripe_price_id = ? AND currency = 'jpy'
        AND expected_total_yen = ? AND allow_zero_total = 0 AND livemode = ?
        AND status IN ('created', 'open', 'awaiting_payment_confirmation', 'failed', 'expired')
        AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = ?)
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = ? AND d.status = 'processing'
            AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
        )
    `).bind(args.sessionId, args.sessionStatus, args.paymentStatus, args.intentStatus, lease.now,
      args.intentId, params.userId, params.licenseId, params.fanmarkId, params.tierLevel,
      params.months, params.priceId, params.expectedTotalYen, lease.livemode, args.sessionId,
      lease.dispatchId, lease.receiptId, lease.leaseToken, lease.generation, lease.now),
    args.database.prepare(`
      INSERT INTO stripe_extension_applications (
        id, billing_intent_id, livemode, stripe_checkout_session_id, source_receipt_id,
        last_receipt_id, user_id, license_id, fanmark_id, tier_level, months,
        expected_total_yen, allow_zero_total, status, result_code, created_at, updated_at
      )
      SELECT ?, i.id, i.livemode, ?, ?, ?, i.user_id, i.license_id, i.fanmark_id,
        i.tier_level, i.months, i.expected_total_yen, i.allow_zero_total,
        'awaiting_payment_confirmation', 'awaiting_payment_confirmation', ?, ?
      FROM stripe_extension_checkout_intents AS i
      WHERE i.id = ? AND i.stripe_checkout_session_id = ? AND i.status IN (
        'open', 'awaiting_payment_confirmation', 'failed', 'expired'
      )
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = ? AND d.status = 'processing'
            AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
        )
      ON CONFLICT (livemode, stripe_checkout_session_id) DO NOTHING
    `).bind(args.applicationId, args.sessionId, lease.receiptId, lease.receiptId, lease.now, lease.now,
      args.intentId, args.sessionId, lease.dispatchId, lease.receiptId, lease.leaseToken, lease.generation, lease.now),
    args.database.prepare(`
      UPDATE stripe_extension_applications
      SET last_receipt_id = ?, updated_at = ?,
          status = CASE
            WHEN status = 'awaiting_payment_confirmation' AND ? IN ('failed', 'expired') THEN ?
            ELSE status
          END,
          result_code = CASE
            WHEN status = 'awaiting_payment_confirmation' AND ? IN ('failed', 'expired') THEN ?
            WHEN status = 'awaiting_payment_confirmation' THEN 'awaiting_payment_confirmation'
            ELSE result_code
          END,
          terminal_at = CASE
            WHEN status = 'awaiting_payment_confirmation' AND ? IN ('failed', 'expired') THEN ?
            ELSE terminal_at
          END
      WHERE livemode = ? AND stripe_checkout_session_id = ?
        AND billing_intent_id = ? AND user_id = ? AND license_id = ? AND fanmark_id = ?
        AND tier_level = ? AND months = ? AND expected_total_yen = ? AND allow_zero_total = 0
        AND status IN ('awaiting_payment_confirmation', 'failed', 'expired', 'applied')
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = ? AND d.status = 'processing'
            AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
        )
    `).bind(lease.receiptId, lease.now, args.intentStatus, args.intentStatus,
      args.intentStatus, args.intentStatus, args.intentStatus, lease.now,
      lease.livemode, args.sessionId, args.intentId, params.userId, params.licenseId,
      params.fanmarkId, params.tierLevel, params.months, params.expectedTotalYen,
      lease.dispatchId, lease.receiptId, lease.leaseToken, lease.generation, lease.now),
    args.database.prepare(`
      UPDATE stripe_extension_checkout_intents
      SET status = CASE WHEN status = 'applied' OR EXISTS (
            SELECT 1 FROM stripe_extension_applications AS a
            WHERE a.billing_intent_id = stripe_extension_checkout_intents.id AND a.status = 'applied'
          ) THEN 'applied' WHEN status IN ('failed', 'expired') THEN status ELSE ? END,
          updated_at = ?
      WHERE id = ? AND stripe_checkout_session_id = ?
        AND status IN ('awaiting_payment_confirmation', 'failed', 'expired', 'applied')
    `).bind(args.intentStatus, lease.now, args.intentId, args.sessionId),
    args.database.prepare(`
      UPDATE stripe_webhook_receipts
      SET status = CASE WHEN EXISTS (
            SELECT 1 FROM stripe_extension_applications AS a
            WHERE a.livemode = ? AND a.stripe_checkout_session_id = ?
              AND a.billing_intent_id = ? AND a.status = 'applied'
          ) THEN 'applied' ELSE ? END,
          terminal_at = ?, last_error_code = NULL, last_error_message = NULL, updated_at = ?
      WHERE id = ? AND status = 'processing' AND EXISTS (
        SELECT 1 FROM stripe_extension_applications AS a
        WHERE a.livemode = ? AND a.stripe_checkout_session_id = ?
          AND a.billing_intent_id = ? AND a.status IN ('awaiting_payment_confirmation', 'failed', 'expired', 'applied')
      )
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = stripe_webhook_receipts.id
            AND d.status = 'processing' AND d.lease_token = ?
            AND d.claim_generation = ? AND d.lease_until > ?
        )
    `).bind(lease.livemode, args.sessionId, args.intentId, terminalReceiptStatus, lease.now, lease.now,
      lease.receiptId, lease.livemode, args.sessionId, args.intentId,
      lease.dispatchId, lease.leaseToken, lease.generation, lease.now),
    args.database.prepare(`
      UPDATE stripe_webhook_dispatches
      SET status = 'completed', claimed_at = NULL, lease_until = NULL, lease_token = NULL,
          completed_at = ?, last_error_code = NULL, last_error_message = NULL, updated_at = ?
      WHERE id = ? AND receipt_id = ? AND livemode = ? AND status = 'processing'
        AND lease_token = ? AND claim_generation = ? AND lease_until > ? AND changes() = 1
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_receipts AS r
          WHERE r.id = stripe_webhook_dispatches.receipt_id
            AND r.status IN ('ignored', 'applied') AND r.terminal_at = ?
        )
    `).bind(lease.now, lease.now, lease.dispatchId, lease.receiptId, lease.livemode,
      lease.leaseToken, lease.generation, lease.now, lease.now),
  ]);
  return readResult(args.database, lease.receiptId, args.receiptId,
    args.outcome === "awaiting_payment" ? "awaiting_payment" : "no_grant", null);
}

interface ExtensionMetadata {
  intentId: string;
  userId: string;
  licenseId: string;
  fanmarkId: string;
  tierLevel: number;
  months: number;
  priceId: string;
  expectedTotalYen: number;
}

function extensionMetadata(value: unknown): ExtensionMetadata {
  const metadata = record(value);
  if (!metadata || metadata.type !== "license_extension") {
    throw new StripeWebhookD1ApplicationError("extension_session_metadata_invalid");
  }
  const totalText = requiredText(metadata.expected_total_yen, "extension_price_metadata_invalid", 16);
  if (!/^[1-9][0-9]{0,15}$/u.test(totalText) || metadata.allow_zero_total !== "false") {
    throw new StripeWebhookD1ApplicationError("extension_price_metadata_invalid");
  }
  const expectedTotalYen = Number(totalText);
  if (!Number.isSafeInteger(expectedTotalYen) || expectedTotalYen <= 0) {
    throw new StripeWebhookD1ApplicationError("extension_price_metadata_invalid");
  }
  return {
    intentId: requireUuid(metadata.billing_intent_id, "extension_intent_metadata_invalid"),
    userId: requireUuid(metadata.user_id, "extension_target_metadata_invalid"),
    licenseId: requireUuid(metadata.license_id, "extension_target_metadata_invalid"),
    fanmarkId: requireUuid(metadata.fanmark_id, "extension_target_metadata_invalid"),
    tierLevel: positiveInteger(Number(metadata.tier_level), "extension_plan_metadata_out_of_range", 9999),
    months: positiveInteger(Number(metadata.months), "extension_plan_metadata_out_of_range", 12),
    priceId: requiredText(metadata.price_id, "extension_intent_metadata_invalid"),
    expectedTotalYen,
  };
}

async function readResult(
  database: D1Database,
  receiptId: string,
  expectedReceiptId: string,
  outcome: ApplicationOutcome,
  errorCode: string | null,
): Promise<StripeExtensionD1ApplicationResult> {
  const row = await database.prepare(`
    SELECT r.id AS receipt_id, r.status AS receipt_status, r.terminal_at,
      d.status AS dispatch_status, a.id AS application_id, a.new_license_end,
      a.status AS application_status
    FROM stripe_webhook_receipts AS r
    JOIN stripe_webhook_dispatches AS d
      ON d.receipt_id = r.id AND d.livemode = r.livemode AND d.stripe_event_id = r.stripe_event_id
    LEFT JOIN stripe_extension_applications AS a
      ON a.source_receipt_id = r.id OR a.last_receipt_id = r.id OR a.applied_receipt_id = r.id
    WHERE r.id = ?
  `).bind(receiptId).first<{
    receipt_id: string;
    receipt_status: string;
    terminal_at: string | null;
    dispatch_status: string;
    application_id: string | null;
    new_license_end: string | null;
    application_status: string | null;
  }>();
  if (!row || row.receipt_id !== expectedReceiptId || !row.terminal_at ||
      !["completed", "dead_letter"].includes(row.dispatch_status)) {
    throw new StripeWebhookD1ApplicationError("terminal_readback_mismatch");
  }
  return {
    receiptId: row.receipt_id,
    applicationId: row.application_id,
    outcome: row.receipt_status === "dead_letter"
      ? "dead_letter"
      : row.receipt_status === "applied" && outcome !== "applied" ? "duplicate_session" : outcome,
    receiptStatus: row.receipt_status,
    dispatchStatus: row.dispatch_status,
    licenseEnd: row.new_license_end,
    errorCode,
  };
}

async function readIntent(database: D1Database, intentId: string): Promise<IntentRow | null> {
  return database.prepare(`
    SELECT id, user_id, license_id, fanmark_id, tier_level, months, stripe_price_id,
      currency, expected_total_yen, allow_zero_total, livemode,
      stripe_checkout_session_id, status
    FROM stripe_extension_checkout_intents WHERE id = ?
  `).bind(intentId).first<IntentRow>();
}

function intentMatches(intent: IntentRow, metadata: ExtensionMetadata, livemode: number): boolean {
  return intent.user_id.toLowerCase() === metadata.userId &&
    intent.license_id.toLowerCase() === metadata.licenseId &&
    intent.fanmark_id.toLowerCase() === metadata.fanmarkId &&
    intent.tier_level === metadata.tierLevel && intent.months === metadata.months &&
    intent.stripe_price_id === metadata.priceId && intent.currency === "jpy" &&
    intent.expected_total_yen === metadata.expectedTotalYen && intent.allow_zero_total === 0 &&
    intent.livemode === livemode;
}

async function readLicense(database: D1Database, metadata: ExtensionMetadata): Promise<LicenseRow | null> {
  return database.prepare(`
    SELECT l.id, l.fanmark_id, l.user_id, l.license_end, l.status, l.is_returned,
      l.is_transferred, l.transfer_locked_until, l.display_fanmark,
      f.status AS fanmark_status, f.tier_level
    FROM fanmark_licenses AS l
    JOIN fanmarks AS f ON f.id = l.fanmark_id
    WHERE l.id = ? AND l.fanmark_id = ?
  `).bind(metadata.licenseId, metadata.fanmarkId).first<LicenseRow>();
}

function licenseError(license: LicenseRow | null, metadata: ExtensionMetadata, now: string): string | null {
  if (!license) return "extension_license_missing";
  if (license.user_id?.toLowerCase() !== metadata.userId) return "extension_stale_owner";
  if (license.fanmark_id.toLowerCase() !== metadata.fanmarkId) return "extension_stale_owner";
  if (!(["active", "grace"].includes(license.status)) || !license.license_end ||
      license.is_returned === 1 || license.is_transferred === 1 ||
      (license.transfer_locked_until !== null && license.transfer_locked_until > now)) {
    return "extension_license_ineligible";
  }
  if (license.fanmark_status !== "active" || license.tier_level !== metadata.tierLevel) {
    return "extension_fanmark_ineligible";
  }
  return null;
}

async function completePaidExtension(args: {
  database: D1Database;
  identity: StripeWebhookD1LeaseIdentity;
  now: string;
  receipt: ReceiptRow;
  sessionId: string;
  sessionStatus: string;
  paymentStatus: string;
  metadata: ExtensionMetadata;
  applicationId: string;
  license: LicenseRow;
  newLicenseEnd: string;
}): Promise<StripeExtensionD1ApplicationResult> {
  const lease = leaseValues(args.identity, args.now);
  const params = args.metadata;
  const receipt = args.receipt;
  const license = args.license;
  const sessionId = args.sessionId;
  await args.database.batch([
    args.database.prepare(`
      UPDATE stripe_extension_checkout_intents
      SET stripe_checkout_session_id = coalesce(stripe_checkout_session_id, ?),
          stripe_session_status = ?, stripe_payment_status = ?, status = 'open', updated_at = ?
      WHERE id = ? AND user_id = ? AND license_id = ? AND fanmark_id = ?
        AND tier_level = ? AND months = ? AND stripe_price_id = ? AND currency = 'jpy'
        AND expected_total_yen = ? AND allow_zero_total = 0 AND livemode = ?
        AND status IN ('created', 'open', 'awaiting_payment_confirmation')
        AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = ?)
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = ? AND d.status = 'processing'
            AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
        )
    `).bind(sessionId, args.sessionStatus, args.paymentStatus, lease.now,
      params.intentId, params.userId, params.licenseId, params.fanmarkId, params.tierLevel,
      params.months, params.priceId, params.expectedTotalYen, lease.livemode, sessionId,
      lease.dispatchId, lease.receiptId, lease.leaseToken, lease.generation, lease.now),
    args.database.prepare(`
      INSERT INTO stripe_extension_applications (
        id, billing_intent_id, livemode, stripe_checkout_session_id, source_receipt_id,
        last_receipt_id, user_id, license_id, fanmark_id, tier_level, months,
        expected_total_yen, allow_zero_total, status, result_code, created_at, updated_at
      )
      SELECT ?, i.id, i.livemode, ?, ?, ?, i.user_id, i.license_id, i.fanmark_id,
        i.tier_level, i.months, i.expected_total_yen, i.allow_zero_total,
        'awaiting_payment_confirmation', 'awaiting_payment_confirmation', ?, ?
      FROM stripe_extension_checkout_intents AS i
      WHERE i.id = ? AND i.stripe_checkout_session_id = ? AND i.status IN ('open', 'awaiting_payment_confirmation')
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = ? AND d.status = 'processing'
            AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
        )
      ON CONFLICT (livemode, stripe_checkout_session_id) DO NOTHING
    `).bind(args.applicationId, sessionId, receipt.receipt_id, receipt.receipt_id, lease.now, lease.now,
      params.intentId, sessionId, lease.dispatchId, lease.receiptId, lease.leaseToken, lease.generation, lease.now),
    args.database.prepare(`
      UPDATE stripe_extension_applications
      SET status = 'applying', last_receipt_id = ?, updated_at = ?
      WHERE livemode = ? AND stripe_checkout_session_id = ? AND billing_intent_id = ?
        AND user_id = ? AND license_id = ? AND fanmark_id = ? AND tier_level = ? AND months = ?
        AND expected_total_yen = ? AND allow_zero_total = 0
        AND status = 'awaiting_payment_confirmation'
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = ? AND d.status = 'processing'
            AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
        )
    `).bind(receipt.receipt_id, lease.now, lease.livemode, sessionId, params.intentId,
      params.userId, params.licenseId, params.fanmarkId, params.tierLevel, params.months,
      params.expectedTotalYen, lease.dispatchId, lease.receiptId, lease.leaseToken, lease.generation, lease.now),
    args.database.prepare(`
      UPDATE fanmark_licenses
      SET status = 'active', license_end = ?, grace_expires_at = NULL,
          is_returned = 0, excluded_at = NULL, excluded_from_plan = NULL, updated_at = ?
      WHERE id = ? AND fanmark_id = ? AND user_id = ? AND status = ? AND license_end = ?
        AND is_returned = 0 AND is_transferred = 0
        AND (transfer_locked_until IS NULL OR transfer_locked_until <= ?)
        AND NOT EXISTS (
          SELECT 1 FROM fanmark_transfer_requests AS tr
          WHERE tr.license_id = fanmark_licenses.id AND tr.status IN ('pending', 'approved')
        )
        AND EXISTS (
          SELECT 1 FROM fanmarks AS f
          WHERE f.id = fanmark_licenses.fanmark_id AND f.status = 'active' AND f.tier_level = ?
        )
        AND EXISTS (
          SELECT 1 FROM stripe_extension_applications AS a
          WHERE a.livemode = ? AND a.stripe_checkout_session_id = ?
            AND a.status = 'applying' AND a.user_id = ? AND a.license_id = ? AND a.fanmark_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = ? AND d.status = 'processing'
            AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM audit_logs AS al
          WHERE al.action = 'LICENSE_EXTENDED' AND al.resource_type = 'fanmark_license'
            AND al.resource_id = fanmark_licenses.id
            AND json_extract(al.metadata, '$.payment_session_id') = ?
        )
    `).bind(args.newLicenseEnd, lease.now, params.licenseId, params.fanmarkId, params.userId,
      license.status, license.license_end, lease.now, params.tierLevel,
      lease.livemode, sessionId, params.userId, params.licenseId, params.fanmarkId,
      lease.dispatchId, lease.receiptId, lease.leaseToken, lease.generation, lease.now, sessionId),
    args.database.prepare(`
      INSERT INTO stripe_extension_application_effects (
        application_id, previous_license_end, new_license_end, created_at
      )
      SELECT a.id, ?, ?, ? FROM stripe_extension_applications AS a
      WHERE a.livemode = ? AND a.stripe_checkout_session_id = ? AND a.status = 'applying'
        AND changes() = 1
      ON CONFLICT (application_id) DO NOTHING
    `).bind(license.license_end, args.newLicenseEnd, lease.now, lease.livemode, sessionId),
    args.database.prepare(`
      INSERT OR IGNORE INTO stripe_extension_application_lottery_entries (
        application_id, lottery_entry_id, user_id, status, created_at
      )
      SELECT a.id, le.id, le.user_id, 'pending', ?
      FROM stripe_extension_applications AS a
      JOIN fanmark_lottery_entries AS le ON le.fanmark_id = a.fanmark_id AND le.entry_status = 'pending'
      JOIN stripe_extension_application_effects AS e ON e.application_id = a.id
      WHERE a.livemode = ? AND a.stripe_checkout_session_id = ? AND a.status = 'applying'
    `).bind(lease.now, lease.livemode, sessionId),
    args.database.prepare(`
      UPDATE fanmark_lottery_entries
      SET entry_status = 'cancelled_by_extension', cancellation_reason = 'license_extended',
          cancelled_at = ?, updated_at = ?
      WHERE entry_status = 'pending' AND EXISTS (
        SELECT 1 FROM stripe_extension_application_lottery_entries AS x
        JOIN stripe_extension_applications AS a ON a.id = x.application_id
        WHERE x.lottery_entry_id = fanmark_lottery_entries.id AND x.status = 'pending'
          AND a.status = 'applying' AND a.livemode = ? AND a.stripe_checkout_session_id = ?
      )
    `).bind(lease.now, lease.now, lease.livemode, sessionId),
    args.database.prepare(`
      UPDATE stripe_extension_application_lottery_entries
      SET status = 'cancelled'
      WHERE status = 'pending' AND EXISTS (
        SELECT 1 FROM fanmark_lottery_entries AS le
        JOIN stripe_extension_applications AS a ON a.id = stripe_extension_application_lottery_entries.application_id
        WHERE le.id = stripe_extension_application_lottery_entries.lottery_entry_id
          AND le.entry_status = 'cancelled_by_extension' AND le.cancellation_reason = 'license_extended'
          AND le.cancelled_at = ? AND a.status = 'applying' AND a.livemode = ?
          AND a.stripe_checkout_session_id = ?
      )
    `).bind(lease.now, lease.livemode, sessionId),
    args.database.prepare(`
      UPDATE stripe_extension_application_effects
      SET cancelled_lottery_entries_count = (
        SELECT count(*) FROM stripe_extension_application_lottery_entries AS x
        WHERE x.application_id = stripe_extension_application_effects.application_id AND x.status = 'cancelled'
      )
      WHERE application_id IN (
        SELECT id FROM stripe_extension_applications WHERE livemode = ? AND stripe_checkout_session_id = ?
          AND status = 'applying'
      )
    `).bind(lease.livemode, sessionId),
    args.database.prepare(`
      INSERT OR IGNORE INTO notification_events (
        event_type, event_version, source, payload, trigger_at, dedupe_key, status, created_at, updated_at
      )
      SELECT 'lottery_cancelled_by_extension', 1, 'edge_function',
        json_object('user_id', x.user_id, 'fanmark_id', a.fanmark_id,
          'fanmark_name', coalesce(l.display_fanmark, ''), 'extended_by_user_id', a.user_id),
        ?, 'stripe-extension-lottery:' || a.stripe_checkout_session_id || ':' || x.lottery_entry_id,
        'pending', ?, ?
      FROM stripe_extension_application_lottery_entries AS x
      JOIN stripe_extension_applications AS a ON a.id = x.application_id
      JOIN fanmark_licenses AS l ON l.id = a.license_id
      WHERE a.livemode = ? AND a.stripe_checkout_session_id = ?
        AND a.status = 'applying' AND x.status = 'cancelled'
    `).bind(lease.now, lease.now, lease.now, lease.livemode, sessionId),
    args.database.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT a.user_id, 'LICENSE_EXTENDED', 'fanmark_license', a.license_id,
        json_object('fanmark_id', a.fanmark_id, 'months', a.months,
          'payment_session_id', a.stripe_checkout_session_id,
          'previous_license_end', e.previous_license_end, 'new_license_end', e.new_license_end,
          'grace_cleared', json('true'), 'stripe_event_id', r.stripe_event_id), ?
      FROM stripe_extension_applications AS a
      JOIN stripe_extension_application_effects AS e ON e.application_id = a.id
      JOIN stripe_webhook_receipts AS r ON r.id = ?
      WHERE a.livemode = ? AND a.stripe_checkout_session_id = ? AND a.status = 'applying'
    `).bind(lease.now, receipt.receipt_id, lease.livemode, sessionId),
    args.database.prepare(`
      INSERT INTO audit_logs (user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT a.user_id, 'LICENSE_EXTENDED_LOTTERY_CANCELLED', 'fanmark_license', a.license_id,
        json_object('fanmark_id', a.fanmark_id, 'cancelled_entries_count', e.cancelled_lottery_entries_count,
          'payment_session_id', a.stripe_checkout_session_id), ?
      FROM stripe_extension_applications AS a
      JOIN stripe_extension_application_effects AS e ON e.application_id = a.id
      WHERE a.livemode = ? AND a.stripe_checkout_session_id = ? AND a.status = 'applying'
        AND e.cancelled_lottery_entries_count > 0
    `).bind(lease.now, lease.livemode, sessionId),
    args.database.prepare(`
      UPDATE stripe_extension_applications
      SET status = CASE
            WHEN status = 'applied' THEN 'applied'
            WHEN status = 'applying'
              AND EXISTS (
                SELECT 1 FROM stripe_extension_application_effects AS e
                WHERE e.application_id = stripe_extension_applications.id
              )
              AND EXISTS (
                SELECT 1 FROM audit_logs AS al
                WHERE al.action = 'LICENSE_EXTENDED' AND al.resource_type = 'fanmark_license'
                  AND al.resource_id = stripe_extension_applications.license_id
                  AND json_extract(al.metadata, '$.payment_session_id') = stripe_extension_applications.stripe_checkout_session_id
              )
              AND NOT EXISTS (
                SELECT 1 FROM stripe_extension_application_lottery_entries AS x
                WHERE x.application_id = stripe_extension_applications.id AND x.status <> 'cancelled'
              )
              AND (
                NOT EXISTS (
                  SELECT 1 FROM stripe_extension_application_effects AS e
                  WHERE e.application_id = stripe_extension_applications.id AND e.cancelled_lottery_entries_count > 0
                ) OR EXISTS (
                  SELECT 1 FROM audit_logs AS al
                  JOIN stripe_extension_application_effects AS e ON e.application_id = stripe_extension_applications.id
                  WHERE al.action = 'LICENSE_EXTENDED_LOTTERY_CANCELLED'
                    AND al.resource_type = 'fanmark_license' AND al.resource_id = stripe_extension_applications.license_id
                    AND json_extract(al.metadata, '$.payment_session_id') = stripe_extension_applications.stripe_checkout_session_id
                    AND json_extract(al.metadata, '$.cancelled_entries_count') = e.cancelled_lottery_entries_count
                )
              ) THEN 'applied'
            ELSE 'invalid'
          END,
          result_code = CASE WHEN status = 'applying' THEN 'applied' ELSE result_code END,
          failure_code = NULL,
          applied_receipt_id = CASE WHEN status = 'applying' THEN ? ELSE applied_receipt_id END,
          previous_license_end = coalesce(previous_license_end, ?),
          new_license_end = coalesce(new_license_end, ?),
          applied_at = CASE WHEN status = 'applying' THEN ? ELSE applied_at END,
          terminal_at = CASE WHEN status = 'applying' THEN ? ELSE terminal_at END,
          last_receipt_id = ?, updated_at = ?
      WHERE livemode = ? AND stripe_checkout_session_id = ?
        AND billing_intent_id = ? AND user_id = ? AND license_id = ? AND fanmark_id = ?
        AND tier_level = ? AND months = ? AND expected_total_yen = ? AND allow_zero_total = 0
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = ? AND d.status = 'processing'
            AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
        )
    `).bind(receipt.receipt_id, license.license_end, args.newLicenseEnd, lease.now, lease.now,
      receipt.receipt_id, lease.now, lease.livemode, sessionId, params.intentId,
      params.userId, params.licenseId, params.fanmarkId, params.tierLevel, params.months,
      params.expectedTotalYen, lease.dispatchId, lease.receiptId, lease.leaseToken, lease.generation, lease.now),
    args.database.prepare(`
      UPDATE stripe_extension_checkout_intents
      SET status = 'applied', stripe_session_status = ?, stripe_payment_status = 'paid', updated_at = ?
      WHERE id = ? AND stripe_checkout_session_id = ? AND status IN ('open', 'awaiting_payment_confirmation')
        AND EXISTS (
          SELECT 1 FROM stripe_extension_applications AS a
          WHERE a.billing_intent_id = stripe_extension_checkout_intents.id AND a.status = 'applied'
        )
    `).bind(args.sessionStatus, lease.now, params.intentId, sessionId),
    args.database.prepare(`
      UPDATE stripe_webhook_receipts
      SET status = 'applied', terminal_at = ?, last_error_code = NULL,
          last_error_message = NULL, updated_at = ?
      WHERE id = ? AND livemode = ? AND status = 'processing'
        AND EXISTS (
          SELECT 1 FROM stripe_extension_applications AS a
          WHERE a.livemode = ? AND a.stripe_checkout_session_id = ?
            AND a.billing_intent_id = ? AND a.status = 'applied'
        )
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d
          WHERE d.id = ? AND d.receipt_id = stripe_webhook_receipts.id
            AND d.status = 'processing' AND d.lease_token = ?
            AND d.claim_generation = ? AND d.lease_until > ?
        )
    `).bind(lease.now, lease.now, lease.receiptId, lease.livemode,
      lease.livemode, sessionId, params.intentId,
      lease.dispatchId, lease.leaseToken, lease.generation, lease.now),
    args.database.prepare(`
      UPDATE stripe_webhook_dispatches
      SET status = 'completed', claimed_at = NULL, lease_until = NULL, lease_token = NULL,
          completed_at = ?, last_error_code = NULL, last_error_message = NULL, updated_at = ?
      WHERE id = ? AND receipt_id = ? AND livemode = ? AND status = 'processing'
        AND lease_token = ? AND claim_generation = ? AND lease_until > ? AND changes() = 1
        AND EXISTS (
          SELECT 1 FROM stripe_webhook_receipts AS r
          WHERE r.id = stripe_webhook_dispatches.receipt_id AND r.status = 'applied'
            AND r.terminal_at = ?
        )
    `).bind(lease.now, lease.now, lease.dispatchId, lease.receiptId, lease.livemode,
      lease.leaseToken, lease.generation, lease.now, lease.now),
  ]);

  const terminal = await readResult(args.database, lease.receiptId, receipt.receipt_id, "applied", null);
  const application = await args.database.prepare(`
    SELECT id, status, new_license_end FROM stripe_extension_applications
    WHERE livemode = ? AND stripe_checkout_session_id = ?
  `).bind(lease.livemode, sessionId).first<{ id: string; status: string; new_license_end: string | null }>();
  if (application?.status !== "applied") {
    const existingAudit = await args.database.prepare(`
      SELECT 1 AS found FROM audit_logs WHERE action = 'LICENSE_EXTENDED'
        AND resource_type = 'fanmark_license' AND resource_id = ?
        AND json_extract(metadata, '$.payment_session_id') = ? LIMIT 1
    `).bind(params.licenseId, sessionId).first<{ found: number }>();
    if (existingAudit) {
      throw new StripeWebhookD1ApplicationError("legacy_payment_effect_reconciliation_required");
    }
    throw new StripeWebhookD1ApplicationError("extension_effect_readback_mismatch");
  }
  return {
    ...terminal,
    outcome: application.id === args.applicationId ? terminal.outcome : "duplicate_session",
    applicationId: application.id,
    licenseEnd: application.new_license_end,
  };
}

export async function applyStripeExtensionReceiptInD1(args: {
  database: D1Database;
  identity: StripeWebhookD1LeaseIdentity;
  now?: string;
  createId?: () => string;
}): Promise<StripeExtensionD1ApplicationResult> {
  const now = args.now ?? new Date().toISOString().replace(/\.\d{3}Z$/u, (fraction) => `${fraction.slice(0, 4)}000Z`);
  const lease = leaseValues(args.identity, now);
  const receipt = await args.database.prepare(`
    SELECT r.id AS receipt_id, r.stripe_event_id, r.livemode, r.event_type,
      r.object_type, r.object_id, r.normalized_payload, r.status, r.terminal_at,
      d.id AS dispatch_id, d.status AS dispatch_status, d.lease_token,
      d.claim_generation, d.lease_until
    FROM stripe_webhook_receipts AS r
    JOIN stripe_webhook_dispatches AS d
      ON d.receipt_id = r.id AND d.livemode = r.livemode AND d.stripe_event_id = r.stripe_event_id
    WHERE r.id = ? AND d.id = ? AND r.livemode = ? AND r.status = 'processing'
      AND d.status = 'processing' AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
  `).bind(lease.receiptId, lease.dispatchId, lease.livemode, lease.leaseToken, lease.generation, lease.now)
    .first<ReceiptRow>();
  if (!receipt) throw new StripeWebhookD1ApplicationError("active_claim_not_found");
  if (!PAYMENT_EVENTS.has(receipt.event_type)) {
    throw new StripeWebhookD1ApplicationError("unsupported_stripe_extension_event");
  }
  if (receipt.object_type !== "checkout_session" && receipt.object_type !== "checkout.session") {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_object_type_invalid", receiptId: receipt.receipt_id });
  }
  let payload: JsonObject | null;
  try {
    payload = record(JSON.parse(receipt.normalized_payload));
  } catch {
    payload = null;
  }
  const session = record(payload?.checkout_session);
  if (!session || session.id !== receipt.object_id || typeof receipt.object_id !== "string") {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_session_metadata_invalid", receiptId: receipt.receipt_id });
  }
  let metadata: ExtensionMetadata;
  try {
    metadata = extensionMetadata(session.metadata);
  } catch (error) {
    const code = error instanceof StripeWebhookD1ApplicationError ? error.code : "extension_session_metadata_invalid";
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: code, receiptId: receipt.receipt_id });
  }
  const sessionId = requiredText(session.id, "extension_session_metadata_invalid", 255);
  const sessionStatus = requiredText(session.status, "extension_checkout_session_not_complete", 32);
  const paymentStatus = typeof session.payment_status === "string" ? session.payment_status : null;
  const mode = session.mode;
  if (mode !== "payment") {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_checkout_session_not_payment", receiptId: receipt.receipt_id });
  }

  const intent = await readIntent(args.database, metadata.intentId);
  if (!intent || !intentMatches(intent, metadata, lease.livemode) ||
      (intent.stripe_checkout_session_id !== null && intent.stripe_checkout_session_id !== sessionId)) {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_intent_conflict", receiptId: receipt.receipt_id });
  }
  const otherIntent = await args.database.prepare(`
    SELECT id FROM stripe_extension_checkout_intents
    WHERE livemode = ? AND stripe_checkout_session_id = ? AND id <> ? LIMIT 1
  `).bind(lease.livemode, sessionId, metadata.intentId).first<{ id: string }>();
  if (otherIntent) {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_session_bound_to_other_intent", receiptId: receipt.receipt_id });
  }

  const application = await args.database.prepare(`
    SELECT id, billing_intent_id, user_id, license_id, fanmark_id, tier_level, months,
      expected_total_yen, allow_zero_total, status, failure_code, new_license_end
    FROM stripe_extension_applications
    WHERE livemode = ? AND stripe_checkout_session_id = ?
  `).bind(lease.livemode, sessionId).first<{
    id: string; billing_intent_id: string; user_id: string; license_id: string; fanmark_id: string;
    tier_level: number; months: number; expected_total_yen: number; allow_zero_total: number;
    status: string; failure_code: string | null; new_license_end: string | null;
  }>();
  if (application && (application.billing_intent_id !== metadata.intentId ||
      application.user_id.toLowerCase() !== metadata.userId || application.license_id.toLowerCase() !== metadata.licenseId ||
      application.fanmark_id.toLowerCase() !== metadata.fanmarkId || application.tier_level !== metadata.tierLevel ||
      application.months !== metadata.months || application.expected_total_yen !== metadata.expectedTotalYen ||
      application.allow_zero_total !== 0)) {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_session_metadata_conflict", receiptId: receipt.receipt_id });
  }

  if (application?.status === "dead_letter") {
    return markDeadLetter({
      database: args.database, identity: args.identity, now,
      errorCode: application.failure_code ?? "extension_application_dead_letter",
      receiptId: receipt.receipt_id,
    });
  }

  if (application?.status === "applied") {
    const result = await args.database.batch([
      args.database.prepare(`
        UPDATE stripe_webhook_receipts SET status = 'applied', terminal_at = ?, updated_at = ?
        WHERE id = ? AND status = 'processing' AND EXISTS (
          SELECT 1 FROM stripe_webhook_dispatches AS d WHERE d.id = ? AND d.receipt_id = ?
            AND d.status = 'processing' AND d.lease_token = ? AND d.claim_generation = ? AND d.lease_until > ?
        )
      `).bind(lease.now, lease.now, lease.receiptId, lease.dispatchId, lease.receiptId,
        lease.leaseToken, lease.generation, lease.now),
      args.database.prepare(`
        UPDATE stripe_webhook_dispatches SET status = 'completed', claimed_at = NULL,
          lease_until = NULL, lease_token = NULL, completed_at = ?, updated_at = ?
        WHERE id = ? AND receipt_id = ? AND status = 'processing' AND lease_token = ?
          AND claim_generation = ? AND lease_until > ? AND changes() = 1
      `).bind(lease.now, lease.now, lease.dispatchId, lease.receiptId, lease.leaseToken, lease.generation, lease.now),
    ]);
    if (result[0]?.meta?.changes !== 1 || result[1]?.meta?.changes !== 1) {
      throw new StripeWebhookD1ApplicationError("duplicate_session_readback_mismatch");
    }
    const terminal = await readResult(args.database, lease.receiptId, receipt.receipt_id, "duplicate_session", null);
    return {
      ...terminal,
      applicationId: application.id,
      licenseEnd: application.new_license_end,
    };
  }

  if (["blocked_stale_owner", "reconciliation_required"].includes(intent.status)) {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_intent_conflict", receiptId: receipt.receipt_id });
  }
  if (["failed", "expired"].includes(intent.status) &&
      receipt.event_type !== "checkout.session.expired" && receipt.event_type !== "checkout.session.async_payment_failed") {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "payment_after_terminal_checkout_state", receiptId: receipt.receipt_id });
  }

  if (receipt.event_type === "checkout.session.expired" || receipt.event_type === "checkout.session.async_payment_failed") {
    const expectedStatus = receipt.event_type === "checkout.session.expired" ? "expired" : "complete";
    if (sessionStatus !== expectedStatus) {
      return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_checkout_terminal_state_invalid", receiptId: receipt.receipt_id });
    }
    return markTerminalWithoutGrant({
      database: args.database, identity: args.identity, now, receiptId: receipt.receipt_id,
      intentId: metadata.intentId, sessionId, sessionStatus, paymentStatus,
      outcome: "no_grant", intentStatus: receipt.event_type === "checkout.session.expired" ? "expired" : "failed",
      applicationId: application?.id ?? (args.createId ?? (() => crypto.randomUUID()))(), metadata,
    });
  }

  if (sessionStatus !== "complete") {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_checkout_session_not_complete", receiptId: receipt.receipt_id });
  }
  if (paymentStatus === "unpaid" && receipt.event_type === "checkout.session.completed") {
    return markTerminalWithoutGrant({
      database: args.database, identity: args.identity, now, receiptId: receipt.receipt_id,
      intentId: metadata.intentId, sessionId, sessionStatus, paymentStatus,
      outcome: "awaiting_payment", intentStatus: "awaiting_payment_confirmation",
      applicationId: application?.id ?? (args.createId ?? (() => crypto.randomUUID()))(), metadata,
    });
  }
  if (paymentStatus !== "paid" || session.currency !== "jpy" ||
      !Number.isSafeInteger(session.amount_total) || session.amount_total !== metadata.expectedTotalYen ||
      intent.expected_total_yen !== metadata.expectedTotalYen || intent.currency !== "jpy" || intent.allow_zero_total !== 0) {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_payment_not_verified", receiptId: receipt.receipt_id });
  }
  if (receipt.event_type !== "checkout.session.completed" && receipt.event_type !== "checkout.session.async_payment_succeeded") {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_checkout_event_unsupported", receiptId: receipt.receipt_id });
  }

  const terminalIntent = ["failed", "expired"].includes(intent.status);
  if (terminalIntent) {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "payment_after_terminal_checkout_state", receiptId: receipt.receipt_id });
  }
  const pendingRequest = await args.database.prepare(`
    SELECT 1 AS found FROM fanmark_transfer_requests
    WHERE license_id = ? AND status IN ('pending', 'approved') LIMIT 1
  `).bind(metadata.licenseId).first<{ found: number }>();
  const license = await readLicense(args.database, metadata);
  const eligibilityError = licenseError(license, metadata, canonicalUtc(parseUtcTimestamp(now, "invalid_timestamp")));
  if (eligibilityError) {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: eligibilityError, receiptId: receipt.receipt_id });
  }
  if (pendingRequest) {
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: "extension_license_ineligible", receiptId: receipt.receipt_id });
  }

  const normalizedNow = canonicalUtc(parseUtcTimestamp(now, "invalid_timestamp"));
  const baseEnd = canonicalUtc(parseUtcTimestamp(license!.license_end!, "invalid_license_end")) > normalizedNow
    ? license!.license_end!
    : normalizedNow;
  let newLicenseEnd: string;
  try {
    newLicenseEnd = addMonthsAndRoundUp(baseEnd, metadata.months);
  } catch (error) {
    const code = error instanceof StripeWebhookD1ApplicationError ? error.code : "invalid_license_end";
    return markDeadLetter({ database: args.database, identity: args.identity, now, errorCode: code, receiptId: receipt.receipt_id });
  }
  return completePaidExtension({
    database: args.database, identity: args.identity, now, receipt, sessionId, sessionStatus,
    paymentStatus, metadata, applicationId: application?.id ?? (args.createId ?? (() => crypto.randomUUID()))(),
    license: license!, newLicenseEnd,
  });
}
