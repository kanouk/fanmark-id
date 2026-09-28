const UTC_MICROSECOND_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}(?:Z|\+00:00)$/u;
const UTC_MILLISECOND_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:Z|\+00:00)$/u;

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

/** Normalize an exact UTC millisecond or microsecond timestamp for D1 writes. */
export function normalizeUtcMicrosecondTimestamp(value) {
  if (typeof value !== "string") throw new RangeError("invalid_utc_timestamp");
  if (UTC_MICROSECOND_TIMESTAMP_RE.test(value)) {
    assertUtcMicrosecondTimestamp(value);
    return value.replace(/\+00:00$/u, "Z");
  }
  if (!UTC_MILLISECOND_TIMESTAMP_RE.test(value)) throw new RangeError("invalid_utc_timestamp");
  const canonicalUtc = value.replace(/\+00:00$/u, "Z");
  const parsed = new Date(canonicalUtc);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== canonicalUtc) {
    throw new RangeError("invalid_utc_timestamp");
  }
  return toUtcMicrosecondTimestamp(parsed);
}

/** Add an integral number of milliseconds without dropping a timestamp's sub-ms digits. */
export function addUtcMilliseconds(value, milliseconds) {
  if (!Number.isSafeInteger(milliseconds)) throw new RangeError("invalid_utc_millisecond_delta");
  const normalized = normalizeUtcMicrosecondTimestamp(value);
  const match = /^(.*\.\d{3})(\d{3})Z$/u.exec(normalized);
  if (!match) throw new RangeError("invalid_utc_timestamp");
  const base = new Date(`${match[1]}Z`);
  if (!Number.isFinite(base.getTime())) throw new RangeError("invalid_utc_timestamp");
  const shifted = new Date(base.getTime() + milliseconds);
  const formatted = toUtcMicrosecondTimestamp(shifted);
  return formatted.replace(/\.(\d{3})000Z$/u, (_all, millis) => `.${millis}${match[2]}Z`);
}
