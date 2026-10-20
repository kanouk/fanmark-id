/** Source classify_fanmark_tier rules for the caller's ordered, canonical IDs. */
export function classifyFanmarkTier(emojiIds: readonly string[]): number {
  const count = emojiIds.length;
  const uniqueCount = new Set(emojiIds).size;
  if (count === 1) return 4;
  if (uniqueCount === 1 && count >= 2 && count <= 5) return 3;
  if (count >= 4) return 1;
  if (count === 3) return 2;
  if (count === 2) return 3;
  return 1;
}
