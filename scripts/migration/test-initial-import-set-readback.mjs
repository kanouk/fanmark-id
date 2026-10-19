import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { prepareCurrentCatalogSyntheticSnapshot } from './test-d1-import-current-schema.mjs';
import { applyBusinessRuntimeMigrations, businessMigrationStatements } from './business-runtime-import-schema.mjs';
import { MASTER_RUNTIME_MIGRATIONS } from './master-runtime-schema.mjs';
import { projectSupabaseAuth } from './supabase-auth-projection.mjs';
import { createEmojiReleaseArtifacts } from '../build-emoji-release.ts';
import { prepareInitialImportSet, verifyInitialImportSet, rehearseInitialImportSet, executeInitialImportSet } from './initial-import-set-readback.mjs';
import { LOCAL_R2_IMPORT_WORKER, createLocalR2ImportTransport } from './local-r2-import-transport.mjs';
import { objectIdentityHash } from './storage-export.mjs';
import { sha256Hex } from './snapshot-format.mjs';
import { PRODUCTION_D1_TARGETS, createProductionRemoteD1, isReadOnlyProductionSql } from './production-remote-d1.mjs';
import { PRODUCTION_R2_TARGETS } from './production-r2-targets.mjs';
import { createProductionRemoteR2 } from './production-remote-r2.mjs';
import { createProductionImportCoordinator } from './production-import-coordinator-client.mjs';
import { createNativeProductionSetFixture } from './test-initial-import-production-fixture.mjs';
import { syntheticStripeReceiptExport } from './test-stripe-receipt-transfer-fixture.mjs';
import { PRODUCTION_RUNTIME, PRODUCTION_STORE_IDS } from '../../workers/api/src/production-runtime-identity.ts';


const time = '2026-10-19T00:00:00.000Z';
test('one native five-store readback binds the actual 40-table export, Master projection, Auth and split images', { timeout: 300000 }, async t => {
 const root = await mkdtemp(join(tmpdir(), 'fanmark-import-set-'));
 const mf = new Miniflare({ workers: [{ config: { name: 'initial-set', type: 'worker', compatibilityDate: '2026-09-18',
  env: { AUTH: { type: 'd1', name: 'set-auth' }, MASTER: { type: 'd1', name: 'set-master' }, BUSINESS: { type: 'd1', name: 'set-business' },
   AVATARS_BUCKET: { type: 'r2', name: 'set-avatars' }, COVER_IMAGES_BUCKET: { type: 'r2', name: 'set-covers' } },
  manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: LOCAL_R2_IMPORT_WORKER } } } },
  dev: { outboundService: { type: 'fetcher', handler() { throw Error('external_network_forbidden'); } } } }] });
 t.after(async () => { await mf.dispose(); await rm(root, { recursive: true, force: true }); });
 const fixture = await prepareCurrentCatalogSyntheticSnapshot(fileURLToPath(new URL('./fixtures/business-import-structure.json', import.meta.url)), {
  snapshotDirectory: join(root, 'business'), includeAuxiliary: true, fullTableCoverage: true,
  mutateSyntheticRows(rows) { rows.user_roles[0].values.role = 'admin'; rows.user_settings[0].values.plan_type = 'admin'; },
 });
 const uid = fixture.syntheticAuthUserId;
 const authProjection = await projectSupabaseAuth({ version: 1, observedAt: time,
  users: [{ id: uid, email: 'set@example.invalid', encrypted_password: '$2b$10$' + 'a'.repeat(53), email_confirmed_at: time,
   banned_until: null, is_anonymous: false, is_sso_user: false, is_super_admin: null, deleted_at: null, created_at: time, updated_at: time }], identities: [],
  factors: [{ id: 'cccccccc-1111-4111-8111-111111111111', user_id: uid, factor_type: 'totp', status: 'verified', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }],
  settings: [{ user_id: uid, display_name: fixture.rows.user_settings[0].values.display_name, plan_type: 'admin' }], roles: [{ user_id: uid, role: 'admin' }],
 }, { encrypt: async value => 'SYNTHETIC_CIPHER:' + value });
 const emojiRows = fixture.rows.emoji_master.map(({ values: v }) => ({ id: v.id, emoji: v.emoji, short_name: v.short_name,
  keywords: JSON.parse(v.keywords), category: v.category, subcategory: v.subcategory, codepoints: JSON.parse(v.codepoints), sort_order: Number(v.sort_order) }));
 const approvedEmojiIdentity = createEmojiReleaseArtifacts(emojiRows).manifest.identitySHA256;
 const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8'));
 const storageExportDir = join(root, 'images'); await mkdir(join(storageExportDir, 'objects'), { recursive: true, mode: 0o700 });
 const objects = [];
 for (const bucket of ['avatars', 'cover-images']) {
  const key = `${uid}/${bucket === 'avatars' ? 'avatar' : 'cover'}.png`, bytes = Buffer.from('synthetic-' + bucket);
  const localFile = 'objects/' + objectIdentityHash(bucket, key); await writeFile(join(storageExportDir, localFile), bytes, { mode: 0o600 });
  objects.push({ bucket, key, size: bytes.length, contentSHA256: sha256Hex(bytes), metadata: { mimetype: 'image/png' }, localFile });
 }
 const names = ['avatars', 'cover-images'], inventory = { stable: true, beforeSHA256: sha256Hex('fixture'), afterSHA256: sha256Hex('fixture') };
 await writeFile(join(storageExportDir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, complete: true, generatedAt: time, buckets: names, objectCount: 2, inventory, objects }), { mode: 0o600 });
 await writeFile(join(storageExportDir, 'export.status.json'), JSON.stringify({ schemaVersion: 1, status: 'complete', startedAt: time, buckets: names, objectCount: 2, inventory }), { mode: 0o600 });
 const incarnations = Object.fromEntries(['auth', 'master', 'business', 'avatars', 'covers'].map(store => [store, randomUUID()]));
 const activationIds = { emoji: randomUUID(), reference: randomUUID() };
 const input = { manifestPath: fixture.manifestPath, storageExportDir, authProjection, approvedEmojiIdentity, runId: randomUUID(),
  incarnations, activationIds, businessDestinationId: PRODUCTION_D1_TARGETS.find(row => row.databaseName === 'fanmark-production-business').databaseId, expectedTargetProfile: fixture.expectedTargetProfile };
 input.stripeReceiptExport=await syntheticStripeReceiptExport(input.runId,0);
 const prepared = await prepareInitialImportSet(input);
 const databases = { auth: await mf.getD1Database('AUTH'), master: await mf.getD1Database('MASTER'), business: await mf.getD1Database('BUSINESS') };
 for (const [store, migrations] of Object.entries({ auth: ['0003_better_auth_core.sql', '0007_auth_signup_command.sql', '0008_auth_user_suspension.sql', '0009_auth_oauth_signup.sql'], master: MASTER_RUNTIME_MIGRATIONS })) {
  for (const name of migrations) await databases[store].batch(businessMigrationStatements(await readFile(new URL('../../workers/api/migrations/' + name, import.meta.url), 'utf8')).map(sql => databases[store].prepare(sql)));
 }
 await applyBusinessRuntimeMigrations(databases.business);
 const buckets = { avatars: await mf.getR2Bucket('AVATARS_BUCKET'), covers: await mf.getR2Bucket('COVER_IMAGES_BUCKET') };
 const loopbackBase = (await mf.ready).origin;
 const rehearsal = { prepared, databases, readDatabases: databases, readBuckets: buckets,
  buckets: Object.fromEntries(Object.entries(buckets).map(([store, bucket]) => [store, createLocalR2ImportTransport({ bucket, loopbackBase, bucketBinding: store === 'avatars' ? 'AVATARS_BUCKET' : 'COVER_IMAGES_BUCKET' })])),
  businessReportPath: join(root, 'business-report.json'), storageReportPath: join(storageExportDir, 'images-report.json') };
 await t.test('local orchestration stops after Auth and refuses an implicit retry', async () => {
  const first = await rehearseInitialImportSet({ ...rehearsal, stopAfter: 'auth' });
  assert.deepEqual(first.completedStages, ['auth']); assert.equal(first.readback, null);
  assert.equal(first.remoteExecutionSupported, false);
  assert.equal((await databases.master.prepare('SELECT count(*) AS n FROM emoji_master').all()).results[0].n, 0);
  assert.equal((await buckets.avatars.list()).objects.length, 0);
  await assert.rejects(rehearseInitialImportSet(rehearsal), /rehearsal_already_attempted/);
 });
 await t.test('resume checks completed contents before touching the next store', async () => {
  const candidate = await prepareInitialImportSet(input);
  await databases.auth.prepare('UPDATE account SET password=?').bind('SYNTHETIC_CHANGED').run();
  await assert.rejects(rehearseInitialImportSet({ ...rehearsal, prepared: candidate, resumeAfter: 'auth' }), /auth_import_readback_row_mismatch/);
  assert.equal((await databases.master.prepare('SELECT count(*) AS n FROM emoji_master').all()).results[0].n, 0);
  await databases.auth.prepare('UPDATE account SET password=?').bind(authProjection.tables.account[0].password).run();
 });
 await t.test('an uncertain Master write stops before Business and R2 and never retries', async () => {
  let calls = 0;
  const candidate = await prepareInitialImportSet(input);
  const failedMaster = { prepare: databases.master.prepare.bind(databases.master), batch: async () => { calls++; throw Error('private provider detail'); } };
  await assert.rejects(rehearseInitialImportSet({ ...rehearsal, prepared: candidate, resumeAfter: 'auth',
    databases: { ...databases, master: failedMaster } }), /^Error: initial_import_set_rehearsal_unconfirmed$/);
  assert.equal(calls, 1);
  assert.equal((await databases.business.prepare('SELECT count(*) AS n FROM user_settings').all()).results[0].n, 0);
  assert.equal((await buckets.avatars.list()).objects.length, 0);
  await assert.rejects(rehearseInitialImportSet({ ...rehearsal, prepared: candidate, resumeAfter: 'auth' }), /already_attempted/);
 });
 await t.test('reconstructed plan resumes completed Auth and runs the remaining native stores together', async () => {
  const candidate = await prepareInitialImportSet(input);
  assert.equal(candidate.identitySha256, prepared.identitySha256);
  const result = await rehearseInitialImportSet({ ...rehearsal, prepared: candidate, resumeAfter: 'auth' });
  assert.deepEqual(result.completedStages, ['auth', 'master', 'business', 'receipts', 'storage']);
  assert.deepEqual(result.verifiedBeforeResume, ['auth']);
  assert.equal(result.readback.allExpectedStoreContentsMatched, true);
  assert.equal(result.sourceFreezeVerified, false); assert.equal(result.productionReady, false);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_CIPHER|set@example|\$2b/);
 });
 await t.test('a fully completed prefix is reread with no write calls', async () => {
  let writes = 0;
  const deny = () => { writes++; throw Error('unexpected write'); };
  const readOnlyWriters = Object.fromEntries(Object.entries(databases).map(([store, db]) => [store,
    { prepare: db.prepare.bind(db), batch: deny }]));
  const result = await rehearseInitialImportSet({ ...rehearsal, prepared: await prepareInitialImportSet(input),
    databases: readOnlyWriters, buckets: { avatars: { put: deny }, covers: { put: deny } }, resumeAfter: 'storage' });
  assert.equal(writes, 0); assert.equal(result.readback.allExpectedStoreContentsMatched, true);
  assert.deepEqual(result.verifiedBeforeResume, ['auth', 'master', 'business', 'receipts', 'storage']);
  await assert.rejects(rehearseInitialImportSet({ ...rehearsal, mode: 'production-stage' }), /rehearsal_options_invalid/);
 });
 const options = { prepared, databases, buckets };
 await t.test('all content and real cross-DB Auth references match, without declaring source freeze or publication', async () => {
  const report = await verifyInitialImportSet(options);
  assert.equal(report.allExpectedStoreContentsMatched, true); assert.equal(report.business.tables.length, 40);
  assert.equal(report.storage.objectCount, 2); assert.equal(report.auth.totals.users, 1);
  assert.equal(report.productionReady, false); assert.equal(report.sourceFreezeVerified, false); assert.equal(report.coordinatorCompleted, false);
  assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC_CIPHER|set@example|90000000|\$2b/);
  // Detaching expectations prevents the caller replacing a credential later.
  const original = authProjection.tables.account[0].password; authProjection.tables.account[0].password = 'changed';
  assert.equal((await verifyInitialImportSet(options)).readbackSha256, report.readbackSha256); authProjection.tables.account[0].password = original;
 });
 await t.test('swapped stores, changed Auth, changed R2 content and false production transport reject', async () => {
  await assert.rejects(verifyInitialImportSet({ ...options, databases: { ...databases, master: databases.business } }));
  await assert.rejects(verifyInitialImportSet({ ...options, mode: 'production-stage', coordinator: {} }), /coordinator_invalid/);
  await databases.auth.prepare('UPDATE account SET password=?').bind('SYNTHETIC_CHANGED').run();
  await assert.rejects(verifyInitialImportSet(options), /auth_import_readback_row_mismatch/);
  await databases.auth.prepare('UPDATE account SET password=?').bind(authProjection.tables.account[0].password).run();
  const key = objects[0].key, old = await buckets.avatars.get(key), body = await old.arrayBuffer();
  await buckets.avatars.put(key, Buffer.alloc(body.byteLength, 88), { customMetadata: old.customMetadata, httpMetadata: old.httpMetadata });
  await assert.rejects(verifyInitialImportSet(options), /split_r2_import_readback_failed/);
  await buckets.avatars.put(key, body, { customMetadata: old.customMetadata, httpMetadata: old.httpMetadata });
 });
 await t.test('production read-only adapters pin all stores and reject control-plane or operation-history drift', async () => {
  // Control plane and coordinator are synthetic; D1 SQL and R2 bytes are native.
  // These ACK fixtures test readback only, not evidence of production import.
  const operations = new Map(), journalPaths = {}, allStores = ['auth','master','business','avatars','covers'];
  for (const store of allStores) {
   const targetId = PRODUCTION_D1_TARGETS.find(row => row.databaseName === 'fanmark-production-' + store)?.databaseId ?? PRODUCTION_R2_TARGETS.find(row => row.store === store).bucketName;
   const operation = { operationId: randomUUID(), batchSha256: sha256Hex(store), store }; operations.set(operation.operationId, operation);
   journalPaths[store] = join(root, store + '.jsonl');
   await writeFile(journalPaths[store], [
    { type: 'identity', format: 'fanmark-production-import-journal-v1', runId: input.runId, targetId, targetIncarnation: incarnations[store] },
    { type: 'intent', operationId: operation.operationId, batchSha256: operation.batchSha256 },
    { type: 'acknowledged', operationId: operation.operationId },
   ].map(row => JSON.stringify(row) + '\n').join(''), { mode: 0o600 });
  }
  const state = { owner: input.runId, manifestSha256: prepared.identitySha256,
   incarnationsSha256: sha256Hex(JSON.stringify(Object.entries(incarnations).sort())), pending: null, acknowledged: 5, readbackSha256: null };
  let historyMissing = false, drift = false, writes = 0;
  const coordinator = createProductionImportCoordinator({ owner: input.runId, manifestSha256: prepared.identitySha256, incarnations,
   command: async (action, args) => {
    assert.ok(['inspect','operation'].includes(action)); assert.equal(args.owner, input.runId);
    return { scope: PRODUCTION_RUNTIME.scope, active: 0, fenceOwner: input.runId, state: structuredClone(state),
     ...(action === 'operation' ? { operationId: args.operationId, pending: null, dispatched: null,
      acknowledged: historyMissing ? null : structuredClone(operations.get(args.operationId)) } : {}) };
   } });
  const version = randomUUID(), gatewayVersion = randomUUID(), origin = 'https://fanmark-prod-import-' + randomUUID() + '.fanmark-id.workers.dev';
  const runtimeBindings = [
   ...PRODUCTION_D1_TARGETS.map(row => ({ type: 'd1', name: { auth:'AUTH_DB',business:'FANMARK_DB',master:'MASTER_DB' }[row.databaseName.replace('fanmark-production-','')], id:row.databaseId })),
   ...PRODUCTION_R2_TARGETS.map(row => ({ type:'r2_bucket',name:row.store==='avatars'?'AVATARS_BUCKET':'COVER_IMAGES_BUCKET',bucket_name:row.bucketName })),
   ...Object.entries({ D1_TOPOLOGY:'split',EMOJI_PUBLICATION_BACKEND:'production-service',RECOVERY_DRAIN_SCOPE_DIGEST:PRODUCTION_RUNTIME.scope,
    RECOVERY_DRAIN_BACKEND:'durable-object',CUTOVER_WRITE_FREEZE:'receipt_only',STORAGE_BACKEND:'r2' }).map(([name,text])=>({name,type:'plain_text',text})),
  ];
  const metadata = object => ({ key:object.key,size:object.size,etag:object.etag,version:object.version,httpMetadata:object.httpMetadata??{},customMetadata:object.customMetadata??{} });
  const fetchImpl = async (url, options) => {
   assert.equal(options.redirect, 'error'); const u = new URL(url);
   if (u.hostname === 'api.cloudflare.com') {
    if (u.pathname.includes('/d1/database/')) {
     const target = PRODUCTION_D1_TARGETS.find(row => u.pathname.includes('/'+row.databaseId)); assert.ok(target);
     if (options.method === 'GET') return Response.json({success:true,result:{uuid:target.databaseId,name:target.databaseName,created_at:target.createdAt}});
     const batch = JSON.parse(options.body).batch;
     if (batch.some(row=>!isReadOnlyProductionSql(row.sql))) { writes++; throw Error('write_forbidden'); }
     const native = databases[target.databaseName.replace('fanmark-production-','')];
     return Response.json({success:true,result:await native.batch(batch.map(row=>native.prepare(row.sql).bind(...row.params)))});
    }
    assert.ok(options.method === undefined || options.method === 'GET');
    let result;
    if (u.pathname.includes('/r2/buckets/')) { const row=PRODUCTION_R2_TARGETS.find(row=>u.pathname.endsWith('/'+row.bucketName)); assert.ok(row);
     result={name:row.bucketName,creation_date:row.createdAt,storage_class:'Standard'};
    } else {
     const runtime=u.pathname.includes('/'+PRODUCTION_RUNTIME.worker+'/');
     assert.ok(runtime || u.pathname.includes('/'+new URL(origin).hostname.split('.')[0]+'/'));
     if (u.pathname.endsWith('/deployments')) result={deployments:[{versions:[{percentage:100,version_id:drift?randomUUID():runtime?version:gatewayVersion}]}]};
     else { assert.ok(u.pathname.endsWith('/settings')); result={bindings:runtime?runtimeBindings:[
      {name:'R2_IMPORT',type:'service',service:PRODUCTION_RUNTIME.worker,entrypoint:'ProductionR2ImportService'},
      {name:'EXPECTED_RUNTIME',text:version},{name:'GATE_ACCESS',text:'read-only'},{name:'EXPIRES_AT',text:String(Date.now()+600000)},
     ]}; }
    }
    return Response.json({success:true,result});
   }
   assert.equal(u.origin, origin); assert.ok(options.method === undefined || options.method === 'GET');
   if (u.pathname==='/r2/identity') return Response.json({runtimeVersion:version,scope:PRODUCTION_RUNTIME.scope,stores:PRODUCTION_STORE_IDS});
   const bucket=buckets[u.searchParams.get('store')]; assert.ok(bucket);
   if (u.pathname==='/r2/list') { const page=await bucket.list();return Response.json({objects:page.objects.map(metadata),truncated:page.truncated}); }
   assert.equal(u.pathname,'/r2/object'); const object=await bucket.get(u.searchParams.get('key'));
   if (!object) return new Response(null,{status:404});
   return new Response(await object.arrayBuffer(),{headers:{'x-fanmark-import-object':Buffer.from(JSON.stringify(metadata(object))).toString('base64'),'content-length':String(object.size)}});
  };
  const remoteDatabases=Object.fromEntries(PRODUCTION_D1_TARGETS.map(row=>{const store=row.databaseName.replace('fanmark-production-','');return [store,
   createProductionRemoteD1({target:{...row,targetIncarnation:incarnations[store]},token:'synthetic_token_only',fetchImpl})];}));
  const remoteBuckets=Object.fromEntries(PRODUCTION_R2_TARGETS.map(row=>[row.store,createProductionRemoteR2({target:{...row,targetIncarnation:incarnations[row.store]},
   runtimeVersion:version,gatewayVersion,gatewayOrigin:origin,bearer:'b'.repeat(64),token:'synthetic_token_only',fetchImpl})]));
  await assert.rejects(rehearseInitialImportSet({ ...rehearsal, prepared: await prepareInitialImportSet(input),
   readDatabases: remoteDatabases }), /rehearsal_transport_or_paths_invalid/);
  await assert.rejects(rehearseInitialImportSet({ ...rehearsal, prepared: await prepareInitialImportSet(input),
   buckets: remoteBuckets }), /rehearsal_transport_or_paths_invalid/);
  const remoteOptions={prepared,databases:remoteDatabases,buckets:remoteBuckets,mode:'production-stage',coordinator,journalPaths};
  const report=await verifyInitialImportSet(remoteOptions);
  assert.equal(report.consistency,'held-import-fence-readback');assert.equal(report.allExpectedStoreContentsMatched,true);assert.equal(writes,0);
  assert.equal(report.productionReady,false);assert.equal(report.sourceFreezeVerified,false);
  historyMissing=true;await assert.rejects(verifyInitialImportSet(remoteOptions),/inspection_unconfirmed/);historyMissing=false;
  drift=true;await assert.rejects(verifyInitialImportSet(remoteOptions),/transport_unconfirmed/);drift=false;
 });
 await t.test('different Auth/Business cohort and changed source files reject before any target read', async () => {
  const foreignName = structuredClone(authProjection); foreignName.tables.user[0].name = 'Different snapshot';
  await assert.rejects(prepareInitialImportSet({ ...input, authProjection: foreignName }), /auth_settings_mismatch/);
  const foreign = structuredClone(authProjection); foreign.tables.adminRole = [];
  await assert.rejects(prepareInitialImportSet({ ...input, authProjection: foreign }), /auth_settings_mismatch/);
  const file = join(root, 'business', manifest.tables[0].file), original = await readFile(file);
  await writeFile(file, Buffer.from('corrupt'));
  await assert.rejects(verifyInitialImportSet(options)); await writeFile(file, original);
  assert.equal((await verifyInitialImportSet(options)).allExpectedStoreContentsMatched, true);
 });
 await t.test('production entry runs native stores with a native executor, yields at Auth, then resumes and completes', async () => {
  const sourceEvidencePath=join(root,'synthetic-source-evidence.json'),evidence=Buffer.from('{"synthetic":true,"notProductionEvidence":true}');
  await writeFile(sourceEvidencePath,evidence,{mode:0o600});
  const productionInput={...input,runId:randomUUID(),sourceEvidenceSha256:sha256Hex(evidence)};
  productionInput.stripeReceiptExport=await syntheticStripeReceiptExport(productionInput.runId,2);
  const candidate=await prepareInitialImportSet(productionInput);
  const runtime=await createNativeProductionSetFixture({directory:join(root,'native-production-execution'),prepared:candidate,input:productionInput});
  try {
   const selected=Object.fromEntries(['coordinator','journalPaths','databases','readDatabases','buckets','readBuckets'].map(key=>[key,runtime[key]]));
   const args={...selected,prepared:candidate,sourceEvidencePath,businessReportPath:join(root,'production-business-report.json'),storageReportPath:join(storageExportDir,'production-storage-report.json')};
   // Evidence and transport substitutions reject before executor admission.
   await writeFile(sourceEvidencePath,Buffer.from('changed'),{mode:0o600});
   await assert.rejects(executeInitialImportSet({...args,stopAfter:'auth'}),/source_evidence_changed/);
   assert.equal((await runtime.coordinator.inspect()).executorId,null);assert.equal(runtime.counters.d1Writes,0);
   await writeFile(sourceEvidencePath,evidence,{mode:0o600});
   await assert.rejects(executeInitialImportSet({...args,databases:{...args.databases,auth:args.readDatabases.auth}}),/execution_transport_invalid/);
   const first=await executeInitialImportSet({...args,stopAfter:'auth'});
   assert.deepEqual(first.completedStages,['auth']);assert.equal(first.executorYielded,true);
   assert.equal((await runtime.coordinator.inspect()).executorId,null);assert.equal(runtime.counters.r2Writes,0);
   await runtime.coordinator.claim();
   const final=await executeInitialImportSet({...args,prepared:await prepareInitialImportSet(productionInput),resumeAfter:'auth'});
   assert.equal(final.readback.allExpectedStoreContentsMatched,true);assert.equal(final.coordinatorCompleted,true);assert.equal(final.readback.receipts.receiptCount,2);
   assert.equal(final.sourceFreezeVerified,false);assert.equal(final.productionReady,false);assert.equal(runtime.counters.r2Writes,2);
   const state=await runtime.coordinator.inspect();assert.equal(state.state.pending,null);assert.equal(state.fenceOwner,productionInput.runId);
   assert.equal(state.state.readbackSha256,final.readback.readbackSha256);
   const saved=JSON.parse(await readFile(final.executionReportPath,'utf8'));
   assert.equal(saved.report.readback.readbackSha256,state.state.readbackSha256);
   assert.equal(saved.executorId,state.executorId);
  }finally{await runtime.dispose();}
 });
 await t.test('committed Master response loss retains executor and journals and blocks a new process without further writes', async()=>{
  const evidence=Buffer.from('synthetic-only'),sourceEvidencePath=join(root,'synthetic-failure-evidence');await writeFile(sourceEvidencePath,evidence,{mode:0o600});
  const productionInput={...input,runId:randomUUID(),sourceEvidenceSha256:sha256Hex(evidence)};
  productionInput.stripeReceiptExport=await syntheticStripeReceiptExport(productionInput.runId,2);
  const candidate=await prepareInitialImportSet(productionInput),runtime=await createNativeProductionSetFixture({directory:join(root,'native-production-failure'),prepared:candidate,input:productionInput});
  try{
   const selected=Object.fromEntries(['coordinator','journalPaths','databases','readDatabases','buckets','readBuckets'].map(key=>[key,runtime[key]]));
   const args={...selected,prepared:candidate,sourceEvidencePath,businessReportPath:join(root,'failed-business-report.json'),storageReportPath:join(storageExportDir,'failed-storage-report.json')};
   runtime.counters.loseCommittedMaster=true;
   await assert.rejects(executeInitialImportSet(args),/execution_unconfirmed/);
   const before=await runtime.coordinator.inspect(),writes=runtime.counters.d1Writes;
   assert.ok(before.executorId);assert.equal(before.state.pending.store,'master');assert.equal(runtime.counters.r2Writes,0);
   assert.equal((await runtime.native.business.prepare('SELECT count(*) AS n FROM user_settings').all()).results[0].n,0);
   assert.ok((await runtime.native.master.prepare('SELECT count(*) AS n FROM emoji_master').all()).results[0].n>0);
   await assert.rejects(executeInitialImportSet({...args,prepared:await prepareInitialImportSet(productionInput),resumeAfter:'auth'}),/journals_unresolved/);
   assert.equal(runtime.counters.d1Writes,writes);assert.deepEqual(await runtime.coordinator.inspect(),before);
  }finally{await runtime.dispose();}
 });

 await t.test('receipt commit without acknowledgement retains the Business journal and never starts images',async()=>{
  const evidence=Buffer.from('synthetic receipt boundary'),sourceEvidencePath=join(root,'synthetic-receipt-evidence');await writeFile(sourceEvidencePath,evidence,{mode:0o600});
  const productionInput={...input,runId:randomUUID(),sourceEvidenceSha256:sha256Hex(evidence)};
  productionInput.stripeReceiptExport=await syntheticStripeReceiptExport(productionInput.runId,2);
  const missing=await prepareInitialImportSet({...productionInput,stripeReceiptExport:null});
  await assert.rejects(executeInitialImportSet({prepared:missing}),/stripe_receipt_export_required/);
  const candidate=await prepareInitialImportSet(productionInput),runtime=await createNativeProductionSetFixture({directory:join(root,'native-receipt-failure'),prepared:candidate,input:productionInput});
  try{
   const selected=Object.fromEntries(['coordinator','journalPaths','databases','readDatabases','buckets','readBuckets'].map(key=>[key,runtime[key]]));
   const args={...selected,prepared:candidate,sourceEvidencePath,businessReportPath:join(root,'receipt-failed-business-report.json'),storageReportPath:join(storageExportDir,'receipt-failed-storage-report.json')};
   runtime.counters.loseCommittedReceipts=true;
   await assert.rejects(executeInitialImportSet(args),/stripe_receipt_transfer_write_acknowledgement_unknown/);
   const state=await runtime.coordinator.inspect(),writes=runtime.counters.d1Writes;
   assert.ok(state.executorId);assert.equal(state.state.pending.store,'business');assert.equal(runtime.counters.r2Writes,0);
   assert.equal((await runtime.native.business.prepare('SELECT count(*) AS n FROM stripe_webhook_receipts').all()).results[0].n,2);
   assert.equal((await runtime.native.business.prepare('SELECT count(*) AS n FROM stripe_webhook_dispatches').all()).results[0].n,2);
   await assert.rejects(executeInitialImportSet({...args,prepared:await prepareInitialImportSet(productionInput),resumeAfter:'receipts'}),/journals_unresolved/);
   assert.equal(runtime.counters.d1Writes,writes);assert.deepEqual(await runtime.coordinator.inspect(),state);
  }finally{await runtime.dispose();}
 });

 await t.test('lost final completion response retains the exact fsynced readback and never replays imports', async()=>{
  const evidence=Buffer.from('synthetic completion evidence'),sourceEvidencePath=join(root,'synthetic-completion-evidence');await writeFile(sourceEvidencePath,evidence,{mode:0o600});
  const productionInput={...input,runId:randomUUID(),sourceEvidenceSha256:sha256Hex(evidence)};
  productionInput.stripeReceiptExport=await syntheticStripeReceiptExport(productionInput.runId,2);
  const candidate=await prepareInitialImportSet(productionInput),directory=join(root,'native-production-completion');
  const runtime=await createNativeProductionSetFixture({directory,prepared:candidate,input:productionInput});
  try{
   const selected=Object.fromEntries(['coordinator','journalPaths','databases','readDatabases','buckets','readBuckets'].map(key=>[key,runtime[key]]));
   const args={...selected,prepared:candidate,sourceEvidencePath,businessReportPath:join(root,'completion-business-report.json'),storageReportPath:join(storageExportDir,'completion-storage-report.json')};
   runtime.counters.loseComplete=true;
   await assert.rejects(executeInitialImportSet(args),/execution_unconfirmed/);
   const state=await runtime.coordinator.inspect(),writes={d1:runtime.counters.d1Writes,r2:runtime.counters.r2Writes};
   assert.equal(state.state.pending,null);assert.ok(state.state.readbackSha256);assert.equal(state.fenceOwner,productionInput.runId);
   const saved=JSON.parse(await readFile(join(directory,'initial-set-'+state.executorId+'.json'),'utf8'));
   assert.equal(saved.report.readback.readbackSha256,state.state.readbackSha256);
   assert.equal(saved.report.readback.allExpectedStoreContentsMatched,true);
   await assert.rejects(executeInitialImportSet({...args,prepared:await prepareInitialImportSet(productionInput),resumeAfter:'storage'}),/execution_unconfirmed/);
   assert.deepEqual({d1:runtime.counters.d1Writes,r2:runtime.counters.r2Writes},writes);
  }finally{await runtime.dispose();}
 });

});
