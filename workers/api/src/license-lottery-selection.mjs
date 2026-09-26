const MAX_ENTRIES = 5_000;
const MAX_WEIGHT_LENGTH = 256;
const MAX_DRAW_ATTEMPTS = 128;
const SEED_BYTES = 32;
const SEED_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,160}$/u;

export class LicenseLotterySelectionError extends Error {
  constructor(code, cause) {
    super(code);
    this.name = "LicenseLotterySelectionError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  throw new LicenseLotterySelectionError(code, cause);
}

function parsePositiveDecimal(value) {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_WEIGHT_LENGTH ||
    !DECIMAL_PATTERN.test(value)
  ) fail("invalid_lottery_weight");

  const [whole, fraction = ""] = value.split(".");
  const digits = `${whole}${fraction}`;
  const coefficient = BigInt(digits);
  if (coefficient <= 0n) fail("invalid_lottery_weight");
  return { coefficient, scale: fraction.length, sourceText: value };
}

function validatedEntries(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) fail("invalid_lottery_entries");
  const seenEntryIds = new Set();
  const seenUserIds = new Set();
  return entries.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("invalid_lottery_entry");
    const { entryId, userId, lotteryProbability, capacity } = entry;
    if (typeof entryId !== "string" || !IDENTIFIER_PATTERN.test(entryId)) fail("invalid_lottery_entry_id");
    if (typeof userId !== "string" || !IDENTIFIER_PATTERN.test(userId)) fail("invalid_lottery_user_id");
    if (seenEntryIds.has(entryId)) fail("duplicate_lottery_entry_id");
    if (seenUserIds.has(userId)) fail("duplicate_lottery_user_for_fanmark");
    if (!capacity || typeof capacity !== "object" || Array.isArray(capacity)) {
      fail("invalid_lottery_capacity_snapshot");
    }
    const { planType, activeCount, limit } = capacity;
    if (typeof planType !== "string" || !IDENTIFIER_PATTERN.test(planType)) {
      fail("invalid_lottery_plan_type");
    }
    if (!Number.isSafeInteger(activeCount) || activeCount < 0) fail("invalid_lottery_active_count");
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) fail("invalid_lottery_plan_limit");
    seenEntryIds.add(entryId);
    seenUserIds.add(userId);
    return {
      entryId,
      userId,
      capacity: { planType, activeCount, limit },
      atLimit: limit !== null && activeCount >= limit,
      ...parsePositiveDecimal(lotteryProbability),
    };
  }).sort((left, right) => left.entryId < right.entryId ? -1 : left.entryId > right.entryId ? 1 : 0);
}

function seedToBytes(seedHex) {
  if (typeof seedHex !== "string" || !SEED_HEX_PATTERN.test(seedHex)) fail("invalid_lottery_seed");
  return Uint8Array.from({ length: SEED_BYTES }, (_unused, index) =>
    Number.parseInt(seedHex.slice(index * 2, index * 2 + 2), 16));
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createLicenseLotterySeed(cryptoApi = globalThis.crypto) {
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") fail("lottery_seed_unavailable");
  const bytes = new Uint8Array(SEED_BYTES);
  try {
    cryptoApi.getRandomValues(bytes);
  } catch (error) {
    fail("lottery_seed_unavailable", error);
  }
  return toHex(bytes);
}

function bitLength(value) {
  if (value <= 0n) return 0;
  return value.toString(2).length;
}

async function randomBelow(total, seedKey, drawIndex, cryptoApi) {
  const bits = bitLength(total - 1n);
  const byteLength = Math.max(1, Math.ceil(bits / 8));
  const excessBits = byteLength * 8 - bits;
  const prefix = new TextEncoder().encode(`fanmark-license-lottery:v1:${drawIndex}:`);

  for (let attempt = 0; attempt < MAX_DRAW_ATTEMPTS; attempt += 1) {
    const chunks = [];
    let remaining = byteLength;
    for (let block = 0; remaining > 0; block += 1) {
      const suffix = new TextEncoder().encode(`${attempt}:${block}`);
      const material = new Uint8Array(prefix.length + suffix.length);
      material.set(prefix, 0);
      material.set(suffix, prefix.length);
      let digest;
      try {
        digest = new Uint8Array(await cryptoApi.subtle.sign("HMAC", seedKey, material));
      } catch (error) {
        fail("lottery_draw_unavailable", error);
      }
      const take = Math.min(remaining, digest.length);
      chunks.push(digest.subarray(0, take));
      remaining -= take;
    }

    const sample = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      sample.set(chunk, offset);
      offset += chunk.length;
    }
    if (excessBits > 0) sample[0] &= 0xff >>> excessBits;
    let candidate = 0n;
    for (const byte of sample) candidate = (candidate << 8n) | BigInt(byte);
    if (candidate < total) return candidate;
  }
  fail("lottery_draw_exhausted");
}

/**
 * Makes a replayable weighted draw from an already captured capacity snapshot.
 * Weights remain exact decimal text; no IEEE-754 conversion occurs.
 */
export async function selectLicenseLotteryOutcome({ entries, seed, cryptoApi = globalThis.crypto }) {
  if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== "function") {
    fail("lottery_draw_unavailable");
  }
  const seedBytes = seedToBytes(seed);
  const candidates = validatedEntries(entries);
  let seedKey;
  try {
    seedKey = await cryptoApi.subtle.importKey(
      "raw", seedBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
  } catch (error) {
    fail("lottery_draw_unavailable", error);
  }
  const scale = candidates.reduce((maximum, entry) => Math.max(maximum, entry.scale), 0);
  for (const entry of candidates) entry.weight = entry.coefficient * (10n ** BigInt(scale - entry.scale));

  const outcomes = new Map(candidates.map((entry) => [entry.entryId, null]));
  const remaining = [...candidates];
  const draws = [];
  let winnerEntryId = null;

  while (remaining.length > 0) {
    const totalWeight = remaining.reduce((total, entry) => total + entry.weight, 0n);
    if (totalWeight <= 0n) fail("invalid_lottery_total_weight");
    const drawIndex = draws.length;
    const offset = remaining.length === 1
      ? 0n
      : await randomBelow(totalWeight, seedKey, drawIndex, cryptoApi);
    let cumulative = 0n;
    let selected = null;
    for (const entry of remaining) {
      cumulative += entry.weight;
      if (offset < cumulative) {
        selected = entry;
        break;
      }
    }
    if (!selected) fail("lottery_selection_invariant_failed");

    if (selected.atLimit) {
      outcomes.set(selected.entryId, "limit_exceeded");
      draws.push({ drawIndex, totalWeight: totalWeight.toString(), selectedEntryId: selected.entryId, result: "limit_exceeded" });
      remaining.splice(remaining.indexOf(selected), 1);
      continue;
    }

    winnerEntryId = selected.entryId;
    outcomes.set(selected.entryId, "won");
    draws.push({ drawIndex, totalWeight: totalWeight.toString(), selectedEntryId: selected.entryId, result: "won" });
    for (const entry of remaining) {
      if (entry.entryId !== winnerEntryId) outcomes.set(entry.entryId, "lost");
    }
    break;
  }

  return {
    schemaVersion: 1,
    seed,
    weightScale: scale,
    winnerEntryId,
    draws,
    entries: candidates.map((entry) => ({
      entryId: entry.entryId,
      userId: entry.userId,
      capacity: entry.capacity,
      lotteryProbability: entry.sourceText,
      status: outcomes.get(entry.entryId) ?? "limit_exceeded",
    })),
  };
}
