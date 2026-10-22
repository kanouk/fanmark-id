/** Presentation uses Unicode graphemes and never needs catalog UUIDs or a network request. */
export function segmentEmojiForDisplay(value: string): string[] {
  if (!value) return [];
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value), item => item.segment);
  }
  return Array.from(value);
}
