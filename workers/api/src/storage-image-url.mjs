/** Read projection only: preserve imported rows and their snapshot hashes. */
const SOURCE_PREFIX = '/storage/v1/object/public/';
const BUCKETS = new Set(['avatars', 'cover-images']);
const fail = () => { const error = new Error('storage_image_mapping_invalid');
  error.code = 'storage_image_mapping_invalid'; throw error; };

function configuredOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail(); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail();
  return url.origin;
}

export function mapStoredStorageImageUrl(value, bucket, env = {}) {
  if (value === null || value === '' || env.STORAGE_BACKEND?.trim() !== 'r2' || !env.STORAGE_LEGACY_ORIGIN?.trim()) return value;
  if (typeof value !== 'string' || !BUCKETS.has(bucket)) fail();
  const source = configuredOrigin(env.STORAGE_LEGACY_ORIGIN);
  const target = configuredOrigin(env.STORAGE_PUBLIC_BASE_URL);
  let url;
  try { url = new URL(value); } catch { return value; }
  if (url.origin !== source) return value;
  if (url.username || url.password || url.search || url.hash || !url.pathname.startsWith(SOURCE_PREFIX)) fail();
  // URL parsing normalizes dot paths. Refuse that normalization before decoding
  // keys; source object identity is never repaired or silently rewritten.
  const rawPath = /^[a-z]+:\/\/[^/?#]+([^?#]*)/iu.exec(value)?.[1];
  if (rawPath !== url.pathname) fail();
  const parts = url.pathname.slice(SOURCE_PREFIX.length).split('/');
  if (parts.shift() !== bucket || parts.length < 2 || parts.length > 32) fail();
  let key;
  try { key = parts.map(decodeURIComponent); } catch { fail(); }
  if (key.some(part => !part || part === '.' || part === '..' || part.includes('/') || part.includes('\\') ||
      [...part].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) ||
      new TextEncoder().encode(key.join('/')).byteLength > 1024) fail();
  return `${target}/api/storage/public/${bucket}/${key.map(encodeURIComponent).join('/')}`;
}

export function mapStoredProfileImages(theme, env = {}) {
  const result = { ...theme };
  for (const [field, bucket] of [['cover_image_url', 'cover-images'], ['profile_image_url', 'avatars']]) {
    if (typeof result[field] === 'string') result[field] = mapStoredStorageImageUrl(result[field], bucket, env);
  }
  return result;
}

/** A form returning the projected URL has not changed the underlying asset. */
export function preserveStoredImagePatch(value, current, bucket, env = {}) {
  if (value === current || value === mapStoredStorageImageUrl(current, bucket, env)) return current;
  return mapStoredStorageImageUrl(value, bucket, env);
}
