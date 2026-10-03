import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCurrentCatalogSyntheticImport } from "./test-d1-import-current-schema.mjs";
import { createSyntheticAuxiliaryRecovery } from "./synthetic-auxiliary-recovery.mjs";

test("one synthetic snapshot bundle restores Business/Auth/Master and linked assets to independent split R2 buckets", async (context) => {
  const result = await runCurrentCatalogSyntheticImport(
    fileURLToPath(new URL("./fixtures/business-import-structure.json", import.meta.url)),
    { canonicalBusinessSchema: true, auxiliaryRecovery: createSyntheticAuxiliaryRecovery() },
  );
  assert.equal(result.sourceRowCount, 15);
  assert.equal(result.completedCheckpointCount, 40);
  assert.equal(result.freshTargetRestoreVerified, true);
  assert.equal(result.auxiliaryRecovery.masterMigrationCount, 8);
  assert.equal(result.auxiliaryRecovery.masterEmojiCount, 3);
  assert.equal(result.auxiliaryRecovery.masterTierCount, 4);
  assert.equal(result.auxiliaryRecovery.r2ObjectCount, 2);
  assert.equal(result.auxiliaryRecovery.linkedAssetsVerified, true);
  assert.equal(result.auxiliaryRecovery.physicalBucketKeysVerified, true);
  assert.equal(result.auxiliaryRecovery.applicationStorageReadVerified, true);
  assert.equal(result.deployable, false);
  assert.equal(result.fullMigrationReconciled, false);
  context.diagnostic(JSON.stringify({ freshTargetRestoreDurationMs: result.freshTargetRestoreDurationMs,
    sourceTableCount: result.tableCount, sourceRowCount: result.sourceRowCount, ...result.auxiliaryRecovery }));
});
