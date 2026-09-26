const AVATAR_MAX_BYTES = 1 * 1024 * 1024;
const COVER_MAX_BYTES = 2 * 1024 * 1024;
const RESPONSE_MAX_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:avif|gif|jpg|png|webp)$/i;
const IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export type StorageBucket = 'avatars' | 'cover-images';
export type StorageBackend = 'supabase' | 'r2';

export type StorageApiErrorKind =
  | 'configuration'
  | 'http'
  | 'invalid_file'
  | 'invalid_response'
  | 'network'
  | 'timeout';

export class StorageApiError extends Error {
  readonly kind: StorageApiErrorKind;
  readonly status?: number;

  constructor(kind: StorageApiErrorKind, status?: number) {
    super(kind === 'http' && status ? `storage request failed (${status})` : `storage request ${kind}`);
    this.name = 'StorageApiError';
    this.kind = kind;
    this.status = status;
  }
}

interface StorageApiOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]';
}

function resolvedBaseUrl(baseUrl?: string): URL {
  const configured = baseUrl?.trim() || import.meta.env?.VITE_FANMARK_API_BASE_URL?.trim();
  const value = configured || (typeof window === 'undefined' ? '' : window.location.origin);
  if (!value) throw new StorageApiError('configuration');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorageApiError('configuration');
  }

  const allowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHostname(url.hostname));
  if (
    !allowedProtocol ||
    url.username ||
    url.password ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search ||
    url.hash
  ) {
    throw new StorageApiError('configuration');
  }
  url.pathname = '';
  return url;
}

export function getStorageBackend(value: string | undefined = import.meta.env?.VITE_STORAGE_BACKEND): StorageBackend {
  const backend = value?.trim();
  if (!backend || backend === 'supabase') return 'supabase';
  if (backend === 'r2') return 'r2';
  throw new StorageApiError('configuration');
}

export function getImageStorageBackend(
  betterAuthEnabled: boolean,
  value: string | undefined = import.meta.env?.VITE_STORAGE_BACKEND,
): StorageBackend {
  const backend = getStorageBackend(value);
  if (backend === 'r2' && !betterAuthEnabled) throw new StorageApiError('configuration');
  return backend;
}

function apiUrl(base: URL, path: string): URL {
  if (!path.startsWith('/api/storage/')) throw new StorageApiError('configuration');
  const url = new URL(base.origin);
  url.pathname = path;
  return url;
}

function encodeKey(key: string): string {
  return key.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function validateOwnerId(ownerId: string): void {
  if (!UUID_PATTERN.test(ownerId)) throw new StorageApiError('configuration');
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new StorageApiError('invalid_response');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > RESPONSE_MAX_BYTES) {
    await response.body?.cancel();
    throw new StorageApiError('invalid_response');
  }
  if (!response.body) throw new StorageApiError('invalid_response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_MAX_BYTES) {
        await reader.cancel();
        throw new StorageApiError('invalid_response');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof StorageApiError) throw error;
    throw new StorageApiError('invalid_response');
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new StorageApiError('invalid_response');
  }
}

function parseUploadResponse(payload: unknown, bucket: StorageBucket, ownerId: string, base: URL): { path: string; publicUrl: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new StorageApiError('invalid_response');
  const record = payload as Record<string, unknown>;
  if (typeof record.path !== 'string' || typeof record.publicUrl !== 'string') throw new StorageApiError('invalid_response');
  const pathSegments = record.path.split('/');
  if (
    pathSegments.length !== 2 ||
    pathSegments[0] !== ownerId ||
    !FILE_NAME_PATTERN.test(pathSegments[1])
  ) {
    throw new StorageApiError('invalid_response');
  }

  let publicUrl: URL;
  try {
    publicUrl = new URL(record.publicUrl);
  } catch {
    throw new StorageApiError('invalid_response');
  }
  const expectedPath = `/api/storage/public/${bucket}/${encodeKey(record.path)}`;
  if (
    publicUrl.origin !== base.origin ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.pathname !== expectedPath ||
    publicUrl.search ||
    publicUrl.hash
  ) {
    throw new StorageApiError('invalid_response');
  }
  return { path: record.path, publicUrl: publicUrl.toString() };
}

function extractOwnedR2Path(bucket: StorageBucket, ownerId: string, publicUrlValue: string, base: URL): string {
  let publicUrl: URL;
  try {
    publicUrl = new URL(publicUrlValue);
  } catch {
    throw new StorageApiError('configuration');
  }
  const prefix = `/api/storage/public/${bucket}/`;
  if (
    publicUrl.origin !== base.origin ||
    publicUrl.username ||
    publicUrl.password ||
    !publicUrl.pathname.startsWith(prefix) ||
    publicUrl.search ||
    publicUrl.hash
  ) {
    throw new StorageApiError('configuration');
  }

  const encodedSegments = publicUrl.pathname.slice(prefix.length).split('/');
  if (encodedSegments.length !== 2 || encodedSegments.some((segment) => !segment)) {
    throw new StorageApiError('configuration');
  }
  let segments: string[];
  try {
    segments = encodedSegments.map((segment) => decodeURIComponent(segment));
  } catch {
    throw new StorageApiError('configuration');
  }
  const key = segments.join('/');
  if (
    segments.some((segment) => segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) ||
    segments[0] !== ownerId ||
    !FILE_NAME_PATTERN.test(segments[1]) ||
    publicUrl.pathname !== `${prefix}${encodeKey(key)}`
  ) {
    throw new StorageApiError('configuration');
  }
  return key;
}

export function createStorageApi({
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: StorageApiOptions = {}) {
  const base = resolvedBaseUrl(baseUrl);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new StorageApiError('configuration');
  }

  async function request(path: string, init: RequestInit): Promise<Response> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return await fetchImpl(apiUrl(base, path), {
        ...init,
        signal,
        cache: 'no-store',
        credentials: 'include',
        redirect: 'error',
      });
    } catch {
      if (signal.aborted) throw new StorageApiError('timeout');
      throw new StorageApiError('network');
    }
  }

  return {
    async upload(bucket: StorageBucket, ownerId: string, file: Blob): Promise<{ path: string; publicUrl: string }> {
      validateOwnerId(ownerId);
      const limit = bucket === 'avatars' ? AVATAR_MAX_BYTES : COVER_MAX_BYTES;
      if (file.size < 1 || file.size > limit || !IMAGE_TYPES.has(file.type.toLowerCase())) {
        throw new StorageApiError('invalid_file');
      }
      const response = await request(`/api/storage/object/${bucket}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': file.type.toLowerCase(),
        },
        body: file,
      });
      if (response.status !== 201) {
        await response.body?.cancel();
        throw new StorageApiError('http', response.status);
      }
      return parseUploadResponse(await readBoundedJson(response), bucket, ownerId, base);
    },

    async delete(bucket: StorageBucket, ownerId: string, publicUrl: string): Promise<void> {
      validateOwnerId(ownerId);
      const key = extractOwnedR2Path(bucket, ownerId, publicUrl, base);
      const response = await request(`/api/storage/object/${bucket}/${encodeKey(key)}`, {
        method: 'DELETE',
        headers: { accept: 'application/json' },
      });
      if (response.status !== 204) {
        await response.body?.cancel();
        throw new StorageApiError('http', response.status);
      }
    },
  };
}

export const uploadStorageObject = (bucket: StorageBucket, ownerId: string, file: Blob) =>
  createStorageApi().upload(bucket, ownerId, file);

export const deleteStorageObject = (bucket: StorageBucket, ownerId: string, publicUrl: string) =>
  createStorageApi().delete(bucket, ownerId, publicUrl);
