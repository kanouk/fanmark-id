const encoder = new TextEncoder();

/** jsonb iterates object keys by UTF-8 byte length, then byte value. */
export function postgresJsonbKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).map(key => ({ key, bytes: encoder.encode(key) }))
    .sort((left, right) => {
      const size = left.bytes.length - right.bytes.length;
      if (size !== 0) return size;
      for (let index = 0; index < left.bytes.length; index += 1) {
        const difference = left.bytes[index] - right.bytes[index];
        if (difference !== 0) return difference;
      }
      return 0;
    }).map(entry => entry.key);
}

function postgresNumber(value: number): string | null {
  // Supabase serializes the Edge worker's JS payload back to JSON before the
  // render RPC. Non-finite values become JSON null and negative zero becomes 0.
  if (!Number.isFinite(value)) return null;
  const literal = JSON.stringify(value);
  const scientific = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/u.exec(literal);
  if (!scientific) return literal;
  const [, sign, integer, fractional = "", exponent] = scientific;
  const digits = integer + fractional;
  const decimalPosition = integer.length + Number(exponent);
  if (decimalPosition <= 0) return `${sign}0.${"0".repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length) return sign + digits + "0".repeat(decimalPosition - digits.length);
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function postgresJsonbText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return postgresNumber(value) ?? "null";
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(", ")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${postgresJsonbKeys(record).map(key => `${JSON.stringify(key)}: ${postgresJsonbText(record[key])}`).join(", ")}}`;
  }
  throw new Error("notification_template_value_invalid");
}

/** PostgreSQL's payload->>key text after the source Edge payload JSON round trip. */
export function postgresTemplateValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return postgresNumber(value);
  return postgresJsonbText(value);
}
