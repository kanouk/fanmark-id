const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface StripeCustomerUserMappingRow {
  userId: string;
  stripeCustomerId: string | null;
}

export interface StripeCustomerUserMappingRepository {
  findByStripeCustomerId(customerId: string): PromiseLike<StripeCustomerUserMappingRow[]>;
  findByUserId(userId: string): PromiseLike<StripeCustomerUserMappingRow[]>;
  linkIfUnbound(userId: string, customerId: string): PromiseLike<boolean>;
}

export interface StripeCustomerMappingProvider {
  retrieveCustomer(customerId: string): PromiseLike<unknown>;
}

export class StripeCustomerUserMappingError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "StripeCustomerUserMappingError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireCustomerId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || value.trim() !== value) {
    throw new StripeCustomerUserMappingError("stripe_customer_mapping_invalid");
  }
  return value;
}

function metadataUserId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !USER_ID_RE.test(value)) {
    throw new StripeCustomerUserMappingError("stripe_customer_metadata_invalid");
  }
  return value.toLowerCase();
}

function validateRows(rows: StripeCustomerUserMappingRow[], code: string): StripeCustomerUserMappingRow[] {
  if (!Array.isArray(rows) || rows.length > 2 || rows.some((row) =>
    row === null || typeof row.userId !== "string" || !USER_ID_RE.test(row.userId) ||
    (row.stripeCustomerId !== null && typeof row.stripeCustomerId !== "string")
  )) {
    throw new StripeCustomerUserMappingError(code);
  }
  return rows.map((row) => ({
    userId: row.userId.toLowerCase(),
    stripeCustomerId: row.stripeCustomerId,
  }));
}

/**
 * Resolve a Stripe customer only from the persisted customer mapping or a
 * checked Customer.metadata.user_id. An email match is never an identity link.
 */
export async function resolveStripeCustomerUserMapping(input: {
  repository: StripeCustomerUserMappingRepository;
  provider: StripeCustomerMappingProvider;
  customerId: string;
  livemode: boolean;
}): Promise<string> {
  const customerId = requireCustomerId(input.customerId);
  if (typeof input.livemode !== "boolean") {
    throw new StripeCustomerUserMappingError("stripe_customer_mapping_invalid");
  }

  const customer = asRecord(await input.provider.retrieveCustomer(customerId));
  if (customer === null || customer.deleted === true || customer.id !== customerId) {
    throw new StripeCustomerUserMappingError("stripe_customer_unavailable");
  }
  if (customer.livemode !== input.livemode) {
    throw new StripeCustomerUserMappingError("stripe_customer_mode_mismatch");
  }

  const metadata = asRecord(customer.metadata);
  const metadataId = metadataUserId(metadata?.user_id);
  const directRows = validateRows(
    await input.repository.findByStripeCustomerId(customerId),
    "stripe_customer_mapping_ambiguous",
  );
  if (directRows.length > 1) {
    throw new StripeCustomerUserMappingError("stripe_customer_mapping_ambiguous");
  }
  const directId = directRows[0]?.userId ?? null;
  if (directId !== null && metadataId !== null && directId !== metadataId) {
    throw new StripeCustomerUserMappingError("stripe_customer_mapping_conflict");
  }

  const userId = directId ?? metadataId;
  if (userId === null) {
    throw new StripeCustomerUserMappingError("stripe_customer_mapping_review_required");
  }

  const userRows = validateRows(
    await input.repository.findByUserId(userId),
    "stripe_customer_mapping_review_required",
  );
  if (userRows.length !== 1 || userRows[0].userId !== userId) {
    throw new StripeCustomerUserMappingError("stripe_customer_mapping_review_required");
  }
  const linkedCustomerId = userRows[0].stripeCustomerId;
  if (linkedCustomerId !== null && linkedCustomerId !== customerId) {
    throw new StripeCustomerUserMappingError("stripe_customer_mapping_conflict");
  }

  if (directId === null) {
    const linked = await input.repository.linkIfUnbound(userId, customerId);
    if (!linked) {
      const concurrentRows = validateRows(
        await input.repository.findByStripeCustomerId(customerId),
        "stripe_customer_mapping_ambiguous",
      );
      if (concurrentRows.length !== 1 || concurrentRows[0].userId !== userId) {
        throw new StripeCustomerUserMappingError("stripe_customer_mapping_conflict");
      }
    }
  }

  return userId;
}
