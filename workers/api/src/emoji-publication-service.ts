import {WorkerEntrypoint} from "cloudflare:workers";
import {selectD1Database,type Env} from "./repository";
import {inspectRecoveryWriters,withRecoveryWriter} from "./recovery-writer-drain";
import {canonicalReleaseValue,rebuildStoredEmojiRelease,verifyEmojiReleasePayload,type VerifiedEmojiArtifact} from "./emoji-release-artifact";
import {stageVerifiedEmojiMasterRelease} from "../../../scripts/migration/emoji-master-release-stage-core.mjs";
import {activateVerifiedEmojiMasterRelease} from "../../../scripts/migration/emoji-master-release-activation-core.mjs";

import {STAGING_EMOJI_PUBLICATION_TARGETS,type StagingEmojiTarget} from "../../../scripts/migration/staging-emoji-targets.mjs";

const HASH=/^[a-f0-9]{64}$/u,UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
type PublicationEnv=Env&{EMOJI_PUBLICATION_BACKEND?:string;STAGING_BACKUP_SOURCE_IDS?:string};
type Active={release_version:string;generation:number;activation_id:string;action:string;previous_release_version:string|null};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store"}});
function unavailable():never {throw new Error("publication_unavailable");}
function databaseFor(env:PublicationEnv,request:Request,target:StagingEmojiTarget):D1Database {
  let source:Record<string,unknown>;try{source=JSON.parse(env.STAGING_BACKUP_SOURCE_IDS??"");}catch{unavailable();}
  if(env.EMOJI_PUBLICATION_BACKEND!=="staging-service"||env.D1_TOPOLOGY!=="split"||source.master!==target.masterId||
      env.RECOVERY_DRAIN_BACKEND!=="durable-object"||env.RECOVERY_DRAIN_SCOPE_DIGEST!==target.scope||
      !UUID.test(env.CF_VERSION_METADATA?.id??"")||request.headers.get("x-fanmark-publication-runtime")!==env.CF_VERSION_METADATA?.id)unavailable();
  const database=selectD1Database(env,"master");if(!database)unavailable();return database;
}
async function active(database:D1Database):Promise<Active>{
  const r=await database.prepare("SELECT release_version,generation,activation_id,action,previous_release_version FROM fanmark_emoji_master_active_release WHERE singleton_id=1").all<Active>();
  if(!r.success||r.results.length!==1||!HASH.test(r.results[0].release_version)||!Number.isSafeInteger(r.results[0].generation)||r.results[0].generation<1)unavailable();return r.results[0];
}
async function assertDraft(database:D1Database,artifact:VerifiedEmojiArtifact):Promise<void>{
  const r=await database.prepare("SELECT id,emoji,short_name,keywords,category,subcategory,codepoints,sort_order FROM emoji_master ORDER BY id").all<{id:string;emoji:string;short_name:string;keywords:string;category:string|null;subcategory:string|null;codepoints:string;sort_order:number|null}>();
  if(!r.success)unavailable();
  const records=r.results.map(row=>({...row,keywords:JSON.parse(row.keywords),codepoints:JSON.parse(row.codepoints)}));
  if(canonicalReleaseValue(records)!==canonicalReleaseValue(artifact.records))throw new Error("draft_artifact_mismatch");
}
/** A control-plane service binding only. The default public HTTP router never calls this entrypoint. */
async function publicationFetch(request:Request,env:PublicationEnv,context:Pick<ExecutionContext,"waitUntil">,target:StagingEmojiTarget):Promise<Response>{
    const url=new URL(request.url);
    if(url.origin!=="https://emoji-publication.internal")return json({error:"not_found"},404);
    try{
      const database=databaseFor(env,request,target);
      if(request.method==="GET"&&url.pathname==="/status"){
        if([...url.searchParams.keys()].some(key=>!["version","activationId"].includes(key)))throw new Error("invalid_request");
        const version=url.searchParams.get("version"),activationId=url.searchParams.get("activationId");
        if(version!==null&&!HASH.test(version)||activationId!==null&&!UUID.test(activationId))throw new Error("invalid_request");
        const publication=version?await database.prepare("SELECT release_version,status,row_count FROM fanmark_emoji_master_release_imports WHERE release_version=?").bind(version).first():null;
        const event=activationId?await database.prepare("SELECT activation_id,generation,action,from_version,to_version FROM fanmark_emoji_master_release_activations WHERE activation_id=?").bind(activationId).first():null;
        return json({runtimeVersion:env.CF_VERSION_METADATA!.id,active:await active(database),publication,event,writers:await inspectRecoveryWriters(env)});
      }
      if(request.method!=="POST"||url.search||!["/stage","/promotion","/rollback"].includes(url.pathname))return json({error:"not_found"},404);
      if(Number(request.headers.get("content-length")??0)>16_000_000)throw new Error("invalid_request");
      const text=await request.text();if(new TextEncoder().encode(text).length>16_000_000)throw new Error("invalid_request");
      const input:unknown=JSON.parse(text);
      if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("invalid_request");
      const body=input as Record<string,unknown>;
      if(Object.keys(body).sort().join(",")!=="activationId,artifact,expectedActive,expectedGeneration"||
          typeof body.activationId!=="string"||!UUID.test(body.activationId)||typeof body.expectedActive!=="string"||!HASH.test(body.expectedActive)||
          !Number.isSafeInteger(body.expectedGeneration)||(body.expectedGeneration as number)<1)throw new Error("invalid_request");
      const artifact=await verifyEmojiReleasePayload(body.artifact);
      return await withRecoveryWriter(env,async()=>{
        // A second publisher must not delete another live import's partial rows.
        if((await inspectRecoveryWriters(env)).tickets.kinds["master-publication"]!==1)throw new Error("publication_busy");
        const current=await active(database);
        if(current.release_version!==body.expectedActive||current.generation!==body.expectedGeneration)throw new Error("activation_state_conflict");
        if(url.pathname==="/stage"){
          await assertDraft(database,artifact);
          const result=await stageVerifiedEmojiMasterRelease({database,artifact,maxRowsPerBatch:50});
          const after=await active(database);
          if(canonicalReleaseValue(current)!==canonicalReleaseValue(after))throw new Error("activation_state_conflict");
          return json({runtimeVersion:env.CF_VERSION_METADATA!.id,...result});
        }
        const result=await activateVerifiedEmojiMasterRelease({database,artifact,rebuild:rebuildStoredEmojiRelease,
          action:url.pathname==="/rollback"?"rollback":"promotion",expectedCurrentVersion:body.expectedActive as string,
          expectedCurrentGeneration:body.expectedGeneration as number,activationId:body.activationId as string});
        return json({runtimeVersion:env.CF_VERSION_METADATA!.id,activationId:body.activationId,...result});
      },context,"master-publication");
    }catch(error){
      const code=error instanceof Error?error.message:"publication_failed";
      if(["publication_unavailable","recovery_writer_unavailable","publication_busy"].includes(code))return json({error:code},503);
      if(["activation_state_conflict","draft_artifact_mismatch","release_identity_break","rollback_target_unknown","release_not_ready"].includes(code))return json({error:code},409);
      if(["invalid_request","release_artifact_invalid"].includes(code))return json({error:code},400);
      return json({error:"publication_failed"},503);
    }
}
export class EmojiMasterPublicationService extends WorkerEntrypoint<PublicationEnv>{
 async fetch(request:Request):Promise<Response>{return publicationFetch(request,this.env,this.ctx,STAGING_EMOJI_PUBLICATION_TARGETS[0]);}
}
export class EmojiMasterPublicationServiceV3 extends WorkerEntrypoint<PublicationEnv>{
 async fetch(request:Request):Promise<Response>{return publicationFetch(request,this.env,this.ctx,STAGING_EMOJI_PUBLICATION_TARGETS[1]);}
}
export class EmojiMasterPublicationServiceV4 extends WorkerEntrypoint<PublicationEnv>{
 async fetch(request:Request):Promise<Response>{return publicationFetch(request,this.env,this.ctx,STAGING_EMOJI_PUBLICATION_TARGETS[2]);}
}
