import assert from 'node:assert/strict';
import test from 'node:test';
import {readLiveProductionConfigs,validateLiveProductionConfigs} from './check-production-live-config.mjs';

test('accepted live configuration retains the V3 stores, scoped routes and scheduled jobs',()=>{
  assert.equal(validateLiveProductionConfigs(readLiveProductionConfigs()).acceptedV3Configuration,true);
});
for(const [name,change] of [
  ['old schema backup',c=>{const pins=JSON.parse(c.app.vars.STAGING_BACKUP_SCHEMA_HASHES);pins.business='0'.repeat(64);c.app.vars.STAGING_BACKUP_SCHEMA_HASHES=JSON.stringify(pins);}],
  ['wrong database',c=>{c.app.d1_databases[0].database_id='wrong-database';}],
  ['wrong coordinator namespace',c=>{c.app.durable_objects.bindings[0].class_name='NotificationWakeCoordinatorProductionV2';}],
  ['missing backup trigger',c=>{c.backup.triggers.crons=[];}],
  ['closed public runtime',c=>{c.app.vars.CUTOVER_WRITE_FREEZE='receipt_only';}],
  ['temporary owner access',c=>{c.app.vars.PRODUCTION_OWNER_ACCEPTANCE_BACKEND='owner-browser-v1';}],
  ['unscoped public route',c=>{c.app.routes[0].pattern='*.fanmark.id/*';}],
  ['preview exposure',c=>{c.app.preview_urls=true;}],
  ['alias database capability',c=>{c.alias.d1_databases=c.app.d1_databases;}],
  ['plaintext secret',c=>{c.app.vars.RESEND_API_KEY='fixture';}],
  ['lost persisted diagnostics',c=>{c.app.observability.logs.persist=false;}],
  ['URL-bearing invocation logs',c=>{c.app.observability.logs.invocation_logs=true;}],
  ['unredacted request queries',c=>{c.app.observability.redact_query_string=false;}],
  ['unreviewed trace collection',c=>{c.app.observability.traces.enabled=true;}],
])test('live configuration refuses '+name,()=>{
  const configs=readLiveProductionConfigs();change(configs);assert.throws(()=>validateLiveProductionConfigs(configs));
});
