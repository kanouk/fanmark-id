/** Fixed production control-plane identity. Never admits staging cohorts or arbitrary targets. */
import {readFileSync} from 'node:fs';
import {PRODUCTION_RUNTIME,PRODUCTION_STORE_IDS} from '../../workers/api/src/production-runtime-identity.ts';
const resources=JSON.parse(readFileSync(new URL('../../docs/migration/production-resources.json',import.meta.url),'utf8'));
const master=resources.d1.find(row=>row.binding==='MASTER_DB');
export const PRODUCTION_EMOJI_TARGET=Object.freeze({name:'production',account:PRODUCTION_RUNTIME.accountId,
 worker:PRODUCTION_RUNTIME.worker,masterId:PRODUCTION_STORE_IDS.master,masterName:master.name,createdAt:master.createdAt,
 scope:PRODUCTION_RUNTIME.scope,entrypoint:'ProductionEmojiMasterPublicationService'});
export function resolveProductionEmojiTarget(settings){
 const fail=()=>{throw Error('production_emoji_target_mismatch');};
 if(!Array.isArray(settings?.bindings))fail();
 const binding=name=>{const rows=settings.bindings.filter(row=>row.name===name);if(rows.length!==1)fail();return rows[0];};
 for(const [name,id]of Object.entries({AUTH_DB:PRODUCTION_STORE_IDS.auth,FANMARK_DB:PRODUCTION_STORE_IDS.business,MASTER_DB:PRODUCTION_STORE_IDS.master})){
  const row=binding(name);if(row.type!=='d1'||row.id!==id)fail();
 }
 for(const [name,bucket]of Object.entries({AVATARS_BUCKET:PRODUCTION_STORE_IDS.avatars,COVER_IMAGES_BUCKET:PRODUCTION_STORE_IDS.covers})){
  const row=binding(name);if(row.type!=='r2_bucket'||row.bucket_name!==bucket)fail();
 }
 for(const [name,value]of Object.entries({RECOVERY_DRAIN_SCOPE_DIGEST:PRODUCTION_RUNTIME.scope,D1_TOPOLOGY:'split',EMOJI_PUBLICATION_BACKEND:'production-service'}))if(binding(name).text!==value)fail();
 return PRODUCTION_EMOJI_TARGET;
}
