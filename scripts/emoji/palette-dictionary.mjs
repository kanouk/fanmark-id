// Explicit generation uses only the pinned Unicode CLDR source. Normal checks are offline.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../", import.meta.url),
  REV = "1aaabe99aa652d6f22ea488cf25baea46aa69b42",
  languages = ["ja", "en", "ko", "id"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (process.argv[2] === "--refresh") {
  const all = {};
  for (const language of languages)
    for (const [packageName, folder] of [
      ["cldr-annotations-full", "annotations"],
      ["cldr-annotations-derived-full", "annotationsDerived"],
    ]) {
      const url = `https://raw.githubusercontent.com/unicode-org/cldr-json/${REV}/cldr-json/${packageName}/${folder}/${language}/annotations.json`;
      const r = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(r.status, 200);
      const raw = await r.json();
      for (const [emoji, record] of Object.entries(
        Object.values(raw)[0].annotations,
      )) {
        const key = emoji.replace(/\uFE0F/g, "");
        const translations = (all[key] ??= {});
        translations[language] = [
          ...new Set([
            ...(record.tts ?? []),
            ...(translations[language] ?? []),
            ...(record.default ?? []),
          ]),
        ];
      }
    }
  const bytes = Buffer.from(JSON.stringify(all) + "\n"),
    sha = hash(bytes),
    url = `/assets/palette-dictionary-${sha.slice(0, 8)}.json`;
  await mkdir(new URL("public/assets", root), { recursive: true });
  try {
    assert.deepEqual(await readFile(new URL("public" + url, root)), bytes);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(new URL("public" + url, root), bytes, { flag: "wx" });
  }
  await writeFile(
    new URL("shared/emoji-palette/version.ts", root),
    `export const DICTIONARY_VERSION = "${sha}";\nexport const DICTIONARY_URL = "${url}";\nexport const PALETTE_SCHEMA_VERSION = 1;\nexport const NORMALIZATION_VERSION = 1;\n`,
  );
} else {
  assert.equal(
    process.argv.length,
    2,
    "Use no args for offline verification, or --refresh for explicit generation",
  );
}
const source = await readFile(
    new URL("shared/emoji-palette/version.ts", root),
    "utf8",
  ),
  version = /DICTIONARY_VERSION\s*=\s*"([a-f0-9]{64})"/.exec(source)?.[1],
  url =
    /DICTIONARY_URL\s*=\s*"(\/assets\/palette-dictionary-[a-f0-9]{8}\.json)"/.exec(
      source,
    )?.[1];
assert.ok(version && url);
const bytes = await readFile(new URL("public" + url, root));
assert.equal(hash(bytes), version);
const dictionary = JSON.parse(bytes.toString());
for (const language of languages)
  assert.ok(
    Object.values(dictionary).some((record) => record[language]?.length),
  );
console.log(
  JSON.stringify({
    verified: true,
    version,
    bytes: bytes.length,
    entries: Object.keys(dictionary).length,
    languages,
    source: REV,
  }),
);
