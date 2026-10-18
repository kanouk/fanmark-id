import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {readClosedProductionConfigs,validateClosedProductionConfigs} from './production-runtime-config.mjs';
const resources=JSON.parse(readFileSync(new URL('../../docs/migration/production-resources.json',import.meta.url),'utf8'));
test('production closed candidate pins every store and keeps public entrypoints and background work closed',()=>{
 const result=validateClosedProductionConfigs(readClosedProductionConfigs(),resources);
 assert.equal(result.closedCandidateValidated,true);assert.equal(result.productionReady,false);
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
