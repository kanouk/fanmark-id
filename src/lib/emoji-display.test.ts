import assert from 'node:assert/strict';
import test from 'node:test';
import { segmentEmojiForDisplay } from './emoji-display.ts';

test('catalog-free display preserves ZWJ, flags, variation selectors and skin tone graphemes', () => {
  assert.deepEqual(segmentEmojiForDisplay('👩🏽‍💻🇯🇵❤️👨‍👩‍👧‍👦😀'), ['👩🏽‍💻', '🇯🇵', '❤️', '👨‍👩‍👧‍👦', '😀']);
  assert.deepEqual(segmentEmojiForDisplay(''), []);
});
