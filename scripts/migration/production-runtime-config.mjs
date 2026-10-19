/** Offline validator for the closed production candidate. This never authorizes public release. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PRODUCTION_RUNTIME,PRODUCTION_STORE_IDS} from '../../workers/api/src/production-runtime-identity.ts';
const fail=code=>{throw Error('production_config_'+code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=rows=>[...rows].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
const root=new URL('../../',import.meta.url);
export const readClosedProductionConfigs=()=>Object.fromEntries([
  ['app','app'],['scheduler','backup'],['monitor','backup-monitor'],
].map(([key,name])=>[key,JSON.parse(readFileSync(new URL(`workers/api/wrangler.${name}-production-closed.jsonc`,root),'utf8'))]));
export const readProductionBackupPins=()=>JSON.parse(readFileSync(new URL('docs/migration/production-backup-pins.json',root),'utf8'));
export function validateClosedProductionConfigs({app,scheduler,monitor},resources,backupPins=readProductionBackupPins()) {
  if(resources.accountId!==PRODUCTION_RUNTIME.accountId)fail('account');
  const mapping={AUTH_DB:'auth',FANMARK_DB:'business',MASTER_DB:'master'};
  if(resources.d1.length!==3||resources.d1.some(d=>PRODUCTION_STORE_IDS[mapping[d.binding]]!==d.id))fail('manifest_identity');
  for(const purpose of ['avatars','covers','backups'])if(resources.r2.filter(x=>x.purpose===purpose&&x.name===(purpose==='backups'?PRODUCTION_RUNTIME.backupBucket:PRODUCTION_STORE_IDS[purpose])).length!==1)fail('manifest_identity');
  const names={AUTH_DB:PRODUCTION_STORE_IDS.auth,AVATARS_BUCKET:PRODUCTION_STORE_IDS.avatars,COVER_IMAGES_BUCKET:PRODUCTION_STORE_IDS.covers,FANMARK_DB:PRODUCTION_STORE_IDS.business,MASTER_DB:PRODUCTION_STORE_IDS.master};
  const scope=createHash('sha256').update(JSON.stringify({account:resources.accountId,worker:PRODUCTION_RUNTIME.worker,
    stores:Object.entries(names).map(([binding,value])=>binding.endsWith('_DB')?{type:'d1',binding,id:value}:{type:'r2',binding,name:value})})).digest('hex');
  if(scope!==PRODUCTION_RUNTIME.scope)fail('scope');
  for(const [config,name] of [[app,'fanmark-app-production'],[scheduler,'fanmark-backup-production'],[monitor,'fanmark-backup-monitor-production']]) {
    if(config.account_id!==resources.accountId||config.name!==name)fail('worker_identity');
    if(config.workers_dev!==false||config.preview_urls!==false||config.routes?.length||config.triggers?.crons?.length!==0||config.env)fail('closed_boundary');
    if(config.vars.RECOVERY_DRAIN_SCOPE_DIGEST!==scope)fail('scope');
    for(const key of Object.keys(config.vars))if(/SECRET|TOKEN|PASSWORD|PRIVATE_KEY|^RESEND_API_KEY$|^STAGING_BACKUP_KEY$/.test(key))fail('plaintext_secret');
  }
  if(app.main!=='src/index.ts'||app.assets?.directory!=='../../dist-cloudflare-production'||app.assets?.binding!=='ASSETS'||
      !same(app.assets.run_worker_first,['/*']))fail('application_assets');
  if(!same(sorted(app.d1_databases.map(x=>({binding:x.binding,id:x.database_id,name:x.database_name}))),
    sorted(resources.d1.map(x=>({binding:x.binding,id:x.id,name:x.name})))))fail('database_bindings');
  const buckets=[{binding:'AVATARS_BUCKET',bucket_name:PRODUCTION_STORE_IDS.avatars},
    {binding:'COVER_IMAGES_BUCKET',bucket_name:PRODUCTION_STORE_IDS.covers},{binding:'STAGING_BACKUP_BUCKET',bucket_name:PRODUCTION_RUNTIME.backupBucket}];
  if(!same(sorted(app.r2_buckets),sorted(buckets)))fail('bucket_bindings');
  if(!same(app.durable_objects,{bindings:[{name:'NOTIFICATION_WAKE',class_name:'NotificationWakeCoordinatorProduction'},
    {name:'RECOVERY_DRAIN',class_name:'RecoveryWriterCoordinatorProduction'}]})||
    !same(app.migrations,[{tag:'production-coordinators-v1',new_sqlite_classes:['NotificationWakeCoordinatorProduction','RecoveryWriterCoordinatorProduction']}]))fail('coordinator_identity');
  const v=app.vars;
  for(const [key,value] of Object.entries({D1_TOPOLOGY:'split',AUTH_BACKEND:'better-auth',CUTOVER_WRITE_FREEZE:'receipt_only',
    BETTER_AUTH_URL:'https://fanmark.id',CORS_ALLOWED_ORIGINS:'https://fanmark.id',STORAGE_PUBLIC_BASE_URL:'https://fanmark.id',
    STORAGE_LEGACY_ORIGIN:'https://ppqgtbjykitqtiaisyji.supabase.co',EMOJI_PUBLICATION_BACKEND:'production-service',
    STAGING_NO_INDEX:'true',STAGING_BACKUP_ADMISSION:'pending',STAGING_BACKUP_ALERT_BACKEND:'disabled',
    STRIPE_MODE_POLICY:'',NOTIFICATION_WAKE_BACKEND:'durable-object',RECOVERY_DRAIN_BACKEND:'durable-object'}))if(v[key]!==value)fail('closed_variable_'+key);
  for(const key of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','LICENSE_EXPIRY_BACKEND','NOTIFICATION_ARCHIVE_BACKEND','STRIPE_DISPATCH_BACKEND'])if(key in v)fail('unexpected_writer_or_legacy');
  if(!same(JSON.parse(v.STAGING_BACKUP_SOURCE_IDS),PRODUCTION_STORE_IDS))fail('backup_sources');
  // Pins permit internal status/escrow inspection, not capture admission or release.
  // They describe the pre-import baseline; import-ledger DDL requires new readback.
  if(!backupPins||backupPins.format!=='fanmark-production-backup-pins-v1'||
    backupPins.scopeDigest!==scope||backupPins.phase!=='baseline-before-import'||
    !/^production-backup-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(backupPins.keyId??'')||
    !backupPins.schemaHashes||Object.keys(backupPins.schemaHashes).sort().join(',')!=='auth,business,master'||
    Object.values(backupPins.schemaHashes).some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x)))fail('backup_pins_invalid');
  if(v.STAGING_BACKUP_KEY_ID!==backupPins.keyId||
    !same(JSON.parse(v.STAGING_BACKUP_SCHEMA_HASHES),backupPins.schemaHashes)||v.STAGING_BACKUP_ALERT_TO!=='')fail('unreviewed_backup_activation');
  if(!same(app.ratelimits.map(x=>[x.name,x.namespace_id]),[['WAITLIST_SIGNUP_LIMITER','41092711'],['FANMARK_SEARCH_LIMITER','41092712'],['FANMARK_ACCESS_ANALYTICS_LIMITER','41092713']]))fail('ratelimit_identity');
  for(const [config,main,binding,entrypoint,selector] of [[scheduler,'src/production-backup-scheduler.ts','BACKUP_SERVICE','ProductionBackupService','STAGING_BACKUP_SCHEDULE'],
    [monitor,'src/production-backup-monitor.ts','BACKUP_ALERT_SERVICE','ProductionBackupAlertService','STAGING_BACKUP_MONITOR']]) {
    if(config.main!==main||config.vars[selector]!=='disabled'||config.d1_databases||config.durable_objects||
      !same(config.services,[{binding,service:PRODUCTION_RUNTIME.worker,entrypoint}]))fail('operational_capability');
  }
  if(scheduler.r2_buckets||!same(monitor.r2_buckets,[buckets[2]]))fail('monitor_bucket');
  for(const key of ['STAGING_BACKUP_SOURCE_IDS','STAGING_BACKUP_SCHEMA_HASHES','STAGING_BACKUP_KEY_ID'])if(monitor.vars[key]!==v[key])fail('monitor_identity');
  return {format:'fanmark-production-closed-config-v1',closedCandidateValidated:true,productionReady:false,
    worker:app.name,scope,publicRoutes:0,cronTriggers:0,
    backupPinsPhase:backupPins.phase,
    pending:['secret-bindings-and-escrow-readback','post-import-schema-hashes','backup-admission-and-recipient','independent-deployed-binding-readback','restore-and-operator-acceptance']};
}
