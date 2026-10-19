import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {readClosedProductionConfigs,readProductionBackupPins,validateClosedProductionConfigs} from './production-runtime-config.mjs';
const resources=JSON.parse(readFileSync(new URL('../../docs/migration/production-resources.json',import.meta.url),'utf8'));
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
