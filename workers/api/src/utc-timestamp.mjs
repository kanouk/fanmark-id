/**
 * @param {Date} date
 * @returns {string}
 */
export function toUtcMicrosecondTimestamp(date) {
  return date.toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction) => `.${fraction}000Z`);
}
