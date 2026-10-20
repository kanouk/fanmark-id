import {env,runInDurableObject} from 'cloudflare:test';
import {beforeAll,expect,inject,it} from 'vitest';
import schema from '../migrations/0000_emoji_master.sql?raw';
import staging from '../migrations/0001_emoji_master_release_staging.sql?raw';
import activation from '../migrations/0002_emoji_master_release_activation.sql?raw';
import audits from '../migrations/0008_emoji_master_change_audits.sql?raw';
import {checkedInSqlStatements} from './schema-statements';
import {EmojiMasterPublicationService,EmojiMasterPublicationServiceV3,EmojiMasterPublicationServiceV4} from '../src/emoji-publication-service';
import {STAGING_EMOJI_PUBLICATION_TARGETS} from '../../../scripts/migration/staging-emoji-targets.mjs';
import {verifyEmojiReleasePayload,rebuildStoredEmojiRelease} from '../src/emoji-release-artifact';
import {stageVerifiedEmojiMasterRelease} from '../../../scripts/migration/emoji-master-release-stage-core.mjs';
import {activateVerifiedEmojiMasterRelease} from '../../../scripts/migration/emoji-master-release-activation-core.mjs';
import {claimRecoveryWriterFence,inspectRecoveryWriters,releaseRecoveryWriterFence} from '../src/recovery-writer-drain';
import type {Env} from '../src/repository';
const runtime=env as unknown as Env,database=runtime.MASTER_DB!,artifacts=inject('publicationArtifacts');
const context={waitUntil(p:Promise<unknown>){void p.catch(()=>{});}} as ExecutionContext;
const service=new EmojiMasterPublicationServiceV4(context,env as never);
async function send(path:string,body?:unknown,instance=service){return instance.fetch(new Request('https://emoji-publication.internal'+path,{method:body?'POST':'GET',headers:{'x-fanmark-publication-runtime':'00000000-0000-4000-8000-000000000012','content-type':'application/json'},body:body?JSON.stringify(body):undefined}));}
beforeAll(async()=>{
 for(const sql of [schema,staging,activation,audits])for(const statement of checkedInSqlStatements(sql))await database.prepare(statement).run();
 const original=await verifyEmojiReleasePayload(artifacts.original),r=original.records[0];
 await database.prepare('INSERT INTO emoji_master(id,emoji,short_name,keywords,category,subcategory,codepoints,sort_order) VALUES(?,?,?,?,?,?,?,?)').bind(r.id,r.emoji,r.short_name,JSON.stringify(r.keywords),r.category,r.subcategory,JSON.stringify(r.codepoints),r.sort_order).run();
 await stageVerifiedEmojiMasterRelease({database,artifact:original});
 await activateVerifiedEmojiMasterRelease({database,artifact:original,rebuild:rebuildStoredEmojiRelease,action:'promotion',expectedCurrentVersion:null});
});
it('accepts only the V4 paired Master/scope and preserves its native backup fence',async()=>{
 expect((await send('/status',undefined,new EmojiMasterPublicationService(context,env as never))).status).toBe(503);
 expect((await send('/status',undefined,new EmojiMasterPublicationServiceV3(context,env as never))).status).toBe(503);
 const old=STAGING_EMOJI_PUBLICATION_TARGETS[1];
 expect((await send('/status',undefined,new EmojiMasterPublicationServiceV4(context,{...env,STAGING_BACKUP_SOURCE_IDS:JSON.stringify({master:old.masterId})} as never))).status).toBe(503);
 expect((await send('/status',undefined,new EmojiMasterPublicationServiceV4(context,{...env,RECOVERY_DRAIN_SCOPE_DIGEST:old.scope} as never))).status).toBe(503);
 const response=await send('/status');expect(response.status).toBe(200);const before=await response.json() as {active:{release_version:string;generation:number}};
 const owner='00000000-0000-4000-8000-000000000028';await claimRecoveryWriterFence(runtime,owner);
 try{expect((await send('/stage',{artifact:artifacts.updated,activationId:'00000000-0000-4000-8000-000000000029',expectedActive:before.active.release_version,expectedGeneration:before.active.generation})).status).toBe(503);
 expect(await (await send('/status')).json()).toMatchObject({active:before.active});expect((await inspectRecoveryWriters(runtime)).active).toBe(0);
 }finally{await releaseRecoveryWriterFence(runtime,owner);}
});
it('keeps the old V3 ticket and refuses its object while the new namespace stages a release',async()=>{
 const native=env as unknown as {LEGACY_RECOVERY_DRAIN:DurableObjectNamespace};
 const legacy=native.LEGACY_RECOVERY_DRAIN.get(native.LEGACY_RECOVERY_DRAIN.idFromName('recovery-writers-v1'));
 await runInDurableObject(legacy,async(_instance,state)=>{await state.storage.put('scope',runtime.RECOVERY_DRAIN_SCOPE_DIGEST!);await state.storage.put('active',1);await state.storage.put('writer:00000000-0000-4000-8000-000000000032',{enteredAt:1,runtimeRevision:'00000000-0000-4000-8000-000000000033'});});
 const refused=await legacy.fetch(new Request('https://recovery-writer.internal/inspect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'00000000-0000-4000-8000-000000000030',scope:runtime.RECOVERY_DRAIN_SCOPE_DIGEST})}));expect(refused.status).toBe(409);
 const before=await (await send('/status')).json() as {active:{release_version:string;generation:number}},next=await verifyEmojiReleasePayload(artifacts.updated);
 await database.prepare('UPDATE emoji_master SET keywords=? WHERE id=?').bind(JSON.stringify(next.records[0].keywords),next.records[0].id).run();
 const response=await send('/stage',{artifact:artifacts.updated,activationId:'00000000-0000-4000-8000-000000000031',expectedActive:before.active.release_version,expectedGeneration:before.active.generation});expect(response.status).toBe(200);
 expect(await (await send('/status')).json()).toMatchObject({active:before.active,writers:{active:0}});
 expect(await runInDurableObject(legacy,(_instance,state)=>state.storage.get('writer:00000000-0000-4000-8000-000000000032'))).toEqual({enteredAt:1,runtimeRevision:'00000000-0000-4000-8000-000000000033'});
});
