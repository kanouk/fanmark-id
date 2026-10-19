import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, chmod, rm, readdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import {executeProductionWebhookRegistration, inspectProductionWebhookRegistrationExecution,
  collectProductionWebhookInventory} from './production-webhook-execution.mjs';
import {sha256Hex} from './snapshot-format.mjs';
import {prepareProductionWebhookRegistration} from './production-webhook-custody.mjs';

async function fixture(t, provider = 'stripe') {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'fanmark-webhook-execution-'));
  await chmod(directory,0o700); t.after(() => rm(directory,{recursive:true,force:true}));
  const operationId=randomUUID(), runtimeVersion=randomUUID(), now=Date.now();
  const secret='whsec_'+randomBytes(32).toString('base64'), calls=[];
  const settings={bindings:[{name:'CUTOVER_WRITE_FREEZE',type:'plain_text',text:'receipt_only'}]};
  const gate={format:'fanmark-production-webhook-g4-evidence-v1',runId:randomUUID(),runtimeVersion,
    settingsSha256:sha256Hex(settings),sourceBoundarySha256:'a'.repeat(64),reconciliationSha256:'b'.repeat(64),
    receiptHandoffSha256:'c'.repeat(64),sourceProject:'ppqgtbjykitqtiaisyji',sourceFrozen:true,
    externalEffectsReconciled:true,g3Reconciled:true,receiptHandoffReconciled:true,
    businessWritesStarted:false,operatorApproved:true,observedAt:now,routingMode:'worker-route'};
  const request=prepareProductionWebhookRegistration({provider,operationId});
  const endpoint=provider==='stripe'?{id:'we_fixture',url:request.body.url,livemode:true,application:null,
    status:'enabled',api_version:request.body.api_version,metadata:request.body.metadata,enabled_events:request.body.enabled_events}:
    {id:randomUUID(),endpoint:request.body.endpoint,status:'enabled',events:request.body.events,signing_secret:secret};
  const state={postMode:'ok',publicStatus:503,settings,gate,endpoint,registered:false};
  const options={directory,provider,operationId,archiveKeyId:'production-backup-'+randomUUID(),archiveKeyHex:randomBytes(32).toString('hex'),
    apiKey:provider==='stripe'?'sk_live_fixture':'re_fixture',cloudflareToken:'cf_private_fixture',gate,now:()=>now};
  options.fetchImpl=async (url,o)=>{
    calls.push({url,method:o.method,headers:o.headers,body:o.body});
    assert.equal(o.redirect,'error');
    if(url.startsWith('https://api.cloudflare.com/client/v4/zones/')){
      assert.equal(o.method,'GET');assert.equal(o.headers.authorization,'Bearer cf_private_fixture');
      return Response.json({success:true,result:gate.routingMode==='worker-route'?[{id:'fixed',pattern:'fanmark.id/*',script:'fanmark-app-production'}]:[]});
    }
    if(url.startsWith('https://api.cloudflare.com/')){
      assert.equal(o.method,'GET');assert.equal(o.headers.authorization,'Bearer cf_private_fixture');
      const result=url.endsWith('/settings')?state.settings:url.endsWith('/deployments')?{deployments:[{versions:[{version_id:runtimeVersion,percentage:100}]}]}:
        url.endsWith('/domains')?(gate.routingMode==='custom-domain'?[{hostname:'fanmark.id',service:'fanmark-app-production',zone_id:'6a2c39c92ba1c4106b7c19f87ada0a7e'}]:[]):
        url.endsWith('/schedules')?{schedules:[]}:url.endsWith('/subdomain')?{enabled:false,previews_enabled:false}:assert.fail(url);
      return Response.json({success:true,result});
    }
    if(url.startsWith('https://fanmark.id')){
      assert.equal(o.headers?.authorization,undefined);
      const content=url==='https://fanmark.id/'?'<title>メンテナンス中 | fanmark.id</title>':
        JSON.stringify({error:url.endsWith('/stripe/webhook')?'stripe_ingress_unavailable':'cutover_write_freeze'});
      return new Response(content,{status:state.publicStatus,headers:{'cache-control':'no-store'}});
    }
    assert.equal(new URL(url).origin,provider==='stripe'?'https://api.stripe.com':'https://api.resend.com');
    assert.equal(o.headers.authorization,'Bearer '+options.apiKey);
    if(o.method==='POST'){
      state.registered=true;
      if(provider==='stripe'){
        const data=new URLSearchParams(o.body);assert.deepEqual(data.getAll('enabled_events[]'),request.body.enabled_events);
        assert.equal(data.get('metadata[fanmark_migration_operation]'),operationId);
        assert.equal(data.get('connect'),'false');assert.equal(o.headers['idempotency-key'],request.idempotencyKey);
      }else assert.deepEqual(JSON.parse(o.body),request.body);
      if(state.postMode==='lost')throw Error(secret);
      if(state.postMode==='rejected')return Response.json({error:secret},{status:500});
      if(state.postMode==='html')return new Response(secret,{status:502});
      return Response.json(provider==='stripe'?{...endpoint,secret}:{id:endpoint.id,signing_secret:secret},{status:201});
    }
    if(url.endsWith('/account'))return Response.json({id:'acct_1SFjhvJk0VCfiKUp'});
    if(url.includes('/v2/core/event_destinations')){
      assert.equal(o.headers['stripe-version'],'2026-09-30.endive');
      return Response.json({data:[],next_page_url:null});
    }
    if(url.includes('/domains?'))return Response.json({has_more:false,data:[{id:randomUUID(),name:'fanmark.id',status:'verified'}]});
    if(url.includes('/webhooks/')||url.includes('/webhook_endpoints/'))return Response.json(endpoint);
    return Response.json({has_more:false,data:state.registered?[endpoint]:[]});
  };
  return {options,secret,calls,state};
}
const posts=f=>f.calls.filter(c=>c.method==='POST'&&!c.url.startsWith('https://fanmark.id'));

for(const provider of ['stripe','resend'])test(provider+' makes one durable POST and verifies separate GET without returning the key',async t=>{
  const f=await fixture(t,provider),result=await executeProductionWebhookRegistration(f.options);
  assert.equal(posts(f).length,1);assert.equal(result.providerEndpointReadbackVerified,true);
  assert.equal(result.runtimeSecretInstalled,false);assert.equal(result.cutoverAdmitted,false);
  assert.ok(!JSON.stringify(result).includes(f.secret));
  for(const name of await readdir(f.options.directory))assert.ok(!(await readFile(join(f.options.directory,name),'utf8')).includes(f.secret));
  await assert.rejects(executeProductionWebhookRegistration(f.options));assert.equal(posts(f).length,1);
});
test('explicit Custom Domain admission also requires an otherwise empty zone route list',async t=>{
  const f=await fixture(t);f.options.gate.routingMode='custom-domain';
  assert.equal((await executeProductionWebhookRegistration(f.options)).providerPostAttempts,1);
});
test('an overlapping zone route or competing apex domain prevents registration',async t=>{
  const f=await fixture(t),original=f.options.fetchImpl;
  f.options.fetchImpl=async(url,o)=>url.startsWith('https://api.cloudflare.com/client/v4/zones/')?
    Response.json({success:true,result:[{pattern:'fanmark.id/*',script:'fanmark-app-production'},{pattern:'*.fanmark.id/*',script:'other'}]}):original(url,o);
  await assert.rejects(executeProductionWebhookRegistration(f.options),/domain_not_attached/);assert.equal(posts(f).length,0);
  f.options.fetchImpl=async(url,o)=>url.endsWith('/domains')?
    Response.json({success:true,result:[{hostname:'fanmark.id',service:'another-worker'}]}):original(url,o);
  await assert.rejects(executeProductionWebhookRegistration(f.options),/domain_not_attached/);assert.equal(posts(f).length,0);
});

test('stale/incomplete G4 and old public site are rejected before any provider POST or intent',async t=>{
  const f=await fixture(t);
  for(const change of [{observedAt:f.options.now()-120001},{sourceFrozen:false},{g3Reconciled:false},
    {receiptHandoffReconciled:false},{businessWritesStarted:true},{operatorApproved:false},{reconciliationSha256:null}]){
    await assert.rejects(executeProductionWebhookRegistration({...f.options,gate:{...f.options.gate,...change}}),/g4_evidence_required/);
  }
  f.state.publicStatus=200;
  await assert.rejects(executeProductionWebhookRegistration(f.options),/public_route_unconfirmed/);
  assert.deepEqual(await readdir(f.options.directory),[]);assert.equal(posts(f).length,0);
});

test('settings, enabled dispatcher, duplicate destination and changing gate prevent creation',async t=>{
  const f=await fixture(t);
  f.state.settings={bindings:[]};await assert.rejects(executeProductionWebhookRegistration(f.options),/settings_changed/);
  f.state.settings={bindings:[{name:'CUTOVER_WRITE_FREEZE',text:'receipt_only'},{name:'STRIPE_DISPATCH_BACKEND',text:'d1'}]};
  await assert.rejects(executeProductionWebhookRegistration({...f.options,gate:{...f.options.gate,settingsSha256:sha256Hex(f.state.settings)}}),/target_not_closed/);
  f.state.settings={bindings:[{name:'CUTOVER_WRITE_FREEZE',type:'plain_text',text:'receipt_only'}]};
  f.state.registered=true;await assert.rejects(executeProductionWebhookRegistration(f.options),/endpoint_already_present/);
  assert.equal(posts(f).length,0);
});

test('unknown POST keeps intent/dispatch, exposes no secret and never permits a second POST',async t=>{
  const f=await fixture(t);f.state.postMode='lost';
  await assert.rejects(executeProductionWebhookRegistration(f.options),e=>e.message==='production_webhook_execution_post_outcome_unknown'&&!e.message.includes(f.secret));
  const files=await readdir(f.options.directory);assert.ok(files.includes('stripe-registration-dispatch.json'));
  assert.ok(!files.includes('stripe-registration-response.enc.json'));
  const hash=async name=>sha256Hex(await readFile(join(f.options.directory,name)));
  const report=await inspectProductionWebhookRegistrationExecution({...f.options,
    expectedIntentSha256:await hash('stripe-registration-intent.json'),expectedDispatchSha256:await hash('stripe-registration-dispatch.json')});
  assert.equal(report.candidates.length,1);assert.equal(report.ownershipVerified,false);assert.equal(report.retryAllowed,false);
  assert.equal(report.signingKeyRecovered,false);assert.equal(posts(f).length,1);
  // Even if inventory later omits the endpoint, retained intent blocks a retry.
  f.state.registered=false;await assert.rejects(executeProductionWebhookRegistration(f.options));assert.equal(posts(f).length,1);
});

for(const postMode of ['rejected','html'])test(postMode+' error body is encrypted before failure and cannot produce a verified key',async t=>{
  const f=await fixture(t);f.state.postMode=postMode;
  await assert.rejects(executeProductionWebhookRegistration(f.options),/post_rejected_response_preserved/);
  const files=await readdir(f.options.directory);assert.ok(files.includes('stripe-registration-response.enc.json'));
  assert.ok(!files.includes('stripe-registration-verified.json'));
  for(const name of files)assert.ok(!(await readFile(join(f.options.directory,name),'utf8')).includes(f.secret));
});

test('provider inventories require full pagination and correct account',async()=>{
  let calls=0;
  await assert.rejects(collectProductionWebhookInventory({provider:'stripe',apiKey:'sk_live_fixture',fetchImpl:async()=>{
    calls++;return Response.json({id:'acct_other'});
  }}),/account_mismatch/);assert.equal(calls,1);
  await assert.rejects(collectProductionWebhookInventory({provider:'resend',apiKey:'re_fixture',fetchImpl:async()=>
    Response.json({has_more:true,data:[]})}),/inventory_invalid/);
});

test('G4 cannot register providers during private owner acceptance even if receipt_only remains selected',async t=>{
 const f=await fixture(t);f.state.settings.bindings.push({name:'PRODUCTION_OWNER_ACCEPTANCE_BACKEND',type:'plain_text',text:'owner-browser-v1'});
 f.options.gate.settingsSha256=sha256Hex(f.state.settings);
 await assert.rejects(executeProductionWebhookRegistration(f.options),/target_not_closed/);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
