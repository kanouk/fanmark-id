export interface EmojiMasterRecord {
  id: string;
  emoji: string;
  short_name: string;
  keywords: string[];
  category: string | null;
  subcategory: string | null;
  codepoints: string[];
  sort_order: number | null;
}

type EmojiLookupMap = Map<string, EmojiMasterRecord>;
type IdLookupMap = Map<string, EmojiMasterRecord>;
type NormalizedCodepointLookupMap = Map<string, EmojiMasterRecord>;

type LookupEntry = {
  key: string;
  id: string;
  priority: number;
  length: number;
};

let emojiMapPromise:
  | Promise<{ byEmoji: EmojiLookupMap; byId: IdLookupMap; byNormalizedCodepoints: NormalizedCodepointLookupMap }>
  | null = null;
let supabasePromise: Promise<any> | null = null;
let lookupEntries: LookupEntry[] = [];
const keyToId = new Map<string, { id: string; priority: number }>();
let maxEmojiLookupKeyLength = 0;

const getSupabaseClient = async () => {
  if (!supabasePromise) {
    supabasePromise = import('../integrations/supabase/client').then((module) => module.supabase);
  }
  return supabasePromise;
};

const NORMALIZE_FE_VARIATION_SELECTOR_REGEX = /\uFE0F+/g;
const ZWJ_REGEX = /\u200D+/g;
const SKIN_TONE_CODEPOINTS = new Set(['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']);

const normalizeEmojiForLookup = (emoji: string): string =>
  emoji.normalize('NFC').replace(NORMALIZE_FE_VARIATION_SELECTOR_REGEX, '\uFE0F');

const toNormalizedCodepointKey = (codepoints: string[]) =>
  codepoints.filter((cp) => !SKIN_TONE_CODEPOINTS.has(cp)).join('-');

const resetLookupCaches = () => {
  lookupEntries = [];
  keyToId.clear();
  maxEmojiLookupKeyLength = 0;
};

const registerLookupKey = (key: string, id: string, priority: number) => {
  if (!key) return;
  lookupEntries.push({ key, id, priority, length: key.length });
  const existing = keyToId.get(key);
  if (!existing || existing.priority > priority) {
    keyToId.set(key, { id, priority });
  }
  if (key.length > maxEmojiLookupKeyLength) {
    maxEmojiLookupKeyLength = key.length;
  }
};

const buildLookupMaps = (records: EmojiMasterRecord[]) => {
  resetLookupCaches();

  const byEmoji: EmojiLookupMap = new Map();
  const byId: IdLookupMap = new Map();
  const byNormalizedCodepoints: NormalizedCodepointLookupMap = new Map();

  records.forEach((record) => {
    const normalized = normalizeEmojiForLookup(record.emoji);
    const withoutVS = normalized.replace(NORMALIZE_FE_VARIATION_SELECTOR_REGEX, '');
    const withoutZWJ = normalized.replace(ZWJ_REGEX, '');
    const withoutVSWoutZWJ = withoutVS.replace(ZWJ_REGEX, '');

    const register = (key: string, priority: number) => {
      if (!key) return;
      const existing = byEmoji.get(key);
      if (!existing || (record.sort_order ?? Number.MAX_SAFE_INTEGER) < (existing.sort_order ?? Number.MAX_SAFE_INTEGER)) {
        byEmoji.set(key, record);
      }
      registerLookupKey(key, record.id, priority);
    };

    register(record.emoji, 0);
    register(normalized, 1);
    register(withoutVS, 2);
    register(withoutZWJ, 3);
    register(withoutVSWoutZWJ, 4);

    byId.set(record.id, record);

    const normalizedKey = toNormalizedCodepointKey(record.codepoints);
    const hasSkinTone = record.codepoints.some((cp) => SKIN_TONE_CODEPOINTS.has(cp));
    const existingNormalized = byNormalizedCodepoints.get(normalizedKey);
    if (!existingNormalized || (!hasSkinTone && existingNormalized.codepoints.some((cp) => SKIN_TONE_CODEPOINTS.has(cp)))) {
      byNormalizedCodepoints.set(normalizedKey, record);
    }
  });

  lookupEntries.sort((a, b) => {
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    return a.priority - b.priority;
  });

  return { byEmoji, byId, byNormalizedCodepoints };
};

const loadEmojiMaster = async (): Promise<{
  byEmoji: EmojiLookupMap;
  byId: IdLookupMap;
  byNormalizedCodepoints: NormalizedCodepointLookupMap;
}> => {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from('emoji_master' as any)
    .select('*')
    .order('sort_order', { ascending: true, nullsFirst: true });

  if (error) {
    throw new Error(`Failed to load emoji master: ${error.message}`);
  }

  return buildLookupMaps((data ?? []) as EmojiMasterRecord[]);
};

const getLookupMaps = async () => {
  if (!emojiMapPromise) {
    emojiMapPromise = loadEmojiMaster();
  }
  return emojiMapPromise;
};

export const refreshEmojiMasterCache = async () => {
  emojiMapPromise = loadEmojiMaster();
  return emojiMapPromise;
};

export const primeEmojiMasterCache = (records: EmojiMasterRecord[]) => {
  emojiMapPromise = Promise.resolve(buildLookupMaps(records));
};

export const getEmojiMasterRecordByEmoji = async (emoji: string) => {
  const { byEmoji } = await getLookupMaps();
  const normalized = normalizeEmojiForLookup(emoji);
  return byEmoji.get(normalized) ?? null;
};

export const getEmojiMasterRecordById = async (id: string) => {
  const { byId } = await getLookupMaps();
  return byId.get(id) ?? null;
};

export const convertEmojiSequenceToIds = async (emojiSequence: string) => {
  const { byEmoji } = await getLookupMaps();

  if (!emojiSequence) {
    return [];
  }

  const segments: string[] = [];
  let index = 0;
  const totalLength = emojiSequence.length;

  while (index < totalLength) {
    let matchedEntry: LookupEntry | null = null;
    const remaining = totalLength - index;
    const maxLength = Math.min(maxEmojiLookupKeyLength, remaining);

    for (const entry of lookupEntries) {
      if (entry.length > maxLength) {
        continue;
      }
      if (emojiSequence.startsWith(entry.key, index)) {
        matchedEntry = entry;
        break;
      }
    }

    if (matchedEntry) {
      segments.push(matchedEntry.key);
      index += matchedEntry.length;
      continue;
    }

    const [fallback] = Array.from(emojiSequence.slice(index));
    if (!fallback) {
      break;
    }
    segments.push(fallback);
    index += fallback.length;
  }

  if (segments.length === 0) {
    return [];
  }

  return segments.map((segment) => {
    const meta = keyToId.get(segment);
    if (meta) {
      return meta.id;
    }
    const record = byEmoji.get(segment);
    if (record) {
      return record.id;
    }
    throw new Error(`Emoji not found in master: ${segment}`);
  });
};

export const convertEmojiIdsToSequence = async (ids: string[]) => {
  if (!ids || ids.length === 0) {
    return '';
  }

  const { byId } = await getLookupMaps();
  return ids
    .map((id) => {
      const record = byId.get(id);
      if (!record) {
        throw new Error(`Emoji id not found in master: ${id}`);
      }
      return record.emoji;
    })
    .join('');
};

export const convertEmojiIdsToNormalizedIds = async (ids: string[]) => {
  if (!ids || ids.length === 0) {
    return [];
  }

  const { byId, byNormalizedCodepoints } = await getLookupMaps();

  return ids.map((id) => {
    const record = byId.get(id);
    if (!record) {
      throw new Error(`Emoji id not found in master: ${id}`);
    }
    const normalizedKey = toNormalizedCodepointKey(record.codepoints);
    const normalizedRecord = byNormalizedCodepoints.get(normalizedKey);
    if (!normalizedRecord) {
      throw new Error(`Normalized emoji not found for id: ${id}`);
    }
    return normalizedRecord.id;
  });
};

export const convertEmojiSequenceToNormalizedIds = async (emojiSequence: string) => {
  const emojiIds = await convertEmojiSequenceToIds(emojiSequence);
  return convertEmojiIdsToNormalizedIds(emojiIds);
};

export const convertEmojiSequenceToIdPair = async (emojiSequence: string) => {
  const emojiIds = await convertEmojiSequenceToIds(emojiSequence);
  const normalizedEmojiIds = await convertEmojiIdsToNormalizedIds(emojiIds);
  return { emojiIds, normalizedEmojiIds };
};

export const resolveFanmarkDisplay = async (
  fallback: string | undefined,
  ids?: (string | null)[] | null,
) => {
  const base = fallback ?? '';
  const validIds = Array.isArray(ids) ? ids.filter((value): value is string => Boolean(value)) : [];

  if (validIds.length === 0) {
    return base;
  }

  try {
    const rebuilt = await convertEmojiIdsToSequence(validIds);
    return rebuilt || base;
  } catch {
    return base;
  }
};

export const listEmojiMasterRecords = async () => {
  const { byEmoji } = await getLookupMaps();
  const seen = new Set<string>();
  const records: EmojiMasterRecord[] = [];

  for (const record of byEmoji.values()) {
    if (!seen.has(record.id)) {
      records.push(record);
      seen.add(record.id);
    }
  }

  return records.sort((a, b) => {
    const aOrder = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return a.emoji.localeCompare(b.emoji);
  });
};
