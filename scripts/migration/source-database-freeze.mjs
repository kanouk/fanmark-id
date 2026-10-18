/** Render a bounded source DB freeze and its exact inverse; never connects to DB.
 * Edge/provider effects, cron, DDL/deployment controls and Storage bytes must be
 * stopped/drained separately. This is only the SQL write boundary.
 */
import { createHash } from 'node:crypto';
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/u;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
export const SOURCE_FREEZE_INVENTORY_SQL = `SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,c.relispartition AS partition,
pg_has_role(current_user,c.relowner,'USAGE') AS owner_role_available,
has_table_privilege(current_user,c.oid,'TRIGGER') AS trigger_privilege
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','f')
ORDER BY n.nspname,c.relname`;
const quote = name => '"' + name + '"';
const literal = text => "'" + text.replaceAll("'", "''") + "'";
const EXCLUDED = new Set(['auth.schema_migrations','storage.migrations','storage.buckets_vectors','storage.vector_indexes']);
const hash = value => createHash('sha256').update(value).digest('hex');

export function renderSourceDatabaseFreeze({ projectRef, runId, relations }) {
  if (projectRef !== 'ppqgtbjykitqtiaisyji' || !UUID.test(runId ?? '') || !Array.isArray(relations) || relations.length === 0 || relations.length > 300) throw Error('source_freeze_identity_invalid');
  const sorted = relations.map(row => {
    if (!row || !['public','auth','storage'].includes(row.schema) || !IDENT.test(row.name ?? '') || row.kind !== 'r' || row.partition !== false || typeof row.owner_role_available !== 'boolean' || typeof row.trigger_privilege !== 'boolean') throw Error('source_freeze_relation_unsupported');
    if (!row.trigger_privilege && !EXCLUDED.has(row.schema + '.' + row.name)) throw Error('source_freeze_trigger_privilege_missing');
    return { schema: row.schema, name: row.name, kind: 'r', partition: false, owner_role_available: row.owner_role_available, trigger_privilege: row.trigger_privilege };
  }).sort((a,b) => (a.schema + '.' + a.name) < (b.schema + '.' + b.name) ? -1 : 1);
  if (new Set(sorted.map(r => r.schema + '.' + r.name)).size !== sorted.length ||
      !['public','auth','storage'].every(schema => sorted.some(row => row.schema === schema))) throw Error('source_freeze_relation_inventory_invalid');
  const scope = 'fanmark_cutover_' + runId.replaceAll('-', '');
  const protectedRelations = sorted.filter(row => row.trigger_privilege);
  const qualified = protectedRelations.map(row => `${quote(row.schema)}.${quote(row.name)}`);
  const relationJson = JSON.stringify(sorted);
  const inventoryAssert = `DO $check$ BEGIN
  IF (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.schema,r.name),'[]'::jsonb) FROM (${SOURCE_FREEZE_INVENTORY_SQL}) r)
      <> ${literal(relationJson)}::jsonb THEN RAISE EXCEPTION 'source_freeze_inventory_changed'; END IF;
END $check$;`;
  const lock = `LOCK TABLE ${qualified.join(',')} IN ACCESS EXCLUSIVE MODE;`;
  const replicationCheck = `DO $replica$ BEGIN
    IF current_setting('session_replication_role') <> 'origin' OR EXISTS(
      SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_storage_admin')
      AND (rolsuper OR has_parameter_privilege(oid,'session_replication_role','SET')))
      THEN RAISE EXCEPTION 'source_freeze_replication_control_required'; END IF;
  END $replica$;`;
  const start = `BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='30s';\n${replicationCheck}\n${inventoryAssert}\n${lock}\n${inventoryAssert}\n`;
  const excluded = sorted.filter(row => !row.trigger_privilege).map(row => row.schema + '.' + row.name);
  // Nonempty vector storage is not part of the reviewed avatars/covers copy.
  const vectorCheck = excluded.filter(name => name.startsWith('storage.') && name !== 'storage.migrations').map(name =>
    `DO $vector$ BEGIN IF EXISTS(SELECT 1 FROM ${name}) THEN RAISE EXCEPTION 'source_freeze_vector_data_unreviewed'; END IF; END $vector$;`).join('\n');
  const guard = `${quote(scope)}."reject_write"`;
  const functionBody = "BEGIN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='fanmark_source_write_frozen'; END";
  const trigger = 'fanmark_cutover_block';
  const freezeSql = start + vectorCheck + '\n' + `CREATE SCHEMA ${quote(scope)};\nREVOKE ALL ON SCHEMA ${quote(scope)} FROM PUBLIC;\n` +
    `CREATE FUNCTION ${guard}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS ${literal(functionBody)};\n` +
    `REVOKE ALL ON FUNCTION ${guard}() FROM PUBLIC;\n` +
    qualified.map((table,index) => `CREATE TRIGGER ${quote(trigger)} BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ${guard}();` +
      (protectedRelations[index].owner_role_available ? `\nALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${quote(trigger)};` : '')).join('\n') + '\nCOMMIT;\n';
  // tgtype=62: statement BEFORE + INSERT/DELETE/UPDATE/TRUNCATE. Require the
  // exact function body and run-specific namespace before dropping anything.
  const verifySql = `DO $verify$ DECLARE actual_count integer; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname=${literal(scope)} AND p.proname='reject_write' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
      AND p.prosrc=${literal(functionBody)} AND l.lanname='plpgsql' AND NOT p.prosecdef
      AND p.proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'source_freeze_function_mismatch'; END IF;
  SELECT count(*) INTO actual_count FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=${literal(scope)};
  IF actual_count <> ${protectedRelations.length} THEN RAISE EXCEPTION 'source_freeze_trigger_count_mismatch'; END IF;
${protectedRelations.map(row => `  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE t.tgrelid=${literal(quote(row.schema) + '.' + quote(row.name))}::regclass AND t.tgname=${literal(trigger)}
      AND t.tgenabled=${literal(row.owner_role_available ? 'A' : 'O')} AND t.tgtype=62 AND t.tgnargs=0 AND t.tgqual IS NULL AND NOT t.tgisinternal
      AND n.nspname=${literal(scope)} AND p.proname='reject_write') THEN RAISE EXCEPTION 'source_freeze_trigger_mismatch'; END IF;`).join('\n')}
  IF EXISTS(SELECT 1 FROM pg_depend d WHERE d.refclassid='pg_proc'::regclass
    AND d.refobjid=${literal(guard + '()')}::regprocedure
    AND (d.classid<>'pg_trigger'::regclass OR d.deptype<>'n')) THEN RAISE EXCEPTION 'source_freeze_extra_dependency'; END IF;
END $verify$;`;
  // Managed auth/storage relations permit CREATE TRIGGER but not ALTER/DROP
  // TRIGGER by postgres. Drop only our run-specific function after inspecting
  // every dependent trigger, using the documented Supabase inverse.
  const resumeSql = start + verifySql + `\nDROP FUNCTION ${guard}() CASCADE;\nDROP SCHEMA ${quote(scope)};\nCOMMIT;\n`;
  return Object.freeze({ projectRef, runId, relationCount: sorted.length, protectedRelationCount: protectedRelations.length, excludedRelations: excluded,
    requiresOriginReplicationRole: protectedRelations.some(row => !row.owner_role_available), inventorySha256: hash(relationJson),
    freezeSql, verifySql: replicationCheck + '\n' + inventoryAssert + '\n' + verifySql, resumeSql,
    freezeSha256: hash(freezeSql), resumeSha256: hash(resumeSql), productionReady: false });
}
