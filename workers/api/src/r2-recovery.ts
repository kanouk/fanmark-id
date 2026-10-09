/** Privileged whole-bucket recovery. No public route, automatic collector or deletion. */
export type R2RecoveryKind = "avatars" | "cover-images";
export type R2RecoveryObject = {key: string; size: number; sha256: string; bytes: string;
  httpMetadata: Record<string, string>; customMetadata: Record<string, string>; storageClass: string};
export type R2RecoverySnapshot = {kind: R2RecoveryKind; objects: R2RecoveryObject[]; objectsHash: string};
export type R2RecoveryArchive = {format: "fanmark-r2-recovery-v1"; kind: R2RecoveryKind; objectsHash: string;
  nonce: string; ciphertext: string};
const HASH = /^[0-9a-f]{64}$/u;
const MAX_OBJECTS = 1000, MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024, MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const HTTP_KEYS = ["cacheControl", "cacheExpiry", "contentDisposition", "contentEncoding", "contentLanguage", "contentType"];
const encoder = new TextEncoder();
function fail(code: string): never {throw new Error(`r2_recovery_${code}`);}
function kind(value: unknown): asserts value is R2RecoveryKind {
  if (value !== "avatars" && value !== "cover-images") fail("kind_invalid");
}
function canonical(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
}
function metadataValid(value: unknown): value is Record<string, string> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every(v => typeof v === "string") && encoder.encode(JSON.stringify(value)).length <= 16_384;
}
function base64(bytes: Uint8Array): string {
  // Keep each binary string bounded; full-size intermediate strings exhaust
  // the Worker heap when opening an archive at the supported capacity.
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 8190) {
    encoded += btoa(String.fromCharCode(...bytes.subarray(i, i + 8190)));
  }
  return encoded;
}
function decode(value: string, maximum: number): Uint8Array {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(maximum / 3) || value.length % 4) fail("encoding_invalid");
  const size = value.length / 4 * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  if (size > maximum) fail("encoding_invalid");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (let i = 0; i < value.length; i += 32768) {
    const part = value.slice(i, i + 32768);
    let binary: string;
    try {binary = atob(part);} catch {fail("encoding_invalid");}
    // Canonical chunk roundtrip rejects whitespace, bad padding and pad bits
    // without allocating another archive-sized binary/base64 string.
    if (btoa(binary) !== part || offset + binary.length > size) fail("encoding_invalid");
    for (let j = 0; j < binary.length; j++) bytes[offset++] = binary.charCodeAt(j);
  }
  if (offset !== size) fail("encoding_invalid");
  return bytes;
}
function copySnapshot(snapshot: R2RecoverySnapshot): R2RecoverySnapshot {
  if (!snapshot || !Array.isArray(snapshot.objects) || snapshot.objects.length > MAX_OBJECTS) fail("snapshot_invalid");
  return {...snapshot, objects: snapshot.objects.map(object => {
    if (!object || !metadataValid(object.httpMetadata) || !metadataValid(object.customMetadata)) fail("snapshot_invalid");
    // All scalar strings are immutable, including the large base64 payload.
    // Copy the mutable containers without serializing those strings again.
    return {...object, httpMetadata: {...object.httpMetadata}, customMetadata: {...object.customMetadata}};
  })};
}
async function byteHash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}
export async function r2RecoveryDigest(value: unknown): Promise<string> {
  const bytes = encoder.encode(JSON.stringify(value));
  try {return await byteHash(bytes);} finally {bytes.fill(0);}
}
function normalized(objects: R2RecoveryObject[]): R2RecoveryObject[] {
  return objects.map(o => ({key: o.key, size: o.size, sha256: o.sha256, bytes: o.bytes,
    httpMetadata: canonical(o.httpMetadata), customMetadata: canonical(o.customMetadata), storageClass: o.storageClass}))
    .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
async function validate(snapshot: R2RecoverySnapshot, expectedKind: R2RecoveryKind): Promise<void> {
  kind(expectedKind);
  if (!snapshot || snapshot.kind !== expectedKind || !HASH.test(snapshot.objectsHash) ||
      !Array.isArray(snapshot.objects) || snapshot.objects.length > MAX_OBJECTS ||
      new Set(snapshot.objects.map(o => o?.key)).size !== snapshot.objects.length) fail("snapshot_invalid");
  let total = 0;
  for (const object of snapshot.objects) {
    if (!object || typeof object.key !== "string" || !object.key.length || encoder.encode(object.key).length > 1024 ||
        !Number.isSafeInteger(object.size) || object.size < 0 || object.size > MAX_OBJECT_BYTES ||
        !HASH.test(object.sha256) || !metadataValid(object.httpMetadata) || !metadataValid(object.customMetadata) ||
        Object.keys(object.httpMetadata).some(key => !HTTP_KEYS.includes(key)) ||
        (object.httpMetadata.cacheExpiry !== undefined &&
          (!Number.isFinite(Date.parse(object.httpMetadata.cacheExpiry)) ||
            new Date(object.httpMetadata.cacheExpiry).toISOString() !== object.httpMetadata.cacheExpiry)) ||
        !["Standard", "InfrequentAccess"].includes(object.storageClass)) fail("snapshot_invalid");
    total += object.size;
    if (total > MAX_TOTAL_BYTES) fail("capacity_exceeded");
    const bytes = decode(object.bytes, MAX_OBJECT_BYTES);
    try {
      if (bytes.length !== object.size) fail("snapshot_invalid_size");
      if (await byteHash(bytes) !== object.sha256) fail("snapshot_invalid_hash");
    }
    finally {bytes.fill(0);}
  }
  if (await r2RecoveryDigest(normalized(snapshot.objects)) !== snapshot.objectsHash) fail("snapshot_invalid");
}
function semanticMetadata(object: R2Object) {
  const raw = object.httpMetadata ?? {};
  // Native workerd exposes known optional HTTP fields as enumerable undefined values.
  // Treat those as absent; unknown keys and invalid defined values still fail below.
  const httpMetadata = Object.fromEntries(Object.entries(raw).filter(([key, value]) =>
    !HTTP_KEYS.includes(key) || value !== undefined).map(([key, value]) =>
    [key, key === "cacheExpiry" && value instanceof Date ? value.toISOString() : value]));
  if (object.ssecKeyMd5 || !metadataValid(httpMetadata) || !metadataValid(object.customMetadata ?? {}) ||
      Object.keys(httpMetadata).some(key => !HTTP_KEYS.includes(key))) fail("source_metadata_invalid");
  return {key: object.key, size: object.size, httpMetadata: canonical(httpMetadata),
    customMetadata: canonical(object.customMetadata ?? {}), storageClass: object.storageClass};
}
function identity(object: R2Object) {
  return {...semanticMetadata(object), etag: object.etag, version: object.version, uploaded: object.uploaded.toISOString()};
}
async function inventory(bucket: R2Bucket): Promise<R2Object[]> {
  const objects: R2Object[] = [], seen = new Set<string>();
  let cursor: string | undefined;
  do {
    let page: R2Objects;
    try {page = await bucket.list({limit: 200, cursor, include: ["httpMetadata", "customMetadata"]});}
    catch {fail("list_failed");}
    objects.push(...page.objects);
    if (objects.length > MAX_OBJECTS || new Set(objects.map(o => o.key)).size !== objects.length) fail("capacity_exceeded");
    if (!page.truncated) break;
    if (!page.cursor || seen.has(page.cursor)) fail("pagination_invalid");
    seen.add(page.cursor); cursor = page.cursor;
  } while (cursor !== undefined);
  return objects.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
/** Reject observed changes; repeated reads are not an atomic cross-store snapshot. */
export async function captureR2RecoverySnapshot(bucket: R2Bucket, expectedKind: R2RecoveryKind): Promise<R2RecoverySnapshot> {
  kind(expectedKind);
  const before = await inventory(bucket), objects: R2RecoveryObject[] = [];
  let total = 0;
  for (const listed of before) {
    if (!Number.isSafeInteger(listed.size) || listed.size < 0 || listed.size > MAX_OBJECT_BYTES ||
        (total += listed.size) > MAX_TOTAL_BYTES) fail("capacity_exceeded");
    let object: R2ObjectBody | R2Object | null;
    try {object = await bucket.get(listed.key, {onlyIf: {etagMatches: listed.etag}});} catch {fail("capture_failed");}
    // Accessing body on a cross-runtime proxy transfers its stream; use arrayBuffer once instead.
    if (!object || typeof (object as R2ObjectBody).arrayBuffer !== "function" ||
        JSON.stringify(identity(object)) !== JSON.stringify(identity(listed))) fail("source_changed");
    let bytes: Uint8Array;
    try {bytes = new Uint8Array(await (object as R2ObjectBody).arrayBuffer());} catch {fail("capture_failed");}
    try {
      if (bytes.length !== listed.size) fail("source_changed");
      objects.push({...semanticMetadata(object), bytes: base64(bytes), sha256: await byteHash(bytes)});
    } finally {bytes.fill(0);}
  }
  const after = await inventory(bucket);
  if (JSON.stringify(before.map(identity)) !== JSON.stringify(after.map(identity))) fail("source_changed");
  const snapshot = {kind: expectedKind, objects: normalized(objects), objectsHash: "0".repeat(64)};
  snapshot.objectsHash = await r2RecoveryDigest(snapshot.objects);
  await validate(snapshot, expectedKind); return snapshot;
}
function archiveKey(key: CryptoKey, usage: "encrypt" | "decrypt"): void {
  if (!key || key.type !== "secret" || key.algorithm?.name !== "AES-GCM" ||
      (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes(usage)) fail("archive_key_invalid");
}
function aad(archive: Pick<R2RecoveryArchive, "format" | "kind" | "objectsHash">): Uint8Array {
  return encoder.encode(JSON.stringify({format: archive.format, kind: archive.kind, objectsHash: archive.objectsHash}));
}
export async function sealR2RecoverySnapshot(snapshot: R2RecoverySnapshot, key: CryptoKey,
  expectedKind: R2RecoveryKind): Promise<R2RecoveryArchive> {
  archiveKey(key, "encrypt"); snapshot = copySnapshot(snapshot); await validate(snapshot, expectedKind);
  const plaintext = encoder.encode(JSON.stringify(snapshot));
  if (plaintext.length + 16 > MAX_ARCHIVE_BYTES) {plaintext.fill(0); fail("archive_too_large");}
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const archive: R2RecoveryArchive = {format: "fanmark-r2-recovery-v1", kind: expectedKind,
    objectsHash: snapshot.objectsHash, nonce: base64(nonce), ciphertext: ""};
  try {archive.ciphertext = base64(new Uint8Array(await crypto.subtle.encrypt(
    {name: "AES-GCM", iv: nonce, additionalData: aad(archive)}, key, plaintext)));}
  catch {fail("encryption_failed");} finally {plaintext.fill(0);}
  return archive;
}
export async function openR2RecoverySnapshot(archive: R2RecoveryArchive, key: CryptoKey,
  expectedKind: R2RecoveryKind): Promise<R2RecoverySnapshot> {
  kind(expectedKind); archiveKey(key, "decrypt"); archive = {...archive};
  if (!archive || archive.format !== "fanmark-r2-recovery-v1" || archive.kind !== expectedKind ||
      !HASH.test(archive.objectsHash)) fail("archive_invalid");
  const nonce = decode(archive.nonce, 12);
  let ciphertext = decode(archive.ciphertext, MAX_ARCHIVE_BYTES);
  if (nonce.length !== 12 || ciphertext.length < 16) fail("archive_invalid");
  // This is our private container. Drop the encoded ciphertext before decrypting,
  // then release byte buffers before allocating the parsed snapshot and its digest.
  archive.ciphertext = "";
  let plaintext: ArrayBuffer;
  try {plaintext = await crypto.subtle.decrypt({name: "AES-GCM", iv: nonce, additionalData: aad(archive)}, key, ciphertext);}
  catch {fail("decryption_failed");}
  finally {ciphertext.fill(0); ciphertext = new Uint8Array(0);}
  let text: string;
  try {text = new TextDecoder("utf-8", {fatal: true}).decode(plaintext);}
  catch {fail("snapshot_invalid");}
  finally {new Uint8Array(plaintext).fill(0); plaintext = new ArrayBuffer(0);}
  let snapshot: R2RecoverySnapshot;
  try {snapshot = JSON.parse(text) as R2RecoverySnapshot;}
  catch {fail("snapshot_invalid");}
  finally {text = "";}
  await validate(snapshot, expectedKind);
  if (snapshot.objectsHash !== archive.objectsHash) fail("snapshot_invalid");
  return snapshot;
}
/** Resume only an exact subset; neither mode overwrites or deletes an existing object. */
export async function restoreR2RecoverySnapshot(bucket: R2Bucket, snapshot: R2RecoverySnapshot,
  options: {expectedKind: R2RecoveryKind; mode: "new-empty" | "resume-exact"}): Promise<R2RecoverySnapshot> {
  if (!options || !["new-empty", "resume-exact"].includes(options.mode)) fail("target_mode_required");
  options = {...options}; snapshot = copySnapshot(snapshot); await validate(snapshot, options.expectedKind);
  snapshot.objects = normalized(snapshot.objects);
  const current = await captureR2RecoverySnapshot(bucket, options.expectedKind);
  if (options.mode === "new-empty" && current.objects.length) fail("target_not_empty");
  const wanted = new Map(snapshot.objects.map(o => [o.key, o]));
  for (const object of current.objects) {
    const expected = wanted.get(object.key);
    // Payload strings are already validated. Compare them directly without
    // allocating two full-size JSON strings for each retained object.
    if (!expected || object.size !== expected.size || object.sha256 !== expected.sha256 ||
        object.bytes !== expected.bytes || object.storageClass !== expected.storageClass ||
        JSON.stringify(object.httpMetadata) !== JSON.stringify(expected.httpMetadata) ||
        JSON.stringify(object.customMetadata) !== JSON.stringify(expected.customMetadata)) fail("target_mismatch");
  }
  const existing = new Set(current.objects.map(o => o.key));
  // Only the keys are needed after the exact-subset check. These are private
  // capture containers; release their payloads before the final independent read.
  current.objects.length = 0;
  for (const object of snapshot.objects) {
    if (existing.has(object.key)) continue;
    const bytes = decode(object.bytes, MAX_OBJECT_BYTES);
    const httpMetadata: R2HTTPMetadata = {...object.httpMetadata, cacheExpiry: object.httpMetadata.cacheExpiry === undefined
      ? undefined : new Date(object.httpMetadata.cacheExpiry)};
    try {
      const stored = await bucket.put(object.key, bytes, {onlyIf: {etagDoesNotMatch: "*"}, sha256: object.sha256,
        httpMetadata, customMetadata: object.customMetadata, storageClass: object.storageClass});
      if (!stored) fail("target_changed");
    } catch {fail("restore_failed");} finally {bytes.fill(0);}
  }
  const restoredHash = (await captureR2RecoverySnapshot(bucket, options.expectedKind)).objectsHash;
  if (restoredHash !== snapshot.objectsHash) fail("restore_verification_failed");
  // The complete native readback verified all desired bytes and metadata. Return
  // our normalized private containers, sharing only immutable payload strings,
  // so keeping the result does not duplicate a full bucket before exact resume.
  return {kind: snapshot.kind, objects: snapshot.objects, objectsHash: snapshot.objectsHash};
}
