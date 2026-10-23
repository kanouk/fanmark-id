import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  makeSearchCatalog,
  searchEmoji,
  includesSkinToneQuery,
} from "../../shared/emoji-palette/search.ts";
import { emojiCatalogEntries } from "../data/emojiCatalog.ts";
import {
  DICTIONARY_URL,
  DICTIONARY_VERSION,
} from "../../shared/emoji-palette/version.ts";
import { createHash } from "node:crypto";

const bytes = await readFile(
  new URL("../../public" + DICTIONARY_URL, import.meta.url),
);
const dictionary = JSON.parse(bytes.toString());
const catalog = makeSearchCatalog(emojiCatalogEntries, dictionary);
test("four-language dictionary is immutable and joins only existing catalog IDs", () => {
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    DICTIONARY_VERSION,
  );
  assert.equal(catalog.length, 3944);
  assert.deepEqual(
    catalog.map((e) => e.id),
    emojiCatalogEntries.map((e) => e.id),
  );
  for (const language of ["ja", "en", "ko", "id"]) {
    const flower = catalog.find((e) => e.emoji === "🌸")!;
    assert.ok(flower.labels?.[language]);
    assert.ok(
      searchEmoji(catalog, flower.labels[language]).some(
        (e) => e.id === flower.id,
      ),
    );
  }
});
test("publication row order does not change routing or display order when sortOrder exists", () => {
  const entries = [
    {
      id: "b",
      emoji: "🧪",
      shortName: "test tube",
      keywords: [],
      category: "Objects",
      subcategory: "science",
      sortOrder: 2,
    },
    {
      id: "a",
      emoji: "🌸",
      shortName: "cherry blossom",
      keywords: [],
      category: "Animals & Nature",
      subcategory: "flower",
      sortOrder: 1,
    },
  ];
  assert.deepEqual(
    makeSearchCatalog(entries).map((e) => e.id),
    ["a", "b"],
  );
  assert.deepEqual(
    makeSearchCatalog([...entries].reverse()),
    makeSearchCatalog(entries),
  );
});
test("Japanese kana, mixed languages, emoji glyphs and skin variants remain searchable", () => {
  assert.ok(searchEmoji(catalog, "サクラ").some((e) => e.emoji === "🌸"));
  assert.ok(
    searchEmoji(catalog, "☕").some(
      (e) => e.emoji.replace(/\uFE0F/g, "") === "☕",
    ),
  );
  assert.ok(searchEmoji(catalog, "手 hand").length > 0);
  assert.ok(searchEmoji(catalog, "", "", true).length === 3944);
  assert.ok(searchEmoji(catalog, "").length < 3944);
});
test("new master entries without CLDR names are preserved and browsable", () => {
  const entry = {
    id: "new-stable-id",
    emoji: "🧪",
    shortName: "new_science",
    keywords: ["future"],
    category: "Objects",
    subcategory: "science",
    sortOrder: 1,
  };
  const next = makeSearchCatalog([entry], {});
  assert.equal(next[0].id, entry.id);
  assert.equal(searchEmoji(next, "future")[0].emoji, "🧪");
});


test('explicit skin tone hints in all UI languages retain variants without the checkbox',()=>{
 for(const query of ['濃い肌の親指','Thumbs Up DARK Skin Tone','엄지척 어두운 피부색','jempol warna kulit gelap','👍🏿'])assert.equal(includesSkinToneQuery(query),true);
 assert.equal(includesSkinToneQuery('coffee'),false);
});
