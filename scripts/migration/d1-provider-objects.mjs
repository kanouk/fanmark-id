/** Cloudflare-owned objects that appear in D1 schema inventories. */
const D1_PROVIDER_OBJECTS = new Set([
  "table:_cf_KV",
  "table:_cf_METADATA",
  "table:d1_migrations",
]);

export function isD1ProviderObject(type, name) {
  return D1_PROVIDER_OBJECTS.has(`${String(type)}:${String(name)}`);
}
