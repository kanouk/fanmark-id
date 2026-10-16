const INSERT_SQL = `INSERT INTO emoji_master
  (id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

function fail(code) {
  throw new Error(code);
}

export function utcMicrosecondTimestamp(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) fail("canonical_catalog_clock_invalid");
  return date.toISOString().replace(/\.(\d{3})Z$/u, (_match, milliseconds) => `.${milliseconds}000Z`);
}

export function buildCanonicalEmojiMasterInsert(record, importedAt) {
  if (!record || typeof record !== "object" ||
      !Array.isArray(record.keywords) || !Array.isArray(record.codepoints)) {
    fail("canonical_catalog_record_invalid");
  }
  const timestampYear = typeof importedAt === "string" ? importedAt.slice(0, 4) : "0000";
  const timestampMilliseconds = typeof importedAt === "string"
    ? importedAt.replace(/\.(\d{3})\d{3}Z$/u, ".$1Z")
    : "";
  const parsedTimestamp = typeof importedAt === "string" ? new Date(importedAt) : null;
  if (typeof importedAt !== "string" || !TIMESTAMP_RE.test(importedAt) || timestampYear === "0000" ||
      !parsedTimestamp || Number.isNaN(parsedTimestamp.getTime()) ||
      parsedTimestamp.toISOString() !== timestampMilliseconds) {
    fail("canonical_catalog_timestamp_invalid");
  }
  return Object.freeze({
    sql: INSERT_SQL,
    bindings: Object.freeze([
      record.id,
      record.emoji,
      record.short_name,
      JSON.stringify(record.keywords),
      record.category,
      record.subcategory,
      JSON.stringify(record.codepoints),
      record.sort_order,
      importedAt,
      importedAt,
    ]),
  });
}
