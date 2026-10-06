import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runCurrentCatalogSyntheticImport } from "./test-d1-import-current-schema.mjs";

// Structural catalog metadata only: this fixture excludes all application
// rows and source function/trigger/policy/view definitions. Source parity is
// separately reviewed; this test exercises the actual target migrations.
test("current Business/Auth schemas import, resume and reconcile a synthetic snapshot without duplicate notification wake", async () => {
  const result = await runCurrentCatalogSyntheticImport(
    fileURLToPath(new URL("./fixtures/business-import-structure.json", import.meta.url)),
    { canonicalBusinessSchema: true },
  );
  assert.equal(result.businessMigrationCount, 27);
  assert.equal(result.authMigrationCount, 4);
  assert.equal(result.tableCount, 40);
  assert.equal(result.sourceRowCount, 13);
  assert.equal(result.completedCheckpointCount, 40);
  assert.equal(result.runtimeSchemaGuardRejected, true);
  assert.equal(result.runtimeFingerprintTamperRejected, true);
  assert.equal(result.freshTargetRestoreVerified, true);
  assert.deepEqual(result.notificationWakeAfterReplay, { requestedGeneration: 1, acknowledgedGeneration: 0 });
  assert.equal(result.transformedCredentialCount, 2);
  assert.equal(result.deferredCredentialCount, 1);
  assert.equal(result.conflictRejected, true);
  assert.equal(result.status, "public_rows_reconciled");
  assert.equal(result.fullMigrationReconciled, false);
  assert.equal(result.deployable, false);
  assert.match(result.runtimeSchemaFingerprint, /^[a-f0-9]{64}$/u);
});
