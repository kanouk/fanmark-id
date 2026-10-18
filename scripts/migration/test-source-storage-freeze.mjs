/** Isolated real Storage API at the observed production version; synthetic objects only. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHmac} from 'node:crypto';
import {SOURCE_FREEZE_INVENTORY_SQL,renderSourceDatabaseFreeze} from './source-database-freeze.mjs';
const PG='postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const STORAGE='supabase/storage-api:v1.80.2@sha256:95b217a9c59e0ac06c6dcb539df3189a1668a2445fb43dbf29660d6968ffd7d2';
test('Storage 1.80.2 rejects synthetic object mutations under the DB freeze and resumes exactly', {timeout:150000}, async t=>{
 const suffix=randomUUID(),network='fanmark-storage-test-'+suffix,pg='fanmark-storage-db-'+suffix,storage='fanmark-storage-api-'+suffix;
 const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
 const ids=[];let networkId;
 try{
  networkId=docker(['network','create','--internal','--label','fanmark.test=storage-freeze',network]);
  ids.push(docker(['run','--detach','--network',network,'--network-alias','database','--name',pg,'--label','fanmark.test=storage-freeze','-e','POSTGRES_PASSWORD=synthetic-local-only',PG]));
  const sql=text=>docker(['exec','-i',ids[0],'psql','-h','127.0.0.1','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],text);
  let ready=false;for(let i=0;i<80;i++){try{sql('SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert.ok(ready);
  sql(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE TABLE public.freeze_probe(id integer);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
  const secret='synthetic-storage-jwt-'+suffix;
  ids.push(docker(['run','--detach','--network',network,'--name',storage,'--label','fanmark.test=storage-freeze',
   '-e','SERVER_PORT=5000','-e','AUTH_JWT_SECRET='+secret,'-e','AUTH_JWT_ALGORITHM=HS256',
   '-e','DATABASE_URL=postgres://postgres:synthetic-local-only@database:5432/postgres','-e','DATABASE_POOL_URL=postgres://postgres:synthetic-local-only@database:5432/postgres',
   '-e','DB_INSTALL_ROLES=true','-e','STORAGE_BACKEND=file','-e','FILE_STORAGE_BACKEND_PATH=/var/lib/storage','-e','STORAGE_S3_BUCKET=synthetic-only',
   '-e','TENANT_ID=synthetic-only','-e','LOG_LEVEL=error','-e','UPLOAD_FILE_SIZE_LIMIT=1048576',STORAGE]));
  const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=encoded({alg:'HS256',typ:'JWT'})+'.'+encoded({role:'service_role',iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600});
  const token=unsigned+'.'+createHmac('sha256',secret).update(unsigned).digest('base64url');
  const request=async(path,{method='GET',body,headers={}}={})=>{
   const script="const request=JSON.parse(process.argv[1]); const response=await fetch('http://127.0.0.1:5000'+request.path,{...request.options,redirect:'error',signal:AbortSignal.timeout(15000)}); console.log(JSON.stringify({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()}));";
   const {stdout}=await promisify(execFile)('docker',['exec',ids[1],'node','--input-type=module','-e',script,JSON.stringify({path,options:{method,body,headers:{authorization:'Bearer '+token,...headers}}})],{encoding:'utf8',timeout:20000,maxBuffer:1048576});
   const response=JSON.parse(stdout);return new Response([204,205,304].includes(response.status)?null:response.body,{status:response.status,headers:response.headers});
  };
  ready=false;for(let i=0;i<100;i++){try{if((await request('/status')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}
  if(!ready){const log=docker(['logs',ids[1]]);throw Error('local_storage_not_ready: '+log.slice(-3500));}
  assert.equal(await (await request('/version')).text(),'1.80.2');
  const json=(body,method='POST')=>({method,body:JSON.stringify(body),headers:{'content-type':'application/json'}});
  let r=await request('/bucket',json({id:'freeze-fixture',name:'freeze-fixture',public:true}));assert.ok(r.ok,await r.text());
  const upload=(key,text,upsert=false)=>request('/object/freeze-fixture/'+key,{method:'POST',body:text,headers:{'content-type':'text/plain','x-upsert':String(upsert)}});
  r=await upload('original.txt','synthetic-original');assert.ok(r.ok,await r.text());
  const rows=()=>JSON.parse(sql("SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY name),'[]'::jsonb) FROM storage.objects o"));
  const before=rows(),relations=JSON.parse(sql(`SELECT jsonb_agg(to_jsonb(r)) FROM (${SOURCE_FREEZE_INVENTORY_SQL}) r`));
  const plan=renderSourceDatabaseFreeze({projectRef:'ppqgtbjykitqtiaisyji',runId:randomUUID(),relations});sql(plan.freezeSql);sql(plan.verifySql);
  await t.test('new upload, upsert, update, copy, move, delete and bucket update all refuse',async()=>{
   const cases=[['upload',()=>upload('new.txt','blocked')],['upsert',()=>upload('original.txt','blocked',true)],
    ['update',()=>request('/object/freeze-fixture/original.txt',{method:'PUT',body:'blocked',headers:{'content-type':'text/plain'}})],
    ['copy',()=>request('/object/copy',json({bucketId:'freeze-fixture',sourceKey:'original.txt',destinationKey:'copied.txt'}))],
    ['move',()=>request('/object/move',json({bucketId:'freeze-fixture',sourceKey:'original.txt',destinationKey:'moved.txt'}))],
    ['delete',()=>request('/object/freeze-fixture',json({prefixes:['original.txt']},'DELETE'))],
    ['bucket',()=>request('/bucket/freeze-fixture',json({public:false},'PUT'))]];
   for(const [name,run]of cases){const response=await run();assert.ok(response.status>=400,name+' must refuse');await response.body?.cancel();assert.deepEqual(rows(),before,name+' must preserve object metadata');}
  });
  await t.test('both public and authenticated reads preserve original bytes while frozen',async()=>{
   for(const path of ['/object/public/freeze-fixture/original.txt','/object/authenticated/freeze-fixture/original.txt']){const response=await request(path);assert.equal(response.status,200);assert.equal(await response.text(),'synthetic-original');}
   assert.deepEqual(rows(),before);
  });
  sql(plan.resumeSql);r=await upload('original.txt','synthetic-resumed',true);assert.ok(r.ok,await r.text());
  assert.equal(await (await request('/object/public/freeze-fixture/original.txt')).text(),'synthetic-resumed');
  await t.test('an already streaming overwrite cannot publish a new object version after freeze',async()=>{
   const files=()=>docker(['exec',ids[1],'sh','-c','find /var/lib/storage -type f | sort']);
   const priorFiles=files(),beforeStream=rows(),gate='/tmp/fanmark-release-'+randomUUID();
   const client=`import http from 'node:http';import fs from 'node:fs';
     const [token,gate]=JSON.parse(process.argv[1]);
     const request=http.request({hostname:'127.0.0.1',port:5000,path:'/object/freeze-fixture/original.txt',method:'POST',
       headers:{authorization:'Bearer '+token,'content-type':'application/octet-stream','content-length':131072,'x-upsert':'true'}},response=>{
       response.resume();response.on('end',()=>{console.log(JSON.stringify({status:response.statusCode}));process.exit(0);});
     });request.on('error',()=>process.exit(2));request.write(Buffer.alloc(65536,65));
     const timeout=setTimeout(()=>process.exit(3),30000);
     const interval=setInterval(()=>{if(fs.existsSync(gate)){clearInterval(interval);clearTimeout(timeout);request.end(Buffer.alloc(65536,66));}},50);`;
   const completion=promisify(execFile)('docker',['exec',ids[1],'node','--input-type=module','-e',client,JSON.stringify([token,gate])],{encoding:'utf8',timeout:35000,maxBuffer:1048576});
   // Attach the rejection handler immediately; the original result is awaited below.
   completion.catch(()=>{});
   let started=false;
   for(let i=0;i<60;i++){if(files()!==priorFiles){started=true;break;}await new Promise(r=>setTimeout(r,100));}
   const inFlightPlan=renderSourceDatabaseFreeze({projectRef:'ppqgtbjykitqtiaisyji',runId:randomUUID(),relations});
   try{
    assert.ok(started,'a new physical version must exist before freezing; a timeout is not proof');
    sql(inFlightPlan.freezeSql);sql(inFlightPlan.verifySql);
   }finally{docker(['exec',ids[1],'touch',gate]);}
   const response=JSON.parse((await completion).stdout);assert.ok(response.status>=400,'completion must refuse after freeze');
   assert.deepEqual(rows(),beforeStream);
   assert.equal(await (await request('/object/public/freeze-fixture/original.txt')).text(),'synthetic-resumed');
   sql(inFlightPlan.resumeSql);
  });
  await t.test('a resumable upload started before freeze cannot complete an overwrite while frozen',async()=>{
   const metadata=Object.entries({bucketName:'freeze-fixture',objectName:'original.txt',contentType:'text/plain'}).map(([key,value])=>key+' '+Buffer.from(value).toString('base64')).join(',');
   const created=await request('/upload/resumable',{method:'POST',headers:{'tus-resumable':'1.0.0','upload-length':'131072','upload-metadata':metadata,'x-upsert':'true'}});
   assert.equal(created.status,201,await created.text());
   const location=new URL(created.headers.get('location'),'http://127.0.0.1:5000').pathname;
   const patch=(offset)=>request(location,{method:'PATCH',body:'C'.repeat(65536),headers:{'tus-resumable':'1.0.0','upload-offset':String(offset),'content-type':'application/offset+octet-stream','x-upsert':'true'}});
   let response=await patch(0);assert.equal(response.status,204,await response.text());
   const beforeTus=rows(),tusPlan=renderSourceDatabaseFreeze({projectRef:'ppqgtbjykitqtiaisyji',runId:randomUUID(),relations});
   sql(tusPlan.freezeSql);sql(tusPlan.verifySql);
   response=await patch(65536);assert.ok(response.status>=400,'TUS completion must refuse under freeze');await response.body?.cancel();
   assert.deepEqual(rows(),beforeTus);
   assert.equal(await (await request('/object/public/freeze-fixture/original.txt')).text(),'synthetic-resumed');
   sql(tusPlan.resumeSql);
  });
  console.log(JSON.stringify({proof:'isolated-storage-freeze',storageVersion:'1.80.2',storageImage:STORAGE,postgresImage:PG,
   protectedTables:plan.protectedRelationCount,mutationsRejected:7,inFlightOverwriteRejected:true,resumableCompletionRejected:true,originalBytesPreserved:true,resumeVerified:true,
   sourceConnections:0,productionWrites:0,limitations:['local file backend; production S3 backend and S3 multipart uploads remain separate proof']}));
 }finally{
  for(const id of ids.reverse()){const info=JSON.parse(docker(['inspect',id]))[0];assert.equal(info.Config.Labels['fanmark.test'],'storage-freeze');docker(['rm','--force',id]);}
  if(networkId){const info=JSON.parse(docker(['network','inspect',networkId]))[0];assert.equal(info.Labels['fanmark.test'],'storage-freeze');docker(['network','rm',networkId]);}
 }
});
