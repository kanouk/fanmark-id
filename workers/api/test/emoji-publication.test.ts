import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {beforeAll,expect,inject,it} from 'vitest';
import schema from '../migrations/0000_emoji_master.sql?raw';
import staging from '../migrations/0001_emoji_master_release_staging.sql?raw';
import activation from '../migrations/0002_emoji_master_release_activation.sql?raw';
import audits from '../migrations/0008_emoji_master_change_audits.sql?raw';
import {checkedInSqlStatements} from './schema-statements';
import {EmojiMasterPublicationService,ProductionEmojiMasterPublicationService} from '../src/emoji-publication-service';
import {verifyEmojiReleasePayload, type ReleaseManifest} from '../src/emoji-release-artifact';
import {stageVerifiedEmojiMasterRelease} from '../../../scripts/migration/emoji-master-release-stage-core.mjs';
import {activateVerifiedEmojiMasterRelease} from '../../../scripts/migration/emoji-master-release-activation-core.mjs';
import {rebuildStoredEmojiRelease} from '../src/emoji-release-artifact';
import {claimRecoveryWriterFence,inspectRecoveryWriters,releaseRecoveryWriterFence,assertRecoveryWriterFence} from '../src/recovery-writer-drain';
import type {Env} from '../src/repository';
type Payload={recordsSource:string;moduleSource:string;manifest:ReleaseManifest};
declare module 'vitest' { interface ProvidedContext { publicationArtifacts:{original:Payload;updated:Payload;next:Payload} } }
const runtime=env as unknown as Env;
const database=runtime.MASTER_DB!;
const lifecycles:Promise<unknown>[]=[];
const context={waitUntil(p:Promise<unknown>){lifecycles.push(p);}} as ExecutionContext;
const Service = (env as unknown as {EMOJI_PUBLICATION_BACKEND?:string}).EMOJI_PUBLICATION_BACKEND === "production-service" ? ProductionEmojiMasterPublicationService : EmojiMasterPublicationService;
const service=new Service(context,env as never);
const artifacts=inject('publicationArtifacts');
const version=artifacts.original.manifest.version;
async function send(path:string,body?:unknown,instance=service){return instance.fetch(new Request('https://emoji-publication.internal'+path,{method:body?'POST':'GET',
 headers:{'x-fanmark-publication-runtime':'00000000-0000-4000-8000-000000000012','content-type':'application/json'},body:body?JSON.stringify(body):undefined}));}
beforeAll(async()=>{
 for(const sql of [schema,staging,activation,audits])for(const statement of checkedInSqlStatements(sql))await database.prepare(statement).run();
 const original=await verifyEmojiReleasePayload(artifacts.original),r=original.records[0];
 await database.prepare('INSERT INTO emoji_master(id,emoji,short_name,keywords,category,subcategory,codepoints,sort_order) VALUES(?,?,?,?,?,?,?,?)')
  .bind(r.id,r.emoji,r.short_name,JSON.stringify(r.keywords),r.category,r.subcategory,JSON.stringify(r.codepoints),r.sort_order).run();
 await stageVerifiedEmojiMasterRelease({database,artifact:original});await activateVerifiedEmojiMasterRelease({database,artifact:original,rebuild:rebuildStoredEmojiRelease});
});
it('runs a normal draft update, verified stage, promotion and rollback without touching populated Business/Auth bindings',async()=>{
 const isolated=new Service(context,{...env,AUTH_DB:{prepare(){throw new Error('Auth access prohibited');}},FANMARK_DB:{prepare(){throw new Error('Business access prohibited');}}} as never);
 const draft=await verifyEmojiReleasePayload(artifacts.updated),r=draft.records[0];
 await database.prepare('UPDATE emoji_master SET keywords=? WHERE id=?').bind(JSON.stringify(r.keywords),r.id).run();
 const body={artifact:artifacts.updated,activationId:'00000000-0000-4000-8000-000000000021',expectedActive:version,expectedGeneration:1};
 const before=await inspectRecoveryWriters(runtime);
 const staged=await send('/stage',body,isolated);expect(staged.status).toBe(200);expect((await staged.json() as {status:string}).status).toBe('ready');
 expect((await database.prepare('SELECT release_version FROM fanmark_emoji_master_active_release').first())?.release_version).toBe(version);
 const promoted=await send('/promotion',body,isolated);expect(promoted.status).toBe(200);
 expect((await database.prepare('SELECT release_version,generation FROM fanmark_emoji_master_active_release').first())).toMatchObject({release_version:draft.version,generation:2});
 const rollback=await send('/rollback',{...body,artifact:artifacts.original,activationId:'00000000-0000-4000-8000-000000000022',expectedActive:draft.version,expectedGeneration:2},isolated);
 expect(rollback.status).toBe(200);expect((await database.prepare('SELECT release_version,generation FROM fanmark_emoji_master_active_release').first())).toMatchObject({release_version:version,generation:3});
 expect((await database.prepare('SELECT COUNT(*) n FROM fanmark_emoji_master_release_activations').first())?.n).toBe(3);
 expect((await database.prepare('SELECT COUNT(*) n FROM emoji_master').first())?.n).toBe(1);
 expect((await inspectRecoveryWriters(runtime)).active).toBe(before.active);await Promise.all(lifecycles);
});
it('rejects stale generation, mismatched draft and corrupted artifacts without changing active/history',async()=>{
 const before=(await database.prepare('SELECT COUNT(*) n FROM fanmark_emoji_master_release_activations').first())?.n;
 const body={artifact:artifacts.updated,activationId:'00000000-0000-4000-8000-000000000023',expectedActive:version,expectedGeneration:1};
 expect((await send('/promotion',body)).status).toBe(409);
 expect((await send('/stage',{...body,artifact:artifacts.original,expectedGeneration:3})).status).toBe(409);
 expect((await send('/stage',{...body,artifact:{...artifacts.updated,moduleSource:'executable payload'},expectedGeneration:3})).status).toBe(400);
 expect((await database.prepare('SELECT COUNT(*) n FROM fanmark_emoji_master_release_activations').first())?.n).toBe(before);
});
it('refuses stage under a backup fence and returns read-only status without entering the census',async()=>{
 const owner='00000000-0000-4000-8000-000000000024';await claimRecoveryWriterFence(runtime,owner);
 const before=await inspectRecoveryWriters(runtime);
 expect((await send('/stage',{artifact:artifacts.updated,activationId:owner,expectedActive:version,expectedGeneration:3})).status).toBe(503);
 const status=await send('/status?version='+version);expect(status.status).toBe(200);
 expect(await inspectRecoveryWriters(runtime)).toEqual(before);await releaseRecoveryWriterFence(runtime,owner);
});
it('rejects other runtime, default/combined topology and unsupported URLs before any publication',async()=>{
 expect((await service.fetch(new Request('https://app.example.test/stage'))).status).toBe(404);
 expect((await service.fetch(new Request('https://emoji-publication.internal/status'))).status).toBe(503);
 const off=new Service(context,{...env,EMOJI_PUBLICATION_BACKEND:undefined} as never);
 expect((await send('/status',undefined,off)).status).toBe(503);
 const combined=new Service(context,{...env,D1_TOPOLOGY:undefined} as never);
 expect((await send('/status',undefined,combined)).status).toBe(503);
 const gate=runtime.RECOVERY_DRAIN!.get(runtime.RECOVERY_DRAIN!.idFromName('recovery-writers-v1'));
 await runInDurableObject(gate,async(_instance,state)=>{expect((await state.storage.list({prefix:'writer:'})).size).toBe(0);});
});

it('retains the writer across actual D1 batch work, refuses another publisher, and drains only after completion',async()=>{
 let entered!:()=>void,finish!:()=>void;
 const started=new Promise<void>(r=>{entered=r;}),done=new Promise<void>(r=>{finish=r;});
 const delayed={prepare:database.prepare.bind(database),async batch(statements:D1PreparedStatement[]){entered();await done;return database.batch(statements);}} as unknown as D1Database;
 const instance=new Service(context,{...env,MASTER_DB:delayed} as never);
 const candidate=await verifyEmojiReleasePayload(artifacts.next),record=candidate.records[0];
 await database.prepare('UPDATE emoji_master SET keywords=? WHERE id=?').bind(JSON.stringify(record.keywords),record.id).run();
 const body={artifact:artifacts.next,activationId:'00000000-0000-4000-8000-000000000025',expectedActive:version,expectedGeneration:3};
 const pending=send('/stage',body,instance);await started;
 expect(await inspectRecoveryWriters(runtime)).toMatchObject({active:1,tickets:{kinds:{'master-publication':1}}});
 expect((await send('/stage',{...body,activationId:'00000000-0000-4000-8000-000000000026'})).status).toBe(503);
 const owner='00000000-0000-4000-8000-000000000027';
 expect(await claimRecoveryWriterFence(runtime,owner)).toMatchObject({active:1,drained:false});
 await expect(assertRecoveryWriterFence(runtime,owner)).rejects.toThrow('recovery_writer_unavailable');
 expect((await database.prepare('SELECT status FROM fanmark_emoji_master_release_imports WHERE release_version=?').bind(candidate.version).first())?.status).toBe('loading');
 finish();expect((await pending).status).toBe(200);await assertRecoveryWriterFence(runtime,owner);await releaseRecoveryWriterFence(runtime,owner);
 expect((await database.prepare('SELECT status FROM fanmark_emoji_master_release_imports WHERE release_version=?').bind(candidate.version).first())?.status).toBe('ready');
});

it('production and staging publication entrypoints reject each other and wrong source store identities',async()=>{
 const other = Service === ProductionEmojiMasterPublicationService ? EmojiMasterPublicationService : ProductionEmojiMasterPublicationService;
 expect((await send('/status',undefined,new other(context,env as never))).status).toBe(503);
 if(Service === ProductionEmojiMasterPublicationService) {
   const ids=JSON.parse((env as unknown as {STAGING_BACKUP_SOURCE_IDS:string}).STAGING_BACKUP_SOURCE_IDS);
   expect((await send('/status',undefined,new Service(context,{...env,STAGING_BACKUP_SOURCE_IDS:JSON.stringify({...ids,auth:'unowned'})} as never))).status).toBe(503);
 }
});
