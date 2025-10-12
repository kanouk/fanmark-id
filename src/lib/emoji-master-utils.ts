import { splitEmojiGraphemes } from "../utils/emojiUrl.js";

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

let emojiMapPromise:
  | Promise<{ byEmoji: EmojiLookupMap; byId: IdLookupMap; byNormalizedCodepoints: NormalizedCodepointLookupMap }>
  | null = null;
let supabasePromise: Promise<any> | null = null;

const getSupabaseClient = async () => {
  if (!supabasePromise) {
    supabasePromise = import("../integrations/supabase/client").then((module) => module.supabase);
  }
  return supabasePromise;
};

const NORMALIZE_FE_VARIATION_SELECTOR_REGEX = /\uFE0F+/g;
const SKIN_TONE_CODEPOINTS = new Set(["1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"]);

const normalizeEmojiForLookup = (emoji: string): string =>
  emoji.normalize("NFC").replace(NORMALIZE_FE_VARIATION_SELECTOR_REGEX, "\uFE0F");

const toNormalizedCodepointKey = (codepoints: string[]) =>
  codepoints.filter((cp) => !SKIN_TONE_CODEPOINTS.has(cp)).join("-");

const buildLookupMaps = (records: EmojiMasterRecord[]) => {
  const byEmoji: EmojiLookupMap = new Map();
  const byId: IdLookupMap = new Map();
  const byNormalizedCodepoints: NormalizedCodepointLookupMap = new Map();

  records.forEach((record) => {
    const normalized = normalizeEmojiForLookup(record.emoji);
    const existing = byEmoji.get(normalized);
    if (!existing || (record.sort_order ?? Number.MAX_SAFE_INTEGER) < (existing.sort_order ?? Number.MAX_SAFE_INTEGER)) {
      byEmoji.set(normalized, record);
    }
    byId.set(record.id, record);

    const normalizedKey = toNormalizedCodepointKey(record.codepoints);
    const hasSkinTone = record.codepoints.some((cp) => SKIN_TONE_CODEPOINTS.has(cp));
    const existingNormalized = byNormalizedCodepoints.get(normalizedKey);
    if (!existingNormalized || (!hasSkinTone && existingNormalized.codepoints.some((cp) => SKIN_TONE_CODEPOINTS.has(cp)))) {
      byNormalizedCodepoints.set(normalizedKey, record);
    }
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
    .from("emoji_master" as any)
    .select("*")
    .order("sort_order", { ascending: true, nullsFirst: true });

  if (error) {
    throw new Error(`Failed to load emoji master: ${error.message}`);
  }

  return buildLookupMaps(((data ?? []) as unknown) as EmojiMasterRecord[]);
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
  const segments = splitEmojiGraphemes(emojiSequence);
  if (segments.length === 0) {
    return [];
  }

  const { byEmoji } = await getLookupMaps();
  const result: string[] = [];

  for (const rawSegment of segments) {
    const normalized = normalizeEmojiForLookup(rawSegment);
    const candidates = [
      normalized,
      `${normalized}\uFE0F`,
      normalized.replace(/\uFE0F/g, ""),
    ];
    const record = candidates.reduce<EmojiMasterRecord | undefined>(
      (found, key) => found ?? byEmoji.get(key),
      undefined
    );
    if (!record) {
      throw new Error(`Emoji not found in master: ${rawSegment}`);
    }
    result.push(record.id);
  }

  return result;
};

export const convertEmojiIdsToSequence = async (ids: string[]) => {
  if (!ids || ids.length === 0) {
    return "";
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
    .join("");
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
  const ids = await convertEmojiSequenceToIds(emojiSequence);
  return convertEmojiIdsToNormalizedIds(ids);
};

export const listEmojiMasterRecords = async () => {
  const { byEmoji } = await getLookupMaps();
  return Array.from(byEmoji.values()).sort((a, b) => {
    const aOrder = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return a.emoji.localeCompare(b.emoji);
  });
};
