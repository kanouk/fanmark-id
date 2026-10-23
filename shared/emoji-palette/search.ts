const lookupKey = (value: string) => value.replace(/\uFE0F/g, "");
export type Language = "ja" | "en" | "ko" | "id";
export type EmojiEntry = {
  id: string;
  emoji: string;
  name: string;
  ja: string;
  category: string;
  subcategory: string;
  labels?: Partial<Record<Language, string>>;
  words: string[];
  variant: boolean;
};
export const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0x60),
    )
    .replace(/[_-]/g, " ")
    .trim();

export const categories = [
  ["Smileys & Emotion", "表情・気持ち", "Faces & feelings"],
  ["People & Body", "人・からだ", "People & body"],
  ["Animals & Nature", "動物・自然", "Animals & nature"],
  ["Food & Drink", "食べ物・飲み物", "Food & drink"],
  ["Travel & Places", "旅・場所", "Travel & places"],
  ["Activities", "遊び・イベント", "Activities"],
  ["Objects", "もの", "Objects"],
  ["Symbols", "記号", "Symbols"],
  ["Flags", "旗", "Flags"],
];

export function searchEmoji(
  catalog: EmojiEntry[],
  query: string,
  category = "",
  includeVariants = false,
): EmojiEntry[] {
  const text = normalize(query);
  const tokens = text.split(/\s+/).filter(Boolean);
  const skinSearch = includesSkinToneQuery(query);
  return catalog
    .flatMap((entry, index) => {
      if (category && entry.category !== category) return [];
      if (
        entry.variant &&
        !includeVariants &&
        !skinSearch &&
        lookupKey(query) !== lookupKey(entry.emoji)
      )
        return [];
      if (!text) return [{ entry, score: 0, index }];
      const exactEmoji = lookupKey(query.trim()) === lookupKey(entry.emoji);
      const tokenScores = tokens.map((token) =>
        Math.max(
          0,
          ...entry.words.map((word) =>
            word === token
              ? 100
              : word.startsWith(token)
                ? 70
                : word.includes(token)
                  ? 40
                  : 0,
          ),
        ),
      );
      const lexical = tokenScores.every((score) => score > 0)
        ? tokenScores.reduce((sum, score) => sum + score, 0) /
          tokenScores.length
        : 0;
      const score = exactEmoji ? 1000 : lexical;
      return score ? [{ entry, score, index }] : [];
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((result) => result.entry);
}

export type CatalogEntry = {
  id: string;
  emoji: string;
  shortName: string;
  keywords: readonly string[];
  category: string | null;
  subcategory: string | null;
  sortOrder?: number | null;
};
export type Dictionary = Record<string, Partial<Record<Language, string[]>>>;
export function makeSearchCatalog(
  entries: readonly CatalogEntry[],
  dictionary: Dictionary = {},
): EmojiEntry[] {
  return [...entries]
    .sort(
      (a, b) =>
        (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        (a.sortOrder === undefined && b.sortOrder === undefined
          ? 0
          : a.emoji.localeCompare(b.emoji)),
    )
    .map((entry) => {
      const labels = dictionary[entry.emoji.replace(/\uFE0F/g, "")] ?? {};
      const name = entry.shortName.replace(/_/g, " ");
      return {
        id: entry.id,
        emoji: entry.emoji,
        name,
        ja: labels.ja?.[0] ?? name,
        labels: Object.fromEntries(
          Object.entries(labels).map(([lang, words]) => [
            lang,
            words?.[0] ?? name,
          ]),
        ),
        category: entry.category ?? "",
        subcategory: entry.subcategory ?? "",
        words: [name, ...entry.keywords, ...Object.values(labels).flat()].map(
          normalize,
        ),
        variant: /[\u{1F3FB}-\u{1F3FF}]/u.test(entry.emoji),
      };
    });
}


export const includesSkinToneQuery = (query: string) => /肌|はだ|skin|tone|피부|살색|kulit|[\u{1F3FB}-\u{1F3FF}]/u.test(normalize(query));
