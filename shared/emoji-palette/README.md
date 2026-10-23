# Palette dictionary and search

Unicode CLDR JSON commit `1aaabe99aa652d6f22ea488cf25baea46aa69b42`; ja/en/ko/id `annotations` + `annotationsDerived`. License: `public/palette/UNICODE-LICENSE.txt`.

- `node scripts/emoji/palette-dictionary.mjs`: offline hash/language verification, included in normal CI.
- `node scripts/emoji/palette-dictionary.mjs --refresh`: explicit regeneration from the fixed Unicode commit. It does not run at build/startup. Review the resulting version/file changes before release.
- `version.ts`: SHA-256 / hash URL, schema and normalization versions. The JSON is in `public/assets/palette-dictionary-*.json`, fetched and verified only when the palette opens. It is not PWA precached. Keep previous hashed JSONs available to installed clients.
- `jev-annotations.json`: Japanese descriptions preserved from prototype commit `c0d10d8de4b0d8fb7c749a40c0df9239bd40d6b0` (same pinned CLDR source). Keep its description ordering when comparing Jev quality; it is server-only.
- `search.ts`: joins names to the selected catalog by Unicode glyph. No IDs are generated/reassigned. All returned IDs belong to that ready catalog. Missing CLDR entries retain the catalog's English name/keywords. Master `sortOrder` defines display/routing order; publication row order is not semantic order.

Client and server exchange `catalogVersion`, `dictionaryVersion`, `schemaVersion`, `normalizationVersion`. Search compares the current ready version even for a cached result. The existing catalog publication protocol and IDs remain unchanged; the palette dictionary is an independently versioned, optional name overlay, not a replacement emoji master. Updating the CLDR source or normalization contract requires its own reviewed release and compatibility checks.
