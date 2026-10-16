export interface StripeExtensionApplicationResult {
  receipt_id: string;
  outcome: string;
  receipt_status: string;
  dispatch_status: string;
}

export function validateStripeExtensionApplicationResult(
  receiptId: string,
  value: unknown,
): StripeExtensionApplicationResult {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("stripe extension application returned an invalid result");
  }

  const row = value[0];
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("stripe extension application returned an invalid result");
  }
  const result = row as Record<string, unknown>;
  const validPair =
    ((result.outcome === "applied" ||
      result.outcome === "duplicate_session" ||
      result.outcome === "legacy_audit_reconciled") &&
      result.receipt_status === "applied" &&
      result.dispatch_status === "completed") ||
    ((result.outcome === "awaiting_payment" || result.outcome === "no_grant") &&
      result.receipt_status === "ignored" &&
      result.dispatch_status === "completed") ||
    (result.outcome === "dead_letter" &&
      result.receipt_status === "dead_letter" &&
      result.dispatch_status === "dead_letter") ||
    (result.outcome === "duplicate_terminal" &&
      ((result.receipt_status === "applied" && result.dispatch_status === "completed") ||
        (result.receipt_status === "ignored" && result.dispatch_status === "completed") ||
        (result.receipt_status === "dead_letter" && result.dispatch_status === "dead_letter")));

  if (result.receipt_id !== receiptId || !validPair) {
    throw new Error("stripe extension application returned an inconsistent terminal result");
  }

  return {
    receipt_id: receiptId,
    outcome: result.outcome as string,
    receipt_status: result.receipt_status as string,
    dispatch_status: result.dispatch_status as string,
  };
}
