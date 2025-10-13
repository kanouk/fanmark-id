import { emojiCatalogEntries, emojiToId, emojiIdToEmoji } from '@/data/emojiCatalog';

const FE_VARIATION_SELECTOR_REGEX = /\uFE0F+/g;
const ZWJ_REGEX = /\u200D+/g;
const SKIN_TONE_CODEPOINTS = new Set(['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']);
const SKIN_TONE_MODIFIER_GLOBAL_REGEX = /\p{Emoji_Modifier}/gu;

const normalizeEmojiForLookup = (emoji: string): string =>
  emoji.normalize('NFC').replace(FE_VARIATION_SELECTOR_REGEX, '\uFE0F');

const toNormalizedCodepointKey = (codepoints: string[]) =>
  codepoints.filter((cp) => !SKIN_TONE_CODEPOINTS.has(cp)).join('-');

type EmojiCatalogEntry = (typeof emojiCatalogEntries)[number];

type LookupEntry = {
  key: string;
  id: string;
  priority: number;
  length: number;
};

const emojiIdToRecord = new Map<string, EmojiCatalogEntry>();
const normalizedCodepointsToId = new Map<string, string>();
const keyToId = new Map<string, { id: string; priority: number }>();
const lookupEntries: LookupEntry[] = [];
let maxLookupKeyLength = 0;

const registerLookupKey = (key: string, id: string, priority: number) => {
  if (!key) return;
  lookupEntries.push({ key, id, priority, length: key.length });
  const existing = keyToId.get(key);
  if (!existing || existing.priority > priority) {
    keyToId.set(key, { id, priority });
  }
  if (key.length > maxLookupKeyLength) {
    maxLookupKeyLength = key.length;
  }
};

for (const entry of emojiCatalogEntries) {
  emojiIdToRecord.set(entry.id, entry);
  const normalizedKey = toNormalizedCodepointKey([...entry.codepoints]);
  const hasSkinTone = entry.codepoints.some((cp) => SKIN_TONE_CODEPOINTS.has(cp));
  if (!normalizedCodepointsToId.has(normalizedKey) || !hasSkinTone) {
    normalizedCodepointsToId.set(normalizedKey, entry.id);
  }

  const normalizedEmoji = normalizeEmojiForLookup(entry.emoji);
  registerLookupKey(entry.emoji, entry.id, 0);
  registerLookupKey(normalizedEmoji, entry.id, 1);
  const withoutVS = normalizedEmoji.replace(FE_VARIATION_SELECTOR_REGEX, '');
  registerLookupKey(withoutVS, entry.id, 2);
  const withoutZWJ = normalizedEmoji.replace(ZWJ_REGEX, '');
  registerLookupKey(withoutZWJ, entry.id, 3);
  registerLookupKey(withoutVS.replace(ZWJ_REGEX, ''), entry.id, 4);
}

Object.keys(emojiToId).forEach((key) => registerLookupKey(key, emojiToId[key], 1));

lookupEntries.sort((a, b) => {
  if (b.length !== a.length) {
    return b.length - a.length;
  }
  return a.priority - b.priority;
});

const lookupEntriesByFirstChar = new Map<string, LookupEntry[]>();
for (const entry of lookupEntries) {
  const first = entry.key.charAt(0);
  if (!lookupEntriesByFirstChar.has(first)) {
    lookupEntriesByFirstChar.set(first, []);
  }
  lookupEntriesByFirstChar.get(first)!.push(entry);
}

for (const entries of lookupEntriesByFirstChar.values()) {
  entries.sort((a, b) => {
    if (b.length !== a.length) {
      return b.length - a.length;
    }
    return a.priority - b.priority;
  });
}

export const segmentEmojiSequence = (emojiSequence: string): string[] => {
  if (!emojiSequence) return [];

  const segments: string[] = [];
  let index = 0;
  const totalLength = emojiSequence.length;

  while (index < totalLength) {
    let matchedEntry: LookupEntry | null = null;
    const remaining = totalLength - index;
    const maxLength = Math.min(maxLookupKeyLength, remaining);

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

  return segments;
};

export const convertEmojiSequenceToIds = (emojiSequence: string): string[] => {
  if (!emojiSequence) return [];

  const segments = segmentEmojiSequence(emojiSequence);
  if (segments.length === 0) return [];

  return segments.map((segment) => {
    const entry = keyToId.get(segment);
    const id = entry?.id ?? emojiToId[segment];
    if (!id) {
      throw new Error(`この絵文字はサポートされていません: ${segment}`);
    }
    return id;
  });
};

export const convertEmojiIdsToSequence = (ids: string[]): string => {
  if (!ids || ids.length === 0) return '';

  return ids
    .map((id) => {
      const emoji = emojiIdToEmoji[id];
      if (!emoji) {
        throw new Error(`未知の絵文字IDです: ${id}`);
      }
      return emoji;
    })
    .join('');
};

export const stripSkinToneModifiers = (emojiSequence: string): string =>
  emojiSequence.replace(SKIN_TONE_MODIFIER_GLOBAL_REGEX, '');

export const convertEmojiIdsToNormalizedIds = (ids: string[]): string[] => {
  if (!ids || ids.length === 0) return [];

  return ids.map((id) => {
    const record = emojiIdToRecord.get(id);
    if (!record) {
      throw new Error(`未知の絵文字IDです: ${id}`);
    }
    const normalizedKey = toNormalizedCodepointKey([...record.codepoints]);
    const normalizedId = normalizedCodepointsToId.get(normalizedKey);
    if (!normalizedId) {
      throw new Error(`対応する正規化済み絵文字IDが見つかりません: ${id}`);
    }
    return normalizedId;
  });
};

export const convertEmojiSequenceToNormalizedIds = (emojiSequence: string): string[] => {
  const emojiIds = convertEmojiSequenceToIds(emojiSequence);
  return convertEmojiIdsToNormalizedIds(emojiIds);
};

export const convertEmojiSequenceToIdPair = (emojiSequence: string): {
  emojiIds: string[];
  normalizedEmojiIds: string[];
} => {
  const emojiIds = convertEmojiSequenceToIds(emojiSequence);
  const normalizedEmojiIds = convertEmojiIdsToNormalizedIds(emojiIds);
  return { emojiIds, normalizedEmojiIds };
};

const sanitizeForCanonicalization = (input: string): string =>
  input
    .replace(/\s/g, '')
    .replace(/\uFE0E/g, '\uFE0F')
    .replace(/\uFE0F{2,}/g, '\uFE0F');

const MAX_WINDOW = 10;

export const canonicalizeEmojiString = (input: string): string => {
  if (!input) {
    return '';
  }

  const sanitized = sanitizeForCanonicalization(input);
  if (!sanitized) {
    return '';
  }

  const result: string[] = [];
  let index = 0;

  while (index < sanitized.length) {
    const firstChar = sanitized.charAt(index);
    const candidates = lookupEntriesByFirstChar.get(firstChar) ?? [];
    let match: LookupEntry | null = null;
    let consumed = 0;

    for (const entry of candidates) {
      const key = entry.key;
      if (sanitized.startsWith(key, index)) {
        match = entry;
        consumed = key.length;
        break;
      }

      const remainingSlice = sanitized.slice(index);
      if (key.startsWith(remainingSlice)) {
        match = entry;
        consumed = Math.min(remainingSlice.length, key.length);
        break;
      }
    }

    if (match) {
      let canonical = match.key;
      try {
        canonical = convertEmojiIdsToSequence([match.id]);
      } catch (error) {
        console.warn('canonicalizeEmojiString: failed to convert entry id', {
          entry: match,
          error,
        });
      }

      result.push(canonical);
      index += consumed;
      continue;
    }

    const fallback = sanitized[index];
    result.push(fallback);
    index += fallback.length;
  }

  return result.join('');
};

export const resolveFanmarkDisplay = (
  fallback: string | undefined,
  ids?: (string | null)[] | null,
): string => {
  const base = fallback ?? '';
  const validIds = Array.isArray(ids) ? ids.filter((value): value is string => Boolean(value)) : [];

  if (validIds.length === 0) {
    return base;
  }

  try {
    const rebuilt = convertEmojiIdsToSequence(validIds);
    return rebuilt || base;
  } catch {
    return base;
  }
};

const EMOJI_REGEX =
  /\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Modifier})*)*|\p{Regional_Indicator}{2}|\d\uFE0F\u20E3|[#*]\uFE0F\u20E3|\p{Emoji_Presentation}|\p{Emoji_Modifier}/gu;

export const extractEmojiString = (input: string): string => {
  if (!input) return '';

  const matches = input.match(EMOJI_REGEX);
  if (!matches) {
    return '';
  }

  const extractedSegments: string[] = [];

  for (const candidate of matches) {
    try {
      const canonical = canonicalizeEmojiString(candidate);
      convertEmojiSequenceToIds(canonical);
      extractedSegments.push(canonical);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[extractEmojiString] discarded candidate', { candidate, error });
      }
    }
  }

  return extractedSegments.join('');
};
