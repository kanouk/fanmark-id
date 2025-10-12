import {
  EmojiMasterRecord,
  primeEmojiMasterCache,
  convertEmojiSequenceToIds,
  convertEmojiIdsToSequence,
  convertEmojiIdsToNormalizedIds,
  convertEmojiSequenceToNormalizedIds,
} from "../src/lib/emoji-master-utils.js";

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
] satisfies EmojiMasterRecord[];

const testEmojis = [
  { label: "Medium skin tone hand", emoji: "👋🏽" },
  { label: "Family (man woman girl)", emoji: "👨‍👩‍👧" },
  { label: "Rainbow flag", emoji: "🏳️‍🌈" },
];

const main = async () => {
  console.log("⚙️  Priming emoji master cache with sample records...");
  primeEmojiMasterCache(sampleRecords);

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
