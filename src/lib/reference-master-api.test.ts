import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchExtensionPriceMaster,
  fetchFanmarkTierMaster,
  getExtensionPricingBackend,
  getReferenceMasterReadBackend,
  parseExtensionPriceMasterPayload,
  parseFanmarkTierMasterPayload,
  ReferenceMasterApiError,
} from './reference-master-api.ts';

const releaseVersion = 'a'.repeat(64);
const tiers = [1, 2, 3, 4].map((tierLevel) => ({
  id: `00000000-0000-4000-8000-${String(tierLevel).padStart(12, '0')}`,
  description: null,
  displayName: `Tier ${tierLevel}`,
  emojiCountMax: 5,
  emojiCountMin: 1,
  initialLicenseDays: tierLevel === 1 ? null : tierLevel * 7,
  isActive: true,
  monthlyPriceCents: tierLevel * 100,
  tierLevel,
}));
const extensionPrices = [
  { tierLevel: 2, months: 3, priceYen: 1200, isActive: true },
  { tierLevel: 2, months: 1, priceYen: 500, isActive: true },
];

function response(payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

test('reference-master selector defaults to Supabase and accepts only known backends', () => {
  assert.equal(getReferenceMasterReadBackend(undefined), 'supabase');
  assert.equal(getReferenceMasterReadBackend('worker'), 'worker');
  assert.equal(getExtensionPricingBackend(undefined), 'supabase');
  assert.equal(getExtensionPricingBackend('worker'), 'worker');
  assert.throws(() => getReferenceMasterReadBackend('unknown'), (error: unknown) =>
    error instanceof ReferenceMasterApiError && error.kind === 'configuration');
  assert.throws(() => getExtensionPricingBackend('unknown'), (error: unknown) =>
    error instanceof ReferenceMasterApiError && error.kind === 'configuration');
});

test('parses the exact tier projection and returns stable level order', () => {
  const items = parseFanmarkTierMasterPayload({
    schemaVersion: 1,
    releaseVersion,
    master: 'fanmark_tiers',
    items: [...tiers].reverse(),
  });
  assert.deepEqual(items.map((tier) => tier.tierLevel), [1, 2, 3, 4]);
  assert.equal(items[0].id, tiers[0].id);
  assert.equal(items[0].initialLicenseDays, null);
});

test('fetches versioned tiers without cookies, caching, or redirects', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await fetchFanmarkTierMaster({
    apiBaseUrl: 'https://fanmark.example/',
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return response({ schemaVersion: 1, releaseVersion, master: 'fanmark_tiers', items: tiers });
    },
  });
  assert.equal(requestUrl, 'https://fanmark.example/api/reference-masters/fanmark_tiers');
  assert.equal(requestInit?.method, 'GET');
  assert.equal(requestInit?.credentials, 'omit');
  assert.equal(requestInit?.cache, 'no-store');
  assert.equal(requestInit?.redirect, 'error');
  assert.equal(result.length, 4);
});

test('parses and fetches only the public extension-price projection', async () => {
  const payload = {
    schemaVersion: 1,
    releaseVersion,
    master: 'fanmark_tier_extension_prices',
    items: extensionPrices,
  };
  const parsed = parseExtensionPriceMasterPayload(payload);
  assert.deepEqual(parsed.map((item) => item.months), [1, 3]);
  assert.equal(JSON.stringify(parsed).includes('stripe'), false);

  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await fetchExtensionPriceMaster({
    apiBaseUrl: 'https://fanmark.example/',
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return response(payload);
    },
  });
  assert.equal(requestUrl, 'https://fanmark.example/api/reference-masters/fanmark_tier_extension_prices');
  assert.equal(requestInit?.credentials, 'omit');
  assert.equal(requestInit?.cache, 'no-store');
  assert.deepEqual(result.map((item) => item.months), [1, 3]);
});

test('rejects duplicate extension-price combinations and private or malformed projection fields', () => {
  const base = { schemaVersion: 1, releaseVersion, master: 'fanmark_tier_extension_prices', items: extensionPrices };
  assert.throws(() => parseExtensionPriceMasterPayload({
    ...base,
    items: [extensionPrices[0], { ...extensionPrices[0] }],
  }), (error: unknown) => error instanceof ReferenceMasterApiError && error.kind === 'invalid_response');
  assert.throws(() => parseExtensionPriceMasterPayload({
    ...base,
    items: [{ ...extensionPrices[0], stripePriceId: 'price_private' }],
  }), (error: unknown) => error instanceof ReferenceMasterApiError && error.kind === 'invalid_response');
});

test('rejects malformed, duplicate, or incomplete release projections', () => {
  const base = { schemaVersion: 1, releaseVersion, master: 'fanmark_tiers', items: tiers };
  assert.throws(() => parseFanmarkTierMasterPayload({ ...base, items: tiers.slice(0, 3) }),
    (error: unknown) => error instanceof ReferenceMasterApiError && error.kind === 'invalid_response');
  assert.throws(() => parseFanmarkTierMasterPayload({
    ...base,
    items: tiers.map((tier, index) => index === 3 ? { ...tier, tierLevel: 3 } : tier),
  }), (error: unknown) => error instanceof ReferenceMasterApiError && error.kind === 'invalid_response');
  assert.throws(() => parseFanmarkTierMasterPayload({ ...base, releaseVersion: 'mutable' }),
    (error: unknown) => error instanceof ReferenceMasterApiError && error.kind === 'invalid_response');
});

test('fails closed on cacheable responses, HTTP errors, and oversized bodies', async () => {
  await assert.rejects(() => fetchFanmarkTierMaster({
    apiBaseUrl: 'https://fanmark.example',
    fetcher: async () => response({ schemaVersion: 1, releaseVersion, master: 'fanmark_tiers', items: tiers }, {
      'cache-control': 'public, max-age=60',
    }),
  }), (error: unknown) => error instanceof ReferenceMasterApiError && error.kind === 'invalid_response');

  await assert.rejects(() => fetchFanmarkTierMaster({
    apiBaseUrl: 'https://fanmark.example',
    fetcher: async () => new Response('', { status: 503 }),
  }), (error: unknown) => error instanceof ReferenceMasterApiError && error.kind === 'http' && error.status === 503);

  await assert.rejects(() => fetchFanmarkTierMaster({
    apiBaseUrl: 'https://fanmark.example',
    fetcher: async () => new Response(' '.repeat(17 * 1024), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    }),
  }), (error: unknown) => error instanceof ReferenceMasterApiError && error.kind === 'invalid_response');
});
