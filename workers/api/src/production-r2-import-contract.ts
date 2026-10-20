/** Bounded, deterministic import envelope shared by the operator and Worker. */
export const MAX_IMPORT_OBJECT_BYTES = 8 * 1024 * 1024;
export type ImportStore = "avatars" | "covers";
export type ImportObject = { store: ImportStore; key: string; size: number; sha256: string;
  httpMetadata: { contentType?: string }; customMetadata: Record<string, string> };
function fail(): never { throw Error("production_r2_import_input_invalid"); }
export function canonicalImportValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalImportValue).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalImportValue((value as Record<string, unknown>)[key])).join(",") + "}";
}
export function validateImportKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !key || new TextEncoder().encode(key).length > 1024 || /[\0\\]/u.test(key) ||
      key.split("/").some(part => !part || part === "." || part === "..")) fail();
}
export function validateImportObject(input: unknown): ImportObject {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  const value = input as ImportObject;
  if (Object.keys(value).sort().join(",") !== "customMetadata,httpMetadata,key,sha256,size,store" ||
      !["avatars", "covers"].includes(value.store) || !Number.isSafeInteger(value.size) || value.size < 0 ||
      value.size > MAX_IMPORT_OBJECT_BYTES || !/^[0-9a-f]{64}$/u.test(value.sha256)) fail();
  validateImportKey(value.key);
  if (!value.httpMetadata || typeof value.httpMetadata !== "object" || Array.isArray(value.httpMetadata) ||
      !value.customMetadata || typeof value.customMetadata !== "object" || Array.isArray(value.customMetadata)) fail();
  const contentType = value.httpMetadata.contentType;
  if (Object.keys(value.httpMetadata).sort().join(",") !== (contentType === undefined ? "" : "contentType") ||
      (contentType !== undefined && (typeof contentType !== "string" || !contentType || /[\r\n\0]/u.test(contentType)))) fail();
  const expected: Record<string, string> = { "fanmark-source-bucket": value.store === "avatars" ? "avatars" : "cover-images",
    "fanmark-source-key": value.key, "fanmark-source-sha256": value.sha256, "fanmark-source-size": String(value.size),
    ...(contentType === undefined ? {} : { "fanmark-source-content-type": contentType }) };
  if (canonicalImportValue(value.customMetadata) !== canonicalImportValue(expected) ||
      new TextEncoder().encode(JSON.stringify(expected)).length > 8192) fail();
  return JSON.parse(canonicalImportValue(value)) as ImportObject;
}
export async function importDigest(value: BufferSource): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", value))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export const importObjectDigest = (object: ImportObject) => importDigest(new TextEncoder().encode(canonicalImportValue(validateImportObject(object))));
