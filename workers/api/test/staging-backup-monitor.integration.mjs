import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const sha = value => createHash('sha256').update(value).digest('hex');
const ids = { auth:'monitor-fixture-auth',business:'monitor-fixture-business',master:'monitor-fixture-master',
  avatars:'monitor-fixture-avatars',covers:'monitor-fixture-covers' };
const names={AUTH_DB:ids.auth,AVATARS_BUCKET:ids.avatars,COVER_IMAGES_BUCKET:ids.covers,FANMARK_DB:ids.business,MASTER_DB:ids.master};
const scope=sha(JSON.stringify({account:'bfc2890741f0b3fb236e2d755b6c9adc',worker:'fanmark-app-staging',
  stores:Object.entries(names).map(([binding,value])=>binding.endsWith('_DB')?{type:'d1',binding,id:value}:{type:'r2',binding,name:value})}));
const schemas={auth:'a'.repeat(64),business:'b'.repeat(64),master:'c'.repeat(64)};
const today=new Date().toISOString().slice(0,10), midnight=Date.parse(today+'T00:00:00Z');
const now=midnight+40*60_000, keyId='monitor-fixture-key';

test('independent native monitor detects missing, failed, stale and incomplete retention; alert RPC does not replay unknown ACKs',async t=>{
  const compiled=await build({entryPoints:[fileURLToPath(new URL('./staging-backup-monitor-harness.ts',import.meta.url))],bundle:true,
    write:false,format:'esm',platform:'browser',target:'es2022',conditions:['workerd'],external:['cloudflare:*']});
  const vars={STAGING_BACKUP_SOURCE_IDS:JSON.stringify(ids),STAGING_BACKUP_SCHEMA_HASHES:JSON.stringify(schemas),
    STAGING_BACKUP_KEY_ID:keyId,RECOVERY_DRAIN_SCOPE_DIGEST:scope,STAGING_BACKUP_ALERT_BACKEND:'resend-v1',
    STAGING_BACKUP_ALERT_TO:'fanmark.id+staging-test05@gmail.com',RESEND_API_KEY:'fixture-not-a-real-secret',
    RESEND_FROM_EMAIL:'fanmark.id staging <no-reply@fanmark.id>'};
  const sends=[];let providerMode='ok';
  const mf=new Miniflare({workers:[{config:{name:'monitor-native-fixture',type:'worker',compatibilityDate:'2026-09-18',
    env:{...Object.fromEntries(Object.entries(vars).map(([name,value])=>[name,{type:'text',value}])),
      STAGING_BACKUP_BUCKET:{type:'r2',name:'isolated-monitor-control'},
      SERVICE:{type:'worker',worker:'monitor-native-fixture',exportName:'StagingBackupService'},
      BACKUP_ALERT_SERVICE:{type:'worker',worker:'monitor-native-fixture',exportName:'StagingBackupService'}},
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:compiled.outputFiles[0].text}}}},
    dev:{outboundService:{type:'fetcher',async handler(request){
      assert.equal(request.url,'https://api.resend.com/emails');assert.equal(request.method,'POST');
      const body=await request.json();sends.push(body);
      assert.equal(body.to.length,1);assert.equal(body.to[0],vars.STAGING_BACKUP_ALERT_TO);
      assert.ok(!JSON.stringify(body).includes(vars.RESEND_API_KEY));
      if(providerMode==='lost-ack')throw new Error('fixture-private-provider-error');
      return Response.json({id:randomUUID()});
    }}}}]});
  const request=async(path,extra={},status=200)=>{const response=await mf.dispatchFetch('https://fixture.local',
    {method:'POST',body:JSON.stringify({path,now,...extra})});const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;};
  const bucket=await mf.getR2Bucket('STAGING_BACKUP_BUCKET'), receiptKey=slot=>'recovery/v1/runs/'+slot+'.json';
  const owner=randomUUID(), archive='fixture encrypted archive';
  const receipt={format:'fanmark-staging-backup-receipt-v1',slot:today,owner,state:'verified',
    startedAt:new Date(midnight+5*60_000).toISOString(),finishedAt:new Date(midnight+6*60_000).toISOString(),runtimeRevision:'fixture-runtime',
    keyId,sourceIds:ids,schemaHashes:schemas,objectKey:`recovery/v1/archives/${today}/${owner}.json`,archiveHash:sha(archive),
    bytes:Buffer.byteLength(archive),captureId:randomUUID(),fenceReleased:true,
    retention:{days:30,deleted:0,finishedAt:new Date(midnight+7*60_000).toISOString()}};
  const seed=async(value=receipt)=>bucket.put(receiptKey(today),JSON.stringify(value));
  const alert=code=>({slot:today,scope,code});
  try{
    await t.test('missing receipt is detected; disabled and wrong Cron never notify',async()=>{
      assert.deepEqual(await request('inspect'),{slot:today,code:'backup-missing'});
      assert.deepEqual(await request('monitor',{mode:'disabled'},409),{error:'staging_backup_monitor_disabled'});
      assert.deepEqual(await request('monitor',{mode:'wrong-cron'},409),{error:'staging_backup_monitor_cron_invalid'});
      assert.equal(sends.length,0);
    });
    await t.test('healthy receipt requires private archive HEAD and settled retention, without email',async()=>{
      await seed();await bucket.put(receipt.objectKey,archive);
      assert.deepEqual(await request('inspect'),{slot:today,code:null});
      // The default monitor clock is real wall-clock time, rather than the potentially delayed event timestamp.
      const expected=new Date().getUTCHours()===0 && new Date().getUTCMinutes()<35 ? 'backup-missing' : null;
      if(expected===null)assert.deepEqual(await request('monitor'),{healthy:true});
      assert.equal(sends.length,0);
    });
    await t.test('source/schema identity, released fence, archive existence/size and retention are independently checked',async()=>{
      for(const [patch,code] of [[{state:'failed'},'backup-failed'],[{state:'collecting'},'backup-incomplete'],
        [{sourceIds:{...ids,auth:'unowned'}},'backup-invalid'],[{schemaHashes:{...schemas,auth:'d'.repeat(64)}},'backup-invalid'],
        [{fenceReleased:false},'backup-invalid'],[{retention:undefined},'retention-failed'],
        [{retention:{days:30,deleted:-1,finishedAt:receipt.finishedAt}},'retention-failed'],[{bytes:receipt.bytes+1},'archive-missing']]){
        await seed({...receipt,...patch});assert.equal((await request('inspect')).code,code);
      }
      await seed();await bucket.delete(receipt.objectKey);assert.equal((await request('inspect')).code,'archive-missing');
      await bucket.put(receipt.objectKey,archive);
    });
    await t.test('the thirty-minute boundary and RPO age use UTC dates',async()=>{
      const yesterday=new Date(midnight-86400000).toISOString().slice(0,10), priorOwner=randomUUID();
      const prior={...receipt,slot:yesterday,owner:priorOwner,startedAt:yesterday+'T00:05:00.000Z',finishedAt:yesterday+'T00:06:00.000Z',
        objectKey:`recovery/v1/archives/${yesterday}/${priorOwner}.json`,retention:{days:30,deleted:0,finishedAt:yesterday+'T00:07:00.000Z'}};
      await bucket.put(receiptKey(yesterday),JSON.stringify(prior));
      assert.deepEqual(await request('inspect',{now:midnight+34*60_000}),{slot:yesterday,code:'backup-stale'});
      assert.deepEqual(await request('inspect',{now:midnight+35*60_000}),{slot:today,code:null});
    });
    await t.test('one accepted alert per slot/code, with fixed recipient and no provider response/keys in its body',async()=>{
      const first=await request('alert',{alert:alert('backup-failed')});assert.equal(first.state,'provider-accepted');assert.equal(first.duplicate,false);
      const count=sends.length;const second=await request('alert',{alert:alert('backup-failed')});
      assert.equal(second.duplicate,true);assert.equal(second.providerId,first.providerId);assert.equal(sends.length,count);
      assert.equal((await request('alert',{alert:{...alert('backup-failed'),scope:'a'.repeat(64)}},409)).error,'staging_backup_alert_identity_invalid');
      assert.equal((await request('alert',{alert:{...alert('backup-failed'),code:'provider-secret'}},409)).error,'staging_backup_alert_identity_invalid');
      assert.equal(sends.length,count);
    });
    await t.test('lost conditional-claim ACK remains claimed and never reaches the provider',async()=>{
      const count=sends.length;
      assert.equal((await request('claim-ack-loss',{alert:alert('monitor-read-failed')},409)).error,'staging_backup_alert_claim_unknown');
      assert.equal((await request('alert',{alert:alert('monitor-read-failed')},409)).error,'staging_backup_alert_requires_inspection');
      assert.equal(sends.length,count);
    });
    await t.test('lost provider ACK is redacted, retained, and never automatically resent',async()=>{
      providerMode='lost-ack';const count=sends.length;
      assert.equal((await request('alert',{alert:alert('delivery-test')},409)).error,'staging_backup_alert_provider_unknown_or_failed');
      assert.equal(sends.length,count+1);
      assert.equal((await request('alert',{alert:alert('delivery-test')},409)).error,'staging_backup_alert_requires_inspection');
      assert.equal(sends.length,count+1);providerMode='ok';
    });
    await t.test('retention failure remains a failed scheduler even when immediate notification also fails',async()=>{
      assert.deepEqual(await request('scheduler'),{calls:['run','prune','retention-failed'],error:'staging_retention_failed'});
      const count=sends.length;await seed({...receipt,retention:undefined});
      const expected=new Date().getUTCHours()===0 && new Date().getUTCMinutes()<35 ? 'backup-stale' : 'retention-failed';
      assert.deepEqual(await request('monitor',{},409),{error:'staging_backup_monitor_unhealthy'});
      assert.ok(sends.at(-1).text.includes(expected));assert.equal(sends.length,count+1);
      await request('monitor',{},409);assert.equal(sends.length,count+1);
    });
  }finally{await mf.dispose();}
});

test('backup monitor candidate pins the active stores and has no source DB, image bucket or decryption secret binding',()=>{
  const config=name=>JSON.parse(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
  const main=config('wrangler.app-staging.jsonc'), monitor=config('wrangler.backup-monitor-staging.jsonc');
  for(const key of ['RECOVERY_DRAIN_SCOPE_DIGEST','STAGING_BACKUP_SOURCE_IDS','STAGING_BACKUP_SCHEMA_HASHES','STAGING_BACKUP_KEY_ID'])
    assert.equal(monitor.vars[key],main.vars[key]);
  assert.equal(monitor.workers_dev,false);assert.equal(monitor.preview_urls,false);
  assert.equal(monitor.d1_databases,undefined);assert.equal(monitor.durable_objects,undefined);
  assert.equal(monitor.vars.STAGING_BACKUP_KEY,undefined);assert.equal(monitor.vars.BETTER_AUTH_SECRET,undefined);
  assert.deepEqual(monitor.r2_buckets,[{binding:'STAGING_BACKUP_BUCKET',bucket_name:'fanmark-backups-staging'}]);
  assert.deepEqual(monitor.services,[{binding:'BACKUP_ALERT_SERVICE',service:'fanmark-app-staging',entrypoint:'StagingBackupService'}]);
  assert.ok(['disabled','hourly-v1'].includes(monitor.vars.STAGING_BACKUP_MONITOR));
  assert.deepEqual(monitor.triggers.crons,monitor.vars.STAGING_BACKUP_MONITOR==='disabled'?[]:['35 * * * *']);
});
