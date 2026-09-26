import { randomUUID } from "node:crypto";
import { createEmojiReleaseArtifacts, verifyRelease } from "../build-emoji-release.ts";

const TABLES = Object.freeze({
  imports: "fanmark_emoji_master_release_imports",
  staging: "fanmark_emoji_master_release_staging",
  active: "fanmark_emoji_master_active_release",
  activations: "fanmark_emoji_master_release_activations",
});

const VERSION_RE = /^[0-9a-f]{64}$/;
const STAGED_SELECT = `
  SELECT release_version, ordinal, id, emoji, short_name, keywords_json,
         category, subcategory, codepoints_json, sort_order
  FROM ${TABLES.staging}
  WHERE release_version = ?
  ORDER BY ordinal
`;

export class EmojiMasterReleaseActivationError extends Error {
  constructor(code) {
    super(code);
    this.name = "EmojiMasterReleaseActivationError";
    this.code = code;
  }
}

function fail(code) {
  return new EmojiMasterReleaseActivationError(code);
}

function rowsOf(result) {
  if (!result || result.success !== true || !Array.isArray(result.results)) {
    throw fail("d1_read_failed");
  }
  return result.results;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseJsonStringArray(value, code) {
  if (typeof value !== "string") throw fail(code);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw fail(code);
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) throw fail(code);
  return parsed;
}

function mapStagedRows(rows) {
  return rows.map((row, index) => {
    if (
      row.ordinal !== index + 1 ||
      typeof row.id !== "string" ||
      typeof row.emoji !== "string" ||
      typeof row.short_name !== "string" ||
      !(row.category === null || typeof row.category === "string") ||
      !(row.subcategory === null || typeof row.subcategory === "string") ||
      !(row.sort_order === null || Number.isSafeInteger(row.sort_order))
    ) {
      throw fail("staging_readback_mismatch");
    }
    return {
      id: row.id,
      emoji: row.emoji,
      short_name: row.short_name,
      keywords: parseJsonStringArray(row.keywords_json, "staging_readback_mismatch"),
      category: row.category,
      subcategory: row.subcategory,
      codepoints: parseJsonStringArray(row.codepoints_json, "staging_readback_mismatch"),
      sort_order: row.sort_order,
    };
  });
}

async function readRows(database, sql, bindings = []) {
  let statement;
  try {
    statement = database.prepare(sql);
    if (bindings.length) statement = statement.bind(...bindings);
  } catch {
    throw fail("d1_schema_unavailable");
  }
  try {
    return rowsOf(await statement.all());
  } catch (error) {
    if (error instanceof EmojiMasterReleaseActivationError) throw error;
    throw fail("d1_read_failed");
  }
}

async function readFirst(database, sql, bindings = []) {
  try {
    let statement = database.prepare(sql);
    if (bindings.length) statement = statement.bind(...bindings);
    const result = await statement.first();
    return result ?? null;
  } catch {
    throw fail("d1_schema_unavailable");
  }
}

async function verifyStoredRelease(database, version, expectedArtifact) {
  if (!VERSION_RE.test(version)) throw fail("invalid_release_version");
  const metadata = await readFirst(database, `
    SELECT release_version, manifest_json, row_count, status
    FROM ${TABLES.imports}
    WHERE release_version = ?
  `, [version]);
  if (!metadata || metadata.status !== "ready" || metadata.release_version !== version) {
    throw fail("release_not_ready");
  }
  if (!Number.isSafeInteger(metadata.row_count) || metadata.row_count < 1) {
    throw fail("staging_readback_mismatch");
  }

  const rows = await readRows(database, STAGED_SELECT, [version]);
  if (rows.length !== metadata.row_count || rows.some((row) => row.release_version !== version)) {
    throw fail("staging_readback_mismatch");
  }
  const records = mapStagedRows(rows);
  let rebuilt;
  try {
    rebuilt = createEmojiReleaseArtifacts(records);
  } catch {
    throw fail("staging_readback_mismatch");
  }
  let storedManifest;
  try {
    storedManifest = JSON.parse(metadata.manifest_json);
  } catch {
    throw fail("staging_readback_mismatch");
  }
  if (
    rebuilt.version !== version ||
    canonical(storedManifest) !== canonical(rebuilt.manifest) ||
    (expectedArtifact && canonical(records) !== canonical(expectedArtifact.records))
  ) {
    throw fail("staging_readback_mismatch");
  }
  return { records, manifest: rebuilt.manifest, rowCount: rows.length };
}

function assertIdentityContinuity(previousRecords, nextRecords) {
  const nextById = new Map(nextRecords.map((record) => [record.id, record]));
  for (const previous of previousRecords) {
    const next = nextById.get(previous.id);
    if (!next || next.emoji !== previous.emoji || canonical(next.codepoints) !== canonical(previous.codepoints)) {
      throw fail("release_identity_break");
    }
  }
}

async function assertActivationSchema(database) {
  await readFirst(database, `
    SELECT singleton_id, release_version, previous_release_version, activation_id,
           action, generation, updated_at
    FROM ${TABLES.active}
    WHERE singleton_id = 1
  `);
  await readFirst(database, `
    SELECT activation_id FROM ${TABLES.activations} LIMIT 1
  `);
}

export async function activateEmojiMasterRelease({
  database,
  releaseDirectory,
  action = "promotion",
  expectedCurrentVersion,
}) {
  if (!database || typeof database.prepare !== "function") throw fail("invalid_d1_database");
  if (action !== "promotion" && action !== "rollback") throw fail("invalid_activation_action");
  if (expectedCurrentVersion !== undefined && expectedCurrentVersion !== null &&
      !VERSION_RE.test(expectedCurrentVersion)) throw fail("invalid_expected_active_version");

  let verified;
  try {
    verified = await verifyRelease(releaseDirectory);
  } catch {
    throw fail("release_artifact_invalid");
  }
  if (!VERSION_RE.test(verified.version)) throw fail("invalid_release_version");
  await assertActivationSchema(database);

  const candidate = await verifyStoredRelease(database, verified.version, verified);
  const active = await readFirst(database, `
    SELECT release_version, previous_release_version, generation
    FROM ${TABLES.active}
    WHERE singleton_id = 1
  `);
  const activeVersion = active?.release_version ?? null;
  if (expectedCurrentVersion !== undefined && activeVersion !== expectedCurrentVersion) {
    throw fail("activation_state_conflict");
  }
  if (activeVersion === verified.version) {
    if (action === "rollback") throw fail("rollback_target_is_active");
    return {
      version: verified.version,
      previousVersion: active.previous_release_version ?? null,
      generation: active.generation,
      changed: false,
    };
  }

  if (action === "rollback") {
    const priorActivation = await readFirst(database, `
      SELECT activation_id FROM ${TABLES.activations}
      WHERE to_version = ?
      LIMIT 1
    `, [verified.version]);
    if (!priorActivation) throw fail("rollback_target_unknown");
  }

  if (activeVersion) {
    if (!Number.isSafeInteger(active.generation) || active.generation < 1) {
      throw fail("active_pointer_invalid");
    }
    const activeRelease = await verifyStoredRelease(database, activeVersion);
    assertIdentityContinuity(activeRelease.records, candidate.records);
  } else if (action === "rollback") {
    throw fail("rollback_target_unknown");
  }

  const activationId = randomUUID();
  const nextGeneration = active ? active.generation + 1 : 1;
  let result;
  try {
    if (active) {
      result = await database.prepare(`
        UPDATE ${TABLES.active}
        SET release_version = ?, previous_release_version = ?, activation_id = ?,
            action = ?, generation = ?, updated_at = CURRENT_TIMESTAMP
        WHERE singleton_id = 1 AND release_version = ? AND generation = ?
      `).bind(
        verified.version,
        activeVersion,
        activationId,
        action,
        nextGeneration,
        activeVersion,
        active.generation,
      ).run();
    } else {
      result = await database.prepare(`
        INSERT INTO ${TABLES.active}
          (singleton_id, release_version, previous_release_version, activation_id, action, generation)
        SELECT 1, ?, NULL, ?, 'promotion', 1
        WHERE NOT EXISTS (
          SELECT 1 FROM ${TABLES.active} WHERE singleton_id = 1
        )
      `).bind(verified.version, activationId).run();
    }
  } catch {
    throw fail("activation_write_failed");
  }
  if (
    result?.success !== true ||
    typeof result.meta?.changes !== "number" ||
    result.meta.changes < 1
  ) throw fail("activation_conflict");

  const readback = await readFirst(database, `
    SELECT release_version, previous_release_version, generation, activation_id, action
    FROM ${TABLES.active}
    WHERE singleton_id = 1
  `);
  if (
    readback?.release_version !== verified.version ||
    readback.previous_release_version !== activeVersion ||
    readback.generation !== nextGeneration ||
    readback.activation_id !== activationId ||
    readback.action !== action
  ) {
    throw fail("activation_readback_mismatch");
  }

  const event = await readFirst(database, `
    SELECT activation_id, generation, action, from_version, to_version
    FROM ${TABLES.activations}
    WHERE activation_id = ?
  `, [activationId]);
  if (
    event?.activation_id !== activationId ||
    event.generation !== nextGeneration ||
    event.action !== action ||
    event.from_version !== activeVersion ||
    event.to_version !== verified.version
  ) {
    throw fail("activation_audit_mismatch");
  }

  return { version: verified.version, previousVersion: activeVersion, generation: nextGeneration, changed: true };
}

export async function readEmojiMasterActiveRelease(database) {
  if (!database || typeof database.prepare !== "function") throw fail("invalid_d1_database");
  await assertActivationSchema(database);
  const active = await readFirst(database, `
    SELECT release_version, generation, updated_at
    FROM ${TABLES.active}
    WHERE singleton_id = 1
  `);
  if (!active) return null;
  if (!VERSION_RE.test(active.release_version) || !Number.isSafeInteger(active.generation) || active.generation < 1) {
    throw fail("active_pointer_invalid");
  }
  const release = await verifyStoredRelease(database, active.release_version);
  return {
    version: active.release_version,
    generation: active.generation,
    updatedAt: active.updated_at,
    records: release.records,
    manifest: release.manifest,
  };
}
