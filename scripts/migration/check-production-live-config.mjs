/** Offline check of the accepted V3 configuration. Never deploys or reads credentials. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=new URL('../../',import.meta.url);
const names=['app','backup','backup-monitor','alias'];
const read=closed=>Object.fromEntries(names.map(name=>[name,JSON.parse(readFileSync(new URL(`workers/api/wrangler.${name}-production${closed?'-closed':''}.jsonc`,root),'utf8'))]));
const canonical=value=>value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
const businessSchema='d5139f4ec4ffea556af9c20544178898114e4bdb7a582175021c05c69ba58d16';
export const readLiveProductionConfigs=()=>read(false);

export function validateLiveProductionConfigs(configs,closed=read(true)) {
  for(const name of names) {
    const expected=structuredClone(closed[name]);
    expected.routes=[];
    if(name!=='alias') {
      const pins=JSON.parse(expected.vars.STAGING_BACKUP_SCHEMA_HASHES);
      expected.vars.STAGING_BACKUP_SCHEMA_HASHES=JSON.stringify({...pins,business:businessSchema});
    }
    if(name==='app') {
      Object.assign(expected.vars,{CUTOVER_WRITE_FREEZE:'false',PRODUCTION_OWNER_ACCEPTANCE_BACKEND:'disabled',
        LICENSE_EXPIRY_BACKEND:'d1',NOTIFICATION_ARCHIVE_BACKEND:'d1',STRIPE_DISPATCH_BACKEND:'d1',
        STAGING_BACKUP_ADMISSION:'writers-verified-v1',STAGING_BACKUP_ALERT_BACKEND:'resend-v1',
        STAGING_BACKUP_ALERT_TO:'fanmark.id@gmail.com',STAGING_NO_INDEX:'false'});
      expected.routes=[{pattern:'fanmark.id/*',zone_name:'fanmark.id'}];
      expected.triggers.crons=['* * * * *','0 0 * * *'];
    } else if(name==='backup') {
      expected.vars.STAGING_BACKUP_SCHEDULE='daily-v1';expected.triggers.crons=['5 0 * * *'];
    } else if(name==='backup-monitor') {
      expected.vars.STAGING_BACKUP_MONITOR='hourly-v1';expected.triggers.crons=['35 * * * *'];
    } else {
      expected.vars.PRODUCTION_ALIAS_REDIRECT='enabled';
      expected.routes=[{pattern:'www.fanmark.id/*',zone_name:'fanmark.id'},{pattern:'admin.fanmark.id/*',zone_name:'fanmark.id'}];
    }
    const actual=structuredClone(configs[name]);
    if(!actual)throw Error('production_live_config_missing_'+name);
    // JSON strings contain schema objects whose property order has no meaning.
    if(name!=='alias') {
      actual.vars.STAGING_BACKUP_SCHEMA_HASHES=JSON.parse(actual.vars.STAGING_BACKUP_SCHEMA_HASHES);
      expected.vars.STAGING_BACKUP_SCHEMA_HASHES=JSON.parse(expected.vars.STAGING_BACKUP_SCHEMA_HASHES);
    }
    actual.routes?.sort((a,b)=>a.pattern.localeCompare(b.pattern));expected.routes.sort((a,b)=>a.pattern.localeCompare(b.pattern));
    actual.triggers?.crons?.sort();expected.triggers.crons.sort();
    if(JSON.stringify(canonical(actual))!==JSON.stringify(canonical(expected)))throw Error('production_live_config_drift_'+name);
  }
  return {acceptedV3Configuration:true,workers:4,workerRoutes:3,cronTriggers:4,businessSchema,remoteWrites:0};
}

if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url))console.log(JSON.stringify(validateLiveProductionConfigs(readLiveProductionConfigs())));
