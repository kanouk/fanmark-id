/** Local synthetic bundle recovery; never reads production rows or objects. */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createEmojiReleaseArtifacts } from "../build-emoji-release.ts";
import { stageEmojiMasterRelease } from "./emoji-master-release-stage.mjs";
import { activateEmojiMasterRelease, readEmojiMasterActiveRelease } from "./emoji-master-release-activate.mjs";
import { stageReferenceMasterRelease, activateReferenceMasterRelease, verifyStagedReferenceMasterRelease } from "./reference-master-release.mjs";
import { createEmojiMasterD1Repository } from "../../workers/api/src/emoji-master-d1-repository.ts";
import { objectIdentityHash } from "./storage-export.mjs";
import { importStorageExport } from "./storage-r2-import.mjs";
import { createLocalR2ImportTransport } from "./local-r2-import-transport.mjs";
import { createSplitR2ImportTransport } from "./split-r2-import-transport.mjs";
import { businessMigrationStatements } from "./business-runtime-import-schema.mjs";
import { sha256Hex } from "./snapshot-format.mjs";
import { handleStorageRequest } from "../../workers/api/src/storage-r2.ts";

const OWNER = "90000000-0000-4000-8000-00000000000d";
const timestamp = "2026-09-26T12:00:00.000000Z";
// The eight active Master migrations plus its retained historical Auth core.
const masterMigrations = ["0000_emoji_master.sql", "0001_emoji_master_release_staging.sql",
  "0002_emoji_master_release_activation.sql", "0003_better_auth_core.sql", "0004_reference_master_releases.sql",
  "0005_emoji_master_admin_guards.sql", "0006_reference_master_extension_prices.sql",
  "0007_release_audit_timestamps.sql", "0008_emoji_master_change_audits.sql"];

async function privateJson(file, value) {
  const bytes = `${JSON.stringify(value)}\n`;
  await fs.writeFile(file, bytes, { mode: 0o600 });
  return bytes;
}

async function prepareBundle(root, manifestPath) {
  const emojiDirectory = path.join(root, "recovery-emoji-release");
  const storageDirectory = path.join(root, "recovery-storage-export");
  await fs.mkdir(emojiDirectory, { mode: 0o700 });
  await fs.mkdir(path.join(storageDirectory, "objects"), { recursive: true, mode: 0o700 });
  await fs.chmod(storageDirectory, 0o700);
  const emoji = [["004", "😀", "grinning_face"], ["00b", "🧴", "lotion_bottle"], ["00c", "🥀", "wilted_flower"]]
    .map(([suffix, character, name], index) => ({ id: `90000000-0000-4000-8000-000000000${suffix}`,
      emoji: character, short_name: name, keywords: [name], category: "Synthetic", subcategory: null,
      codepoints: [...character].map(point => point.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")), sort_order: index }));
  const release = createEmojiReleaseArtifacts(emoji);
  await fs.writeFile(path.join(emojiDirectory, "records.json"), release.recordsSource, { mode: 0o600 });
  await fs.writeFile(path.join(emojiDirectory, "emojiCatalog.ts"), release.moduleSource, { mode: 0o600 });
  await privateJson(path.join(emojiDirectory, "manifest.json"), release.manifest);
  const entries = {
    fanmark_tiers: [[1, "C", 4, 5, null], [2, "B", 3, 3, 30], [3, "A", 2, 5, 14], [4, "S", 1, 1, 7]]
      .map(([tier_level, display_name, emoji_count_min, emoji_count_max, initial_license_days]) => ({
        id: `91000000-0000-4000-8000-00000000000${tier_level}`, tier_level, display_name,
        emoji_count_min, emoji_count_max, initial_license_days, is_active: true, description: "Synthetic recovery tier",
        monthly_price_usd: "0.00", created_at: timestamp, updated_at: timestamp,
      })),
    languages: [["ja", "Japanese", "日本語"], ["en", "English", "English"]].map(([code, label, native_label], index) => ({
      id: `92000000-0000-4000-8000-00000000000${index + 1}`, code, label, native_label,
      sort_order: index, is_active: true, created_at: timestamp, updated_at: timestamp,
    })),
    reserved_emoji_patterns: [],
    fanmark_tier_extension_prices: [{ id: "93000000-0000-4000-8000-000000000001", tier_level: 4, months: 1,
      price_yen: 100, stripe_price_id: "price_syntheticRecovery", stripe_price_id_live: null,
      is_active: true, created_at: timestamp, updated_at: timestamp }],
  };
  const referenceSnapshot = Object.entries(entries).map(([table_name, records]) => ({
    table_name, records, row_count: records.length, source_sha256: sha256Hex(records),
  }));
  const referenceBytes = await privateJson(path.join(root, "recovery-reference-snapshot.json"), referenceSnapshot);
  const referenceVersion = sha256Hex(referenceBytes);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  const objects = [];
  for (const [bucket, name] of [["avatars", "avatar.png"], ["cover-images", "cover.png"]]) {
    const key = `${OWNER}/${name}`;
    const localFile = `objects/${objectIdentityHash(bucket, key)}`;
    await fs.writeFile(path.join(storageDirectory, localFile), png, { mode: 0o600 });
    objects.push({ bucket, key, size: png.length, contentSHA256: sha256Hex(png), metadata: { mimetype: "image/png" }, localFile });
  }
  const inventoryHash = sha256Hex(objects);
  const inventory = { stable: true, beforeSHA256: inventoryHash, afterSHA256: inventoryHash };
  const storageManifest = { schemaVersion: 1, complete: true, generatedAt: timestamp,
    buckets: ["avatars", "cover-images"], objectCount: objects.length, inventory, objects };
  const storageBytes = await privateJson(path.join(storageDirectory, "manifest.json"), storageManifest);
  await privateJson(path.join(storageDirectory, "export.status.json"), { schemaVersion: 1, status: "complete",
    startedAt: timestamp, buckets: storageManifest.buckets, objectCount: objects.length, inventory });
  const bundle = { schemaVersion: 1, businessManifestSHA256: sha256Hex(await fs.readFile(manifestPath)),
    emojiVersion: release.version, referenceVersion, storageManifestSHA256: sha256Hex(storageBytes) };
  await privateJson(path.join(root, "synthetic-recovery-bundle.json"), bundle);
  return { emojiDirectory, storageDirectory, referenceSnapshot, referenceVersion, release, objects, bundle };
}

export function createSyntheticAuxiliaryRecovery() {
  let prepared = null;
  return async ({ target, root, manifestPath, phase }) => {
    prepared ??= await prepareBundle(root, manifestPath);
    const persistedBundle = JSON.parse(await fs.readFile(path.join(root, "synthetic-recovery-bundle.json"), "utf8"));
    assert.deepEqual(persistedBundle, prepared.bundle);
    assert.equal(sha256Hex(await fs.readFile(manifestPath)), prepared.bundle.businessManifestSHA256);
    assert.equal(sha256Hex(await fs.readFile(path.join(prepared.storageDirectory, "manifest.json"))), prepared.bundle.storageManifestSHA256);
    const referenceBytes = await fs.readFile(path.join(root, "recovery-reference-snapshot.json"));
    assert.equal(sha256Hex(referenceBytes), prepared.bundle.referenceVersion);
    const referenceSnapshot = JSON.parse(referenceBytes.toString("utf8"));
    const master = target.masterDatabase;
    for (const name of masterMigrations) {
      const sql = await fs.readFile(new URL(`../../workers/api/migrations/${name}`, import.meta.url), "utf8");
      await master.batch(businessMigrationStatements(sql).map(statement => master.prepare(statement)));
    }
    await stageEmojiMasterRelease({ database: master, releaseDirectory: prepared.emojiDirectory });
    await activateEmojiMasterRelease({ database: master, releaseDirectory: prepared.emojiDirectory, expectedCurrentVersion: null });
    assert.equal((await readEmojiMasterActiveRelease(master)).version, prepared.release.version);
    await stageReferenceMasterRelease({ database: master, snapshot: referenceSnapshot, snapshotSha256: prepared.referenceVersion });
    await activateReferenceMasterRelease({ database: master, releaseVersion: prepared.referenceVersion,
      expectedActiveVersion: null, activationId: `synthetic-recovery-${phase}` });
    assert.equal(await verifyStagedReferenceMasterRelease({ database: master, snapshot: referenceSnapshot,
      snapshotSha256: prepared.referenceVersion }), true);
    const page = await createEmojiMasterD1Repository({ MASTER_DB: master, D1_TOPOLOGY: "split", EMOJI_CATALOG_BACKEND: "d1" })
      .readPage({ version: null, offset: 0, limit: 500 });
    assert.equal(page.total, 3);
    const knownIds = new Set(page.items.map(row => row.id));
    const fanmarks = (await target.database.prepare("SELECT emoji_ids, normalized_emoji_ids, tier_level FROM fanmarks ORDER BY id").all()).results;
    for (const fanmark of fanmarks) {
      for (const id of [...JSON.parse(fanmark.emoji_ids), ...JSON.parse(fanmark.normalized_emoji_ids)]) assert.equal(knownIds.has(id), true);
      assert.ok(await master.prepare("SELECT tier_level FROM fanmark_tiers WHERE tier_level = ? AND is_active = 1").bind(fanmark.tier_level).first());
    }
    const loopbackBase = await target.miniflare.ready;
    const avatar = createLocalR2ImportTransport({ bucket: target.avatarBucket, loopbackBase, bucketBinding: "AVATARS_BUCKET" });
    const cover = createLocalR2ImportTransport({ bucket: target.coverBucket, loopbackBase, bucketBinding: "COVER_IMAGES_BUCKET" });
    const r2 = createSplitR2ImportTransport({ avatars: avatar, covers: cover });
    const options = { exportDir: prepared.storageDirectory, reportPath: path.join(prepared.storageDirectory, `${phase}-r2-import.status.json`),
      r2, operationTimeoutMs: 10000, chunkSize: 3 };
    assert.equal((await importStorageExport(options)).copiedCount, 2);
    const replay = await importStorageExport(options);
    assert.equal(replay.complete, true);
    const user = await target.database.prepare("SELECT avatar_url FROM user_settings WHERE user_id = ?").bind(OWNER).first();
    const profile = await target.database.prepare("SELECT theme_settings FROM fanmark_profiles WHERE license_id = ?")
      .bind("90000000-0000-4000-8000-000000000002").first();
    const assetUrls = [user.avatar_url, JSON.parse(profile.theme_settings).cover_image_url];
    for (const [index, url] of assetUrls.entries()) {
      const key = new URL(url).pathname.split("/storage/v1/object/public/")[1];
      assert.equal(key, `${prepared.objects[index].bucket}/${prepared.objects[index].key}`);
      const object = await r2.get(key);
      assert.ok(object);
      assert.equal(sha256Hex(Buffer.from(await object.arrayBuffer())), prepared.objects[index].contentSHA256);
      assert.equal(object.httpMetadata.contentType, "image/png");
      const response = await handleStorageRequest(
        new Request(`https://synthetic-recovery.example.test/api/storage/public/${key}`),
        { STORAGE_BACKEND: "r2", AVATARS_BUCKET: target.avatarBucket, COVER_IMAGES_BUCKET: target.coverBucket },
        async () => ({ available: true, userId: null }),
      );
      assert.equal(response?.status, 200, "restored asset must be readable through the actual application Storage API");
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(sha256Hex(Buffer.from(await response.arrayBuffer())), prepared.objects[index].contentSHA256);
      const head = await handleStorageRequest(
        new Request(`https://synthetic-recovery.example.test/api/storage/public/${key}`, { method: "HEAD" }),
        { STORAGE_BACKEND: "r2", AVATARS_BUCKET: target.avatarBucket, COVER_IMAGES_BUCKET: target.coverBucket },
        async () => ({ available: true, userId: null }),
      );
      assert.equal(head?.status, 200);
      assert.equal(head.headers.get("content-length"), String(prepared.objects[index].size));
    }
    assert.deepEqual((await target.avatarBucket.list()).objects.map(object => object.key), [prepared.objects[0].key]);
    assert.deepEqual((await target.coverBucket.list()).objects.map(object => object.key), [prepared.objects[1].key]);
    assert.deepEqual((await master.prepare("PRAGMA foreign_key_check").all()).results, []);
    return { bundleSHA256: sha256Hex(prepared.bundle), emojiVersion: prepared.release.version,
      referenceVersion: prepared.referenceVersion, masterEmojiCount: 3, masterTierCount: 4,
      masterMigrationCount: 8, retainedMasterAuthCore: true, r2ObjectCount: 2, linkedAssetsVerified: true,
      physicalBucketKeysVerified: true, applicationStorageReadVerified: true };
  };
}
