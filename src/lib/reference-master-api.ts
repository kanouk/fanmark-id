import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from './recent-fanmarks.ts';

export interface FanmarkTierMasterItem {
  id: string;
  description: string | null;
  displayName: string;
  emojiCountMax: number;
  emojiCountMin: number;
  initialLicenseDays: number | null;
  isActive: boolean;
  monthlyPriceCents: number;
  tierLevel: number;
}

export interface ExtensionPriceMasterItem {
  tierLevel: number;
  months: number;
  priceYen: number;
  isActive: boolean;
}

export type ReferenceMasterReadBackend = 'supabase' | 'worker';
export type ExtensionPricingBackend = 'supabase' | 'worker';
export type ReferenceMasterApiErrorKind = 'configuration' | 'http' | 'invalid_response' | 'network' | 'timeout';

export class ReferenceMasterApiError extends Error {
  readonly kind: ReferenceMasterApiErrorKind;
  readonly status?: number;

  constructor(kind: ReferenceMasterApiErrorKind, status?: number) {
    super(kind === 'http' && status
      ? `reference master request failed (${status})`
      : `reference master request ${kind}`);
    this.name = 'ReferenceMasterApiError';
    this.kind = kind;
    this.status = status;
  }
}

interface FetchOptions {
  apiBaseUrl?: string;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

const API_PATH = '/api/reference-masters/fanmark_tiers';
const EXTENSION_PRICE_API_PATH = '/api/reference-masters/fanmark_tier_extension_prices';
const MAX_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const RELEASE_VERSION_RE = /^[0-9a-f]{64}$/u;
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const ITEM_KEYS = [
  'description', 'displayName', 'emojiCountMax', 'emojiCountMin', 'id',
  'initialLicenseDays', 'isActive', 'monthlyPriceCents', 'tierLevel',
];
const EXTENSION_PRICE_ITEM_KEYS = ['isActive', 'months', 'priceYen', 'tierLevel'];

export function getReferenceMasterReadBackend(
  value: string | undefined = import.meta.env?.VITE_REFERENCE_MASTER_READ_BACKEND,
): ReferenceMasterReadBackend {
  const backend = value?.trim();
  if (!backend || backend === 'supabase') return 'supabase';
  if (backend === 'worker') return 'worker';
  throw new ReferenceMasterApiError('configuration');
}

export function getExtensionPricingBackend(
  value: string | undefined = import.meta.env?.VITE_EXTENSION_PRICING_BACKEND,
): ExtensionPricingBackend {
  const backend = value?.trim();
  if (!backend || backend === 'supabase') return 'supabase';
  if (backend === 'worker') return 'worker';
  throw new ReferenceMasterApiError('configuration');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function parseFanmarkTierMasterPayload(payload: unknown): FanmarkTierMasterItem[] {
  if (
    !isRecord(payload) || payload.schemaVersion !== 1 || payload.master !== 'fanmark_tiers' ||
    typeof payload.releaseVersion !== 'string' || !RELEASE_VERSION_RE.test(payload.releaseVersion) ||
    !Array.isArray(payload.items) || payload.items.length !== 4
  ) {
    throw new ReferenceMasterApiError('invalid_response');
  }

  const ids = new Set<string>();
  const levels = new Set<number>();
  const items: FanmarkTierMasterItem[] = [];
  for (const value of payload.items) {
    if (!isRecord(value)) throw new ReferenceMasterApiError('invalid_response');
    const keys = Object.keys(value).sort();
    if (keys.length !== ITEM_KEYS.length || keys.some((key, index) => key !== ITEM_KEYS[index])) {
      throw new ReferenceMasterApiError('invalid_response');
    }
    const id = value.id;
    const description = value.description;
    const displayName = value.displayName;
    const emojiCountMin = value.emojiCountMin;
    const emojiCountMax = value.emojiCountMax;
    const initialLicenseDays = value.initialLicenseDays;
    const isActive = value.isActive;
    const monthlyPriceCents = value.monthlyPriceCents;
    const tierLevel = value.tierLevel;
    if (
      typeof id !== 'string' || !UUID_RE.test(id) || ids.has(id.toLowerCase()) ||
      (description !== null && (typeof description !== 'string' || description.length > 1024)) ||
      typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 128 ||
      !isIntegerInRange(emojiCountMin, 1, 5) || !isIntegerInRange(emojiCountMax, 1, 5) ||
      emojiCountMin > emojiCountMax ||
      (initialLicenseDays !== null && !isIntegerInRange(initialLicenseDays, 0, 36500)) ||
      typeof isActive !== 'boolean' ||
      !isIntegerInRange(monthlyPriceCents, -9_999_999_999, 9_999_999_999) ||
      !isIntegerInRange(tierLevel, 1, 4) || levels.has(tierLevel)
    ) {
      throw new ReferenceMasterApiError('invalid_response');
    }
    ids.add(id.toLowerCase());
    levels.add(tierLevel);
    items.push({
      id: id.toLowerCase(),
      description: description as string | null,
      displayName,
      emojiCountMax,
      emojiCountMin,
      initialLicenseDays: initialLicenseDays as number | null,
      isActive,
      monthlyPriceCents,
      tierLevel,
    });
  }
  if (levels.size !== 4) throw new ReferenceMasterApiError('invalid_response');
  return items.sort((left, right) => left.tierLevel - right.tierLevel);
}

export function parseExtensionPriceMasterPayload(payload: unknown): ExtensionPriceMasterItem[] {
  if (
    !isRecord(payload) || payload.schemaVersion !== 1 || payload.master !== 'fanmark_tier_extension_prices' ||
    typeof payload.releaseVersion !== 'string' || !RELEASE_VERSION_RE.test(payload.releaseVersion) ||
    !Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 64
  ) throw new ReferenceMasterApiError('invalid_response');

  const combinations = new Set<string>();
  const items: ExtensionPriceMasterItem[] = [];
  for (const value of payload.items) {
    if (!isRecord(value)) throw new ReferenceMasterApiError('invalid_response');
    const keys = Object.keys(value).sort();
    if (keys.length !== EXTENSION_PRICE_ITEM_KEYS.length ||
        keys.some((key, index) => key !== EXTENSION_PRICE_ITEM_KEYS[index])) {
      throw new ReferenceMasterApiError('invalid_response');
    }
    const tierLevel = value.tierLevel;
    const months = value.months;
    const priceYen = value.priceYen;
    const isActive = value.isActive;
    if (
      !isIntegerInRange(tierLevel, 1, 4) || !isIntegerInRange(months, 1, 120) ||
      !isIntegerInRange(priceYen, 0, 2_147_483_647) || typeof isActive !== 'boolean'
    ) throw new ReferenceMasterApiError('invalid_response');
    const combination = `${tierLevel}:${months}`;
    if (combinations.has(combination)) throw new ReferenceMasterApiError('invalid_response');
    combinations.add(combination);
    items.push({ tierLevel, months, priceYen, isActive });
  }
  return items.sort((left, right) => left.tierLevel - right.tierLevel || left.months - right.months);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' || !response.body) throw new ReferenceMasterApiError('invalid_response');
  if (!response.headers.get('cache-control')?.toLowerCase().split(',').some((item) => item.trim() === 'no-store')) {
    await response.body.cancel();
    throw new ReferenceMasterApiError('invalid_response');
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new ReferenceMasterApiError('invalid_response');
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
        throw new ReferenceMasterApiError('invalid_response');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ReferenceMasterApiError) throw error;
    throw new ReferenceMasterApiError('invalid_response');
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
    throw new ReferenceMasterApiError('invalid_response');
  }
}

export async function fetchFanmarkTierMaster(options: FetchOptions = {}): Promise<FanmarkTierMasterItem[]> {
  const configuredBase = options.apiBaseUrl === undefined
    ? getRecentFanmarksApiBaseUrl()
    : getRecentFanmarksApiBaseUrl(options.apiBaseUrl);
  const baseUrl = configuredBase || (typeof window === 'undefined' ? '' : window.location.origin);
  if (!baseUrl) throw new ReferenceMasterApiError('configuration');

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ReferenceMasterApiError('configuration');
  }
  let endpoint: URL;
  try {
    endpoint = buildRecentFanmarksApiUrl(baseUrl);
    endpoint.pathname = API_PATH;
    endpoint.search = '';
    endpoint.hash = '';
  } catch {
    throw new ReferenceMasterApiError('configuration');
  }

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
    if (signal.aborted) throw new ReferenceMasterApiError('timeout');
    throw new ReferenceMasterApiError('network');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ReferenceMasterApiError('http', response.status);
  }
  return parseFanmarkTierMasterPayload(await readBoundedJson(response));
}

export async function fetchExtensionPriceMaster(options: FetchOptions = {}): Promise<ExtensionPriceMasterItem[]> {
  const configuredBase = options.apiBaseUrl === undefined
    ? getRecentFanmarksApiBaseUrl()
    : getRecentFanmarksApiBaseUrl(options.apiBaseUrl);
  const baseUrl = configuredBase || (typeof window === 'undefined' ? '' : window.location.origin);
  if (!baseUrl) throw new ReferenceMasterApiError('configuration');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ReferenceMasterApiError('configuration');
  }
  let endpoint: URL;
  try {
    endpoint = buildRecentFanmarksApiUrl(baseUrl);
    endpoint.pathname = EXTENSION_PRICE_API_PATH;
    endpoint.search = '';
    endpoint.hash = '';
  } catch {
    throw new ReferenceMasterApiError('configuration');
  }

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
    if (signal.aborted) throw new ReferenceMasterApiError('timeout');
    throw new ReferenceMasterApiError('network');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ReferenceMasterApiError('http', response.status);
  }
  return parseExtensionPriceMasterPayload(await readBoundedJson(response));
}
