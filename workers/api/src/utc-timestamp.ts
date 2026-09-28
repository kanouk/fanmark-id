/** Format a JavaScript clock value as the fixed-width UTC text used by D1. */
export function toUtcMicrosecondTimestamp(date: Date): string {
  return date.toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
}
