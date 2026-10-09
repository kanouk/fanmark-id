import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeEmojiString,
  convertEmojiIdsToNormalizedIds,
  convertEmojiIdsToSequence,
  convertEmojiSequenceToIds,
  installEmojiCatalog,
} from "../src/lib/emojiConversion.ts";

const SMILE = "11111111-1111-4111-8111-111111111111";
const SMILE_TONE = "22222222-2222-4222-8222-222222222222";
const WOMAN_TECH = "33333333-3333-4333-8333-333333333333";
const MUSIC = "44444444-4444-4444-8444-444444444444";
const HEAD_SHAKE = "55555555-5555-4555-8555-555555555555";

test("builds conversion indexes from a downloaded catalog and replaces old versions", () => {
  installEmojiCatalog([
    {
      id: SMILE,
      emoji: "😀",
      shortName: "grinning face",
      keywords: ["face"],
      category: "Smileys & Emotion",
      subcategory: "face-smiling",
      codepoints: ["1F600"],
      sortOrder: 1,
    },
    {
      id: SMILE_TONE,
      emoji: "😀🏻",
      shortName: "grinning face light skin tone",
      keywords: ["face", "tone"],
      category: "Smileys & Emotion",
      subcategory: "face-smiling",
      codepoints: ["1F600", "1F3FB"],
      sortOrder: 2,
    },
    {
      id: WOMAN_TECH,
      emoji: "👩‍💻",
      shortName: "woman technologist",
      keywords: ["developer"],
      category: "People & Body",
      subcategory: "person-role",
      codepoints: ["1F469", "200D", "1F4BB"],
      sortOrder: 3,
    },
    {
      id: HEAD_SHAKE,
      emoji: "🙂‍↔️",
      shortName: "head shaking horizontally",
      keywords: ["head", "shaking"],
      category: "Smileys & Emotion",
      subcategory: "face-neutral-skeptical",
      codepoints: ["1F642", "200D", "2194", "FE0F"],
      sortOrder: 4,
    },
  ]);

  assert.deepEqual(convertEmojiSequenceToIds("😀👩‍💻"), [SMILE, WOMAN_TECH]);
  assert.equal(convertEmojiIdsToSequence([SMILE, WOMAN_TECH]), "😀👩‍💻");
  assert.deepEqual(convertEmojiIdsToNormalizedIds([SMILE_TONE]), [SMILE]);
  assert.equal(canonicalizeEmojiString("👩‍💻"), "👩‍💻");
  assert.equal(canonicalizeEmojiString("🙂‍↔️🙂‍↔️🙂‍"), "🙂‍↔️🙂‍↔️🙂‍↔️");

  installEmojiCatalog([
    {
      id: MUSIC,
      emoji: "🎵",
      shortName: "musical note",
      keywords: ["music"],
      category: "Objects",
      subcategory: "music",
      codepoints: ["1F3B5"],
      sortOrder: 1,
    },
  ]);

  assert.deepEqual(convertEmojiSequenceToIds("🎵"), [MUSIC]);
  assert.throws(() => convertEmojiSequenceToIds("😀"), /サポートされていません/);
  assert.throws(() => convertEmojiIdsToSequence([SMILE]), /未知の絵文字ID/);
});
