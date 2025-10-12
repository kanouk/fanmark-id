import { emojiCatalogEntries, emojiToId, emojiIdToEmoji } from '@/data/emojiCatalog';
import { splitEmojiGraphemes } from '@/utils/emojiUrl';

const FE_VARIATION_SELECTOR_REGEX = /\uFE0F+/g;
const SKIN_TONE_CODEPOINTS = new Set(['1F3FB', '1F3FC', '1F3FD', '1F3FE', '1F3FF']);
const SKIN_TONE_MODIFIER_GLOBAL_REGEX = /\p{Emoji_Modifier}/gu;

const normalizeEmojiForLookup = (emoji: string): string =>
  emoji.normalize('NFC').replace(FE_VARIATION_SELECTOR_REGEX, '\uFE0F');

const toNormalizedCodepointKey = (codepoints: string[]) =>
  codepoints.filter((cp) => !SKIN_TONE_CODEPOINTS.has(cp)).join('-');

type EmojiCatalogEntry = (typeof emojiCatalogEntries)[number];

const emojiIdToRecord = new Map<string, EmojiCatalogEntry>();
const normalizedCodepointsToId = new Map<string, string>();

for (const entry of emojiCatalogEntries) {
  emojiIdToRecord.set(entry.id, entry);
  const normalizedKey = toNormalizedCodepointKey([...entry.codepoints]);
  const hasSkinTone = entry.codepoints.some((cp) => SKIN_TONE_CODEPOINTS.has(cp));
  if (!normalizedCodepointsToId.has(normalizedKey) || !hasSkinTone) {
    normalizedCodepointsToId.set(normalizedKey, entry.id);
  }
}

export const convertEmojiSequenceToIds = (emojiSequence: string): string[] => {
  if (!emojiSequence) return [];

  const segments = splitEmojiGraphemes(emojiSequence);
  if (segments.length === 0) return [];

  return segments.map((segment) => {
    const normalized = normalizeEmojiForLookup(segment);
    const candidates = [
      normalized,
      `${normalized}\uFE0F`,
      normalized.replace(/\uFE0F/g, ""),
    ];
    const id = candidates.reduce<string | undefined>((found, key) => found ?? emojiToId[key], undefined);
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
  } catch (error) {
    console.warn('Failed to rebuild fanmark display from ids:', { validIds, error });
    return base;
  }
};
