import {createHash,randomUUID} from 'node:crypto';
import {PRODUCTION_R2_TARGETS} from './production-r2-targets.mjs';
import {PRODUCTION_D1_TARGETS} from './production-d1-targets.mjs';

const HASH=/^[0-9a-f]{64}$/u, UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const SCOPE='6c6685377bca7b2e24d637b4a43888b77a16e280fdc587ce42623156cd615e9d';
const clients=new WeakSet();
const fail=()=>{throw Error('production_import_coordination_unconfirmed');};
export const isProductionImportCoordinator=client=>clients.has(client);

/** The caller supplies the private binding transport, not a public API URL.
 * Creation claims no state; claim() is a deliberate, single remote operation.
 * This is admission only, not proof of source freeze or all-store reconciliation.
 */
export function createProductionImportCoordinator({owner,manifestSha256,incarnations,command}) {
  if(!UUID.test(owner??'')||!HASH.test(manifestSha256??'')||typeof command!=='function'||!incarnations||
    Object.keys(incarnations).sort().join(',')!=='auth,avatars,business,covers,master'||
    Object.values(incarnations).some(value=>!UUID.test(value))||new Set(Object.values(incarnations)).size!==5)fail();
  const frozenIncarnations=Object.freeze({...incarnations});
  const incarnationsSha256=createHash('sha256').update(JSON.stringify(Object.entries(frozenIncarnations).sort())).digest('hex');
  const identity=Object.freeze({owner,manifestSha256,incarnationsSha256});
  let admitted=false, executorId=null;
  function validate(state) {
    if(!state||Object.entries(identity).some(([key,value])=>state[key]!==value)||
      !Number.isSafeInteger(state.acknowledged)||state.acknowledged<0||
      (state.readbackSha256!==null&&!HASH.test(state.readbackSha256??'')))fail();
    return state;
  }
  async function invoke(action,input){try{return await command(action,input);}catch{fail();}}
  const client=Object.freeze({
    owner,manifestSha256,incarnations:frozenIncarnations,
    async claim(){
      const state=validate(await invoke('claim',identity));
      if(state.pending!==null||state.readbackSha256!==null)fail();
      admitted=true;return state;
    },
    async acquireExecution(candidate=randomUUID()){
      if(!admitted||executorId!==null)fail();
      if(!UUID.test(candidate??''))fail();
      const result=await invoke('acquire',{owner,executorId:candidate});
      const state=validate(result);
      if(result.executorId!==candidate||state.pending!==null||state.readbackSha256!==null)fail();
      executorId=candidate;return {executorId};
    },
    async yieldExecution(readbackSha256){
      if(!admitted||executorId===null||!HASH.test(readbackSha256??''))fail();
      const result=await invoke('yield',{owner,executorId,readbackSha256}),state=validate(result);
      if(result.executorId!==null||state.pending!==null||state.readbackSha256!==null)fail();
      executorId=null;admitted=false;return state;
    },
    async recoverExecution({executorId:previous,acknowledged,readbackSha256}){
      if(executorId!==null||!UUID.test(previous??'')||!Number.isSafeInteger(acknowledged)||acknowledged<0||!HASH.test(readbackSha256??''))fail();
      const result=await invoke('recover',{owner,executorId:previous,acknowledged,readbackSha256}),state=validate(result);
      if(result.executorId!==null||state.pending!==null||state.readbackSha256!==null||state.acknowledged!==acknowledged)fail();
      admitted=false;return state;
    },
    async recoverAuthAcknowledgement({executorId:previous,operationId,batchSha256,readbackSha256}){
      if(executorId!==null||!UUID.test(previous??'')||!UUID.test(operationId??'')||
        !HASH.test(batchSha256??'')||!HASH.test(readbackSha256??''))fail();
      const result=await invoke('recover-auth',{owner,executorId:previous,operationId,batchSha256,store:'auth',readbackSha256});
      const state=validate(result);
      if(state.pending!==null||state.readbackSha256!==null||state.acknowledged!==1)fail();
      admitted=false;return state;
    },
    async inspect(){
      const result=await invoke('inspect',{owner});
      if(result?.scope!==SCOPE||!Number.isSafeInteger(result.active)||result.active<0||
        (result.fenceOwner!==null&&result.fenceOwner!==owner)||
        (result.executorId!=null&&!UUID.test(result.executorId)))fail();
      if(result.state!==null)validate(result.state);
      return result;
    },
    async quarantineExecution({executorId:previous,stateSha256,proofSha256}){
      if(executorId!==null||(previous!==null&&!UUID.test(previous??''))||!HASH.test(stateSha256??'')||!HASH.test(proofSha256??''))fail();
      const result=await invoke('quarantine',{owner,executorId:previous,stateSha256,proofSha256});
      validate(result.state);
      if(result.scope!==SCOPE||result.active!==0||result.fenceOwner!==owner||result.executorId!==previous||
        result.quarantine?.owner!==owner||result.quarantine.proofSha256!==proofSha256||
        result.quarantine.stateSha256!==stateSha256||result.quarantine.executorId!==previous)fail();
      admitted=false;return result;
    },
    async inspectOperation(operationId){
      if(!UUID.test(operationId??''))fail();
      const result=await invoke('operation',{owner,operationId});
      if(result?.scope!==SCOPE||result.operationId!==operationId||!Number.isSafeInteger(result.active)||result.active<0||
        (result.fenceOwner!==null&&result.fenceOwner!==owner)||
        (result.executorId!=null&&!UUID.test(result.executorId)))fail();
      if(result.state!==null)validate(result.state);
      for(const key of ['pending','acknowledged','dispatched']){
        const row=result[key];
        if(row!==null&&(!row||row.operationId!==operationId||!HASH.test(row.batchSha256??'')||
          !Object.hasOwn(frozenIncarnations,row.store)))fail();
      }
      if((result.acknowledged&&!(result.state?.acknowledged>=1))||(result.pending&&result.acknowledged)||(result.dispatched&&
        (!['avatars','covers'].includes(result.dispatched.store)||
         ['operationId','batchSha256','store'].some(key=>result.dispatched[key]!==(result.acknowledged??result.pending)?.[key]))))fail();
      if((result.state===null&&(result.pending||result.acknowledged||result.dispatched))||
        (result.pending?['operationId','batchSha256','store'].some(key=>result.pending[key]!==result.state?.pending?.[key]):result.state?.pending?.operationId===operationId))fail();
      return result;
    },
    assertTarget(targetId,targetIncarnation){
      const row=PRODUCTION_D1_TARGETS.find(item=>item.databaseId===targetId);
      const store=row?.databaseName.replace('fanmark-production-','') ?? PRODUCTION_R2_TARGETS.find(item=>item.bucketName===targetId)?.store;
      if(!admitted||!store||frozenIncarnations[store]!==targetIncarnation)fail();
      return store;
    },
    async beforeWrite({operationId,batchSha256,store}){
      if(!admitted||!UUID.test(operationId??'')||!HASH.test(batchSha256??'')||!Object.hasOwn(frozenIncarnations,store))fail();
      const pending={operationId,batchSha256,store};
      const state=validate(await invoke('begin',{owner,...pending,...(executorId?{executorId}:{})}));
      if(state.readbackSha256!==null||!state.pending||Object.entries(pending).some(([key,value])=>state.pending[key]!==value))fail();
    },
    async afterWrite({operationId,batchSha256,store}){
      if(!admitted)fail();
      const state=validate(await invoke('acknowledge',{owner,operationId,batchSha256,store,...(executorId?{executorId}:{})}));
      if(state.pending!==null||state.readbackSha256!==null||state.acknowledged<1)fail();
    },
    async complete(readbackSha256){
      if(!admitted||!HASH.test(readbackSha256??''))fail();
      const state=validate(await invoke('complete',{owner,readbackSha256,...(executorId?{executorId}:{})}));
      if(state.pending!==null||state.readbackSha256!==readbackSha256)fail();
      admitted=false;executorId=null;return state;
    },
  });
  clients.add(client);return client;
}
