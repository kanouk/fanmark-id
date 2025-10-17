import type { CSSProperties } from 'react';

const FONT_SIZES: Record<number, number> = {
  1: 64,
  2: 56,
  3: 48,
  4: 44,
  5: 40,
};

/**
 * Calculates responsive styles for the fanmark badge so that both
 * the emoji size and its pill background scale gracefully up to five characters.
 */
export const createFanmarkBadgeStyle = (value?: string | null): CSSProperties => {
  const normalized = (value ?? '').trim();
  const graphemes = normalized ? Array.from(normalized) : ['✨'];
  const count = Math.min(Math.max(graphemes.length, 1), 5);

  const baseHeight = 112; // px
  const baseWidth = 112; // px
  const widthIncrement = 32; // px per additional glyph

  const width = baseWidth + (count - 1) * widthIncrement;
  const fontSize = FONT_SIZES[count] ?? FONT_SIZES[5];

  return {
    width: `${width}px`,
    minWidth: `${width}px`,
    height: `${baseHeight}px`,
    borderRadius: `${baseHeight}px`,
    fontSize: `${fontSize}px`,
    lineHeight: 1,
    padding: '0 18px',
  };
};
