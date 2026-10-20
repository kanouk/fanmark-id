import {
  type EmojiMasterRecord,
  primeEmojiMasterCache,
  convertEmojiSequenceToIds,
  convertEmojiIdsToSequence,
  convertEmojiIdsToNormalizedIds,
  convertEmojiSequenceToNormalizedIds,
} from "../src/lib/emoji-master-utils.ts";
import { emojiCatalogEntries, emojiToId } from "../src/data/emojiCatalog.ts";
import { canonicalizeEmojiString, installEmojiCatalog } from "../src/lib/emojiConversion.ts";

const sampleRecords: EmojiMasterRecord[] = [
  {
    id: "waving-hand",
    emoji: "👋",
    short_name: "waving_hand",
    keywords: ["waving", "hand"],
    category: "People & Body",
    subcategory: "hand-fingers-open",
    codepoints: ["1F44B"],
    sort_order: 0,
  },
  {
    id: "waving-hand-medium",
    emoji: "👋🏽",
    short_name: "waving_hand_medium_skin_tone",
    keywords: ["waving", "hand", "medium", "skin", "tone"],
    category: "People & Body",
    subcategory: "hand-fingers-open",
    codepoints: ["1F44B", "1F3FD"],
    sort_order: 1,
  },
  {
    id: "family-man-woman-girl",
    emoji: "👨‍👩‍👧",
    short_name: "family_man_woman_girl",
    keywords: ["family", "man", "woman", "girl"],
    category: "People & Body",
    subcategory: "family",
    codepoints: ["1F468", "200D", "1F469", "200D", "1F467"],
    sort_order: 2,
  },
  {
    id: "rainbow-flag",
    emoji: "🏳️‍🌈",
    short_name: "rainbow_flag",
    keywords: ["rainbow", "flag"],
    category: "Flags",
    subcategory: "subdivision-flag",
    codepoints: ["1F3F3", "FE0F", "200D", "1F308"],
    sort_order: 3,
  },
  {
    id: "head-shaking-horizontally",
    emoji: "🙂‍↔️",
    short_name: "head_shaking_horizontally",
    keywords: ["head", "shaking", "horizontally"],
    category: "Smileys & Emotion",
    subcategory: "face-neutral-skeptical",
    codepoints: ["1F642", "200D", "2194", "FE0F"],
    sort_order: 4,
  },
  {
    id: "woman-health-worker",
    emoji: "👩‍⚕️",
    short_name: "woman_health_worker",
    keywords: ["woman", "doctor", "nurse"],
    category: "People & Body",
    subcategory: "person-role",
    codepoints: ["1F469", "200D", "2695", "FE0F"],
    sort_order: 5,
  },
  {
    id: "singer",
    emoji: "🧑‍🎤",
    short_name: "singer",
    keywords: ["singer", "artist", "performer"],
    category: "People & Body",
    subcategory: "person-role",
    codepoints: ["1F9D1", "200D", "1F3A4"],
    sort_order: 6,
  },
  {
    id: "pirate-flag",
    emoji: "🏴‍☠️",
    short_name: "pirate_flag",
    keywords: ["pirate", "flag"],
    category: "Flags",
    subcategory: "subdivision-flag",
    codepoints: ["1F3F4", "200D", "2620", "FE0F"],
    sort_order: 7,
  },
  {
    id: "heart-on-fire",
    emoji: "❤️‍🔥",
    short_name: "heart_on_fire",
    keywords: ["heart", "fire"],
    category: "Smileys & Emotion",
    subcategory: "emotion",
    codepoints: ["2764", "FE0F", "200D", "1F525"],
    sort_order: 8,
  },
  {
    id: "people-holding-hands-medium-dark-light",
    emoji: "🧑🏽‍🤝‍🧑🏻",
    short_name: "people_holding_hands_medium_dark_light",
    keywords: ["people", "holding", "hands"],
    category: "People & Body",
    subcategory: "family",
    codepoints: ["1F9D1", "1F3FD", "200D", "1F91D", "200D", "1F9D1", "1F3FB"],
    sort_order: 9,
  },
  {
    id: "handshake-light-skin-tone",
    emoji: "🤝🏻",
    short_name: "handshake_light_skin_tone",
    keywords: ["handshake", "agreement"],
    category: "People & Body",
    subcategory: "hands",
    codepoints: ["1F91D", "1F3FB"],
    sort_order: 10,
  },
  {
    id: "face-without-mouth",
    emoji: "😶",
    short_name: "face_without_mouth",
    keywords: ["face", "without", "mouth"],
    category: "Smileys & Emotion",
    subcategory: "face-neutral-skeptical",
    codepoints: ["1F636"],
    sort_order: 11,
  },
  {
    id: "face-in-clouds",
    emoji: "😶‍🌫️",
    short_name: "face_in_clouds",
    keywords: ["face", "in", "clouds"],
    category: "Smileys & Emotion",
    subcategory: "emotion",
    codepoints: ["1F636", "200D", "1F32B", "FE0F"],
    sort_order: 12,
  },
] satisfies EmojiMasterRecord[];

const testEmojis = [
  { label: "Medium skin tone hand", emoji: "👋🏽" },
  { label: "Family (man woman girl)", emoji: "👨‍👩‍👧" },
  { label: "Rainbow flag", emoji: "🏳️‍🌈" },
  { label: "SMILING FACE WITH SMILING EYES + ZWJ ARROW", emoji: "🙂‍↔️" },
  { label: "Woman health worker", emoji: "👩‍⚕️" },
  { label: "Singer", emoji: "🧑‍🎤" },
  { label: "Handshake with different skin tones", emoji: "🤝🏻" },
  { label: "Pirate flag", emoji: "🏴‍☠️" },
  { label: "Heart on fire", emoji: "❤️‍🔥" },
  { label: "People holding hands", emoji: "🧑🏽‍🤝‍🧑🏻" },
  { label: "Face without mouth", emoji: "😶" },
  { label: "Face in clouds", emoji: "😶‍🌫️" },
];

const canonicalizationCases = [
  { label: "Simple face remains simple", input: "😶", expected: "😶" },
  { label: "Head shake missing VS", input: "🙂‍↔", expected: "🙂‍↔️" },
  { label: "Head shake truncated sequence", input: "🙂‍↔️🙂‍↔️🙂‍", expected: "🙂‍↔️🙂‍↔️🙂‍↔️" },
  { label: "Flag with text-style selector", input: "🏳️\uFE0E‍🌈", expected: "🏳️‍🌈" },
  { label: "Woman health worker text-style", input: "👩‍⚕\uFE0E", expected: "👩‍⚕️" },
  { label: "Singer with spaces", input: " 🧑‍🎤 ", expected: "🧑‍🎤" },
  { label: "Handshake separate components", input: "🤝🏻", expected: "🤝🏻" },
  { label: "Face in clouds remains combined", input: "😶‍🌫️", expected: "😶‍🌫️" },
];

const main = async () => {
  installEmojiCatalog(emojiCatalogEntries, emojiToId);
  console.log("⚙️  Priming emoji master cache with sample records...");
  primeEmojiMasterCache(sampleRecords);

  for (const canonicalCase of canonicalizationCases) {
    const canonical = canonicalizeEmojiString(canonicalCase.input);
    if (canonical !== canonicalCase.expected) {
      console.error("❌ Canonicalization mismatch", { canonicalCase, canonical });
      throw new Error(`Canonicalization failed for ${canonicalCase.label}`);
    }
    console.log(`✅ Canonicalization passed: ${canonicalCase.label}`);
  }

  for (const test of testEmojis) {
    console.log(`\n🔍 Testing: ${test.label}`);
    const ids = await convertEmojiSequenceToIds(test.emoji);
    console.log(`  ➡️  Converted to IDs:`, ids);
    const restored = await convertEmojiIdsToSequence(ids);
    console.log(`  ⬅️  Restored sequence:`, restored);
    const normalizedIds = await convertEmojiIdsToNormalizedIds(ids);
    console.log(`  🔧 Normalized IDs:`, normalizedIds);
    const normalizedRestored = await convertEmojiIdsToSequence(normalizedIds);
    console.log(`  🔄 Normalized sequence:`, normalizedRestored);
    if (restored !== test.emoji) {
      throw new Error(`Round-trip conversion failed for ${test.label}`);
    }
    const directNormalizedIds = await convertEmojiSequenceToNormalizedIds(test.emoji);
    if (JSON.stringify(normalizedIds) !== JSON.stringify(directNormalizedIds)) {
      throw new Error(`Sequence-based normalization mismatch for ${test.label}`);
    }
  }

  console.log("\n✅ All sample emoji round-trip conversions succeeded!");
};

main().catch((error) => {
  console.error("❌ Emoji conversion test failed:", error);
  process.exit(1);
});
