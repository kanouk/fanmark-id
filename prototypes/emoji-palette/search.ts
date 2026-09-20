import { emojiCatalogEntries } from '../../src/data/emojiCatalog';
import annotations from './ja-annotations.json';

export type Language = 'ja' | 'en';
export type EmojiEntry = {
  id: string; emoji: string; name: string; ja: string; category: string; subcategory: string;
  words: string[]; variant: boolean;
};
const annotationMap = annotations as Record<string, { default?: string[]; tts?: string[] }>;
const lookupKey = (value: string) => value.replace(/\uFE0F/g, '');
const jaMap = new Map(Object.entries(annotationMap).map(([key, value]) => [lookupKey(key), value]));
export const normalize = (value: string) => value.normalize('NFKC').toLowerCase()
  .replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60))
  .replace(/[_-]/g, ' ').trim();

export const catalog: EmojiEntry[] = emojiCatalogEntries.map(entry => {
  const ja = jaMap.get(lookupKey(entry.emoji));
  return {
    id: entry.id, emoji: entry.emoji, name: entry.shortName.replace(/_/g, ' '),
    ja: ja?.tts?.[0] ?? entry.shortName.replace(/_/g, ' '), category: entry.category ?? '', subcategory: entry.subcategory ?? '',
    words: [entry.shortName, ...entry.keywords, ...(ja?.default ?? []), ...(ja?.tts ?? [])].map(normalize),
    variant: /[\u{1F3FB}-\u{1F3FF}]/u.test(entry.emoji),
  };
});
export const byId = new Map(catalog.map(entry => [entry.id, entry]));
export const findEmoji = (emoji: string) => catalog.find(entry => lookupKey(entry.emoji) === lookupKey(emoji));
export const recommended = ['🌸', '✨', '🫶', '☕', '🐈', '🌿', '🎀', '🪐', '🍓', '🧸', '🌷', '🫧', '🍀', '🦋', '🌙', '🐣'].map(findEmoji).filter((e): e is EmojiEntry => !!e);
export const categories = [
  ['Smileys & Emotion', '表情・気持ち', 'Faces & feelings'],
  ['People & Body', '人・からだ', 'People & body'],
  ['Animals & Nature', '動物・自然', 'Animals & nature'],
  ['Food & Drink', '食べ物・飲み物', 'Food & drink'],
  ['Travel & Places', '旅・場所', 'Travel & places'],
  ['Activities', '遊び・イベント', 'Activities'],
  ['Objects', 'もの', 'Objects'],
  ['Symbols', '記号', 'Symbols'],
  ['Flags', '旗', 'Flags'],
];

export function searchEmoji(query: string, category = '', includeVariants = false): EmojiEntry[] {
  const text = normalize(query);
  const tokens = text.split(/\s+/).filter(Boolean);
  const skinSearch = /肌|はだ|skin|tone/.test(text) || /[\u{1F3FB}-\u{1F3FF}]/u.test(text);
  return catalog.flatMap((entry, index) => {
    if (category && entry.category !== category) return [];
    if (entry.variant && !includeVariants && !skinSearch && lookupKey(query) !== lookupKey(entry.emoji)) return [];
    if (!text) return [{ entry, score: 0, index }];
    const exactEmoji = lookupKey(query.trim()) === lookupKey(entry.emoji);
    const tokenScores = tokens.map(token => Math.max(0, ...entry.words.map(word => word === token ? 100 : word.startsWith(token) ? 70 : word.includes(token) ? 40 : 0)));
    const lexical = tokenScores.every(score => score > 0) ? tokenScores.reduce((sum, score) => sum + score, 0) / tokenScores.length : 0;
    const score = exactEmoji ? 1000 : lexical;
    return score ? [{ entry, score, index }] : [];
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(result => result.entry);
}
