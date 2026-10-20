import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {readClosedProductionConfigs,readProductionBackupPins,validateClosedProductionConfigs} from './production-runtime-config.mjs';
import {Miniflare} from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import {businessMigrationStatements} from './business-runtime-import-schema.mjs';
import {AUTH_RECOVERY_SCHEMA_SQL,authRecoveryDigest} from '../../workers/api/src/auth-d1-recovery.ts';
import {D1_RECOVERY_SCHEMA_SQL} from '../../workers/api/src/d1-store-recovery.ts';
const resources=JSON.parse(readFileSync(new URL('../../docs/migration/production-resources.json',import.meta.url),'utf8'));
test('Auth backup pin uses the Auth recovery profile and excludes the provider migration ledger',async()=>{
 const mf=new Miniflare({workers:[{config:{name:'auth-backup-profile-pin',type:'worker',compatibilityDate:'2026-09-18',env:{DB:{type:'d1',name:'auth-profile-pin'}},manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response(null)}}'}}}}}]});
 try{
  const db=await mf.getD1Database('DB');
  for(const name of ['0003_better_auth_core.sql','0007_auth_signup_command.sql','0008_auth_user_suspension.sql','0009_auth_oauth_signup.sql'])await db.batch(businessMigrationStatements(readFileSync(new URL('../../workers/api/migrations/'+name,import.meta.url),'utf8')).map(sql=>db.prepare(sql)));
  const before=await authRecoveryDigest((await db.prepare(AUTH_RECOVERY_SCHEMA_SQL).all()).results);
  await db.prepare('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT)').run();
  const after=await authRecoveryDigest((await db.prepare(AUTH_RECOVERY_SCHEMA_SQL).all()).results),generic=await authRecoveryDigest((await db.prepare(D1_RECOVERY_SCHEMA_SQL).all()).results);
  assert.equal(after,before);assert.equal(readProductionBackupPins().schemaHashes.auth,after);assert.notEqual(generic,after);
 }finally{await mf.dispose();}
});
test('production closed candidate pins every store and keeps public entrypoints and background work closed',()=>{
 const result=validateClosedProductionConfigs(readClosedProductionConfigs(),resources);
 assert.equal(result.closedCandidateValidated,true);assert.equal(result.productionReady,false);
});
test('production backup pins allow inspection while capture, schedules and public access remain closed',()=>{
 const configs=readClosedProductionConfigs(),pins=readProductionBackupPins();
 const report=validateClosedProductionConfigs(configs,resources,pins);
 assert.equal(report.backupPinsPhase,'baseline-before-import');
 assert.equal(configs.app.vars.STAGING_BACKUP_ADMISSION,'pending');
 assert.equal(configs.scheduler.vars.STAGING_BACKUP_SCHEDULE,'disabled');
 assert.equal(configs.monitor.vars.STAGING_BACKUP_MONITOR,'disabled');
 assert.equal(configs.app.vars.STAGING_BACKUP_KEY_ID,pins.keyId);
 assert.deepEqual(JSON.parse(configs.monitor.vars.STAGING_BACKUP_SCHEMA_HASHES),pins.schemaHashes);
 for(const mutate of [p=>p.scopeDigest='a'.repeat(64),p=>p.keyId='staging-backup-00000000-0000-4000-8000-000000000000',
  p=>p.phase='ready',p=>p.schemaHashes.auth='bad',p=>p.schemaHashes.extra='b'.repeat(64)]){
  const changed=structuredClone(pins);mutate(changed);
  assert.throws(()=>validateClosedProductionConfigs(configs,resources,changed),/production_config_backup_pins_invalid/);
 }
 for(const mutate of [c=>c.app.vars.STAGING_BACKUP_KEY_ID='production-backup-00000000-0000-4000-8000-000000000000',
  c=>c.app.vars.STAGING_BACKUP_SCHEMA_HASHES=JSON.stringify({...pins.schemaHashes,auth:'a'.repeat(64)}),
  c=>c.monitor.vars.STAGING_BACKUP_SCHEMA_HASHES='{}',c=>c.app.vars.STAGING_BACKUP_ALERT_TO='unreviewed@example.invalid']){
  const changed=structuredClone(configs);mutate(changed);
  assert.throws(()=>validateClosedProductionConfigs(changed,resources,pins),/production_config_/);
 }
});
test('cross-environment bindings, open routes, new Cron, legacy fallbacks and privileged monitor capabilities fail',()=>{
 for(const mutate of [
  c=>c.app.d1_databases[0].database_id='other-db',c=>c.app.r2_buckets[0].bucket_name='staging-bucket',
  c=>c.app.durable_objects.bindings[0].script_name='fanmark-app-staging',c=>c.app.workers_dev=true,
  c=>c.app.routes=[{pattern:'fanmark.id',custom_domain:true}],c=>c.scheduler.triggers.crons=['5 0 * * *'],
  c=>c.app.vars.CUTOVER_WRITE_FREEZE='false',c=>c.app.vars.SUPABASE_URL='https://source.example.invalid',
  c=>c.app.vars.STRIPE_DISPATCH_BACKEND='d1',c=>c.monitor.services[0].entrypoint='ProductionBackupService',
  c=>c.monitor.vars.STAGING_BACKUP_KEY='fixture',c=>c.monitor.d1_databases=[],
  c=>c.app.ratelimits[0].namespace_id='41092701',c=>c.app.vars.STAGING_BACKUP_ADMISSION='writers-verified-v1',
 ]) {const configs=readClosedProductionConfigs();mutate(configs);assert.throws(()=>validateClosedProductionConfigs(configs,resources),/production_config_/);}
});
