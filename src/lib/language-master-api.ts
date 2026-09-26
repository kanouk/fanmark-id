import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from './recent-fanmarks.ts';

export interface LanguageMasterItem {
  code: string;
  label: string;
  nativeLabel: string;
  isActive: boolean;
  sortOrder: number;
}

export type LanguageReadBackend = 'supabase' | 'worker';

export type LanguageMasterApiErrorKind =
  | 'configuration'
  | 'http'
  | 'invalid_response'
  | 'network'
  | 'timeout';

export class LanguageMasterApiError extends Error {
  readonly kind: LanguageMasterApiErrorKind;
  readonly status?: number;

  constructor(kind: LanguageMasterApiErrorKind, status?: number) {
    super(kind === 'http' && status ? `language master request failed (${status})` : `language master request ${kind}`);
    this.name = 'LanguageMasterApiError';
    this.kind = kind;
    this.status = status;
  }
}

interface FetchOptions {
  apiBaseUrl?: string;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

const API_PATH = '/api/reference-masters/languages';
const MAX_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const LANGUAGE_CODE_RE = /^[A-Za-z0-9-]{2,16}$/u;
const RELEASE_VERSION_RE = /^[0-9a-f]{64}$/u;
const EXPECTED_ITEM_KEYS = ['code', 'isActive', 'label', 'nativeLabel', 'sortOrder'];

export function getLanguageReadBackend(
  value: string | undefined = import.meta.env?.VITE_LANGUAGE_READ_BACKEND,
): LanguageReadBackend {
  const backend = value?.trim();
  if (!backend || backend === 'supabase') return 'supabase';
  if (backend === 'worker') return 'worker';
  throw new LanguageMasterApiError('configuration');
}

function languageApiUrl(baseUrl: string): URL {
  let endpoint: URL;
  try {
    endpoint = buildRecentFanmarksApiUrl(baseUrl);
  } catch {
    throw new LanguageMasterApiError('configuration');
  }
  endpoint.pathname = API_PATH;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseLanguageMasterPayload(payload: unknown): LanguageMasterItem[] {
  if (
    !isRecord(payload) ||
    payload.schemaVersion !== 1 ||
    payload.master !== 'languages' ||
    typeof payload.releaseVersion !== 'string' ||
    !RELEASE_VERSION_RE.test(payload.releaseVersion) ||
    !Array.isArray(payload.items) ||
    payload.items.length < 1 ||
    payload.items.length > 32
  ) {
    throw new LanguageMasterApiError('invalid_response');
  }

  const items: LanguageMasterItem[] = [];
  const codes = new Set<string>();
  for (const value of payload.items) {
    if (!isRecord(value)) throw new LanguageMasterApiError('invalid_response');
    const keys = Object.keys(value).sort();
    if (keys.length !== EXPECTED_ITEM_KEYS.length || keys.some((key, index) => key !== EXPECTED_ITEM_KEYS[index])) {
      throw new LanguageMasterApiError('invalid_response');
    }
    if (
      typeof value.code !== 'string' || !LANGUAGE_CODE_RE.test(value.code) || codes.has(value.code) ||
      typeof value.label !== 'string' || value.label.length < 1 || value.label.length > 128 ||
      typeof value.nativeLabel !== 'string' || value.nativeLabel.length < 1 || value.nativeLabel.length > 128 ||
      typeof value.isActive !== 'boolean' ||
      typeof value.sortOrder !== 'number' || !Number.isSafeInteger(value.sortOrder) || value.sortOrder < 0
    ) {
      throw new LanguageMasterApiError('invalid_response');
    }
    codes.add(value.code);
    items.push({
      code: value.code,
      label: value.label,
      nativeLabel: value.nativeLabel,
      isActive: value.isActive,
      sortOrder: value.sortOrder,
    });
  }
  return items;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' || !response.body) throw new LanguageMasterApiError('invalid_response');
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new LanguageMasterApiError('invalid_response');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new LanguageMasterApiError('invalid_response');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof LanguageMasterApiError) throw error;
    throw new LanguageMasterApiError('invalid_response');
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
    throw new LanguageMasterApiError('invalid_response');
  }
}

export async function fetchLanguageMaster(options: FetchOptions = {}): Promise<LanguageMasterItem[]> {
  const configuredBase = options.apiBaseUrl === undefined
    ? getRecentFanmarksApiBaseUrl()
    : getRecentFanmarksApiBaseUrl(options.apiBaseUrl);
  const baseUrl = configuredBase || (typeof window === 'undefined' ? '' : window.location.origin);
  if (!baseUrl) throw new LanguageMasterApiError('configuration');

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new LanguageMasterApiError('configuration');
  }
  const endpoint = languageApiUrl(baseUrl);
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal,
    });
  } catch {
    if (signal.aborted) throw new LanguageMasterApiError('timeout');
    throw new LanguageMasterApiError('network');
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new LanguageMasterApiError('http', response.status);
  }
  return parseLanguageMasterPayload(await readBoundedJson(response));
}
