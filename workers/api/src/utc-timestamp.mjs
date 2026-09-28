const UTC_MICROSECOND_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}(?:Z|\+00:00)$/u;

/**
 * @param {Date} date
 * @returns {string}
 */
export function toUtcMicrosecondTimestamp(date) {
  return date.toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction) => `.${fraction}000Z`);
}

/** Validate exact six-digit UTC timestamp text without rounding its fraction. */
export function assertUtcMicrosecondTimestamp(value) {
  if (typeof value !== "string" || !UTC_MICROSECOND_TIMESTAMP_RE.test(value) || value.startsWith("0000")) {
    throw new RangeError("invalid_utc_microsecond_timestamp");
  }
  const canonicalUtc = value.endsWith("+00:00") ? `${value.slice(0, -6)}Z` : value;
  const wholeSeconds = `${canonicalUtc.slice(0, 19)}.000Z`;
  const parsed = new Date(wholeSeconds);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== wholeSeconds) {
    throw new RangeError("invalid_utc_microsecond_timestamp");
  }
  return value;
}
