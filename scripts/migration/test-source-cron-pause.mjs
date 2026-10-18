import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {SOURCE_CRON_INVENTORY_SQL,renderSourceCronPause} from './source-cron-pause.mjs';

test('source Cron pause and exact inverse on native pg_cron without direct table UPDATE permission', {timeout:60000},async t=>{
 const name='fanmark-cron-pause-'+randomUUID();let id;
 const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:20000,stdio:['pipe','pipe','pipe']}).trim();
 try {
  id=docker(['run','--detach','--network','none','--name',name,'--label','fanmark.test=source-cron-pause',
   '-e','POSTGRES_PASSWORD=synthetic-local-only','-e','POSTGRES_HOST_AUTH_METHOD=trust',
   'public.ecr.aws/supabase/postgres@sha256:80d7b27c3e8d77cfa7226eee9508671796da214781ff15a35b3670d7ad5ee453',
   'postgres','-c','shared_preload_libraries=pg_cron','-c','cron.database_name=postgres','-c','cron.host=127.0.0.1']);
  const deadline=Date.now()+20000;
  for(;;){try{docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}
   catch{if(Date.now()>deadline)throw Error('local_postgres_not_ready');await new Promise(r=>setTimeout(r,250));}}
  const sql=(text,{role='postgres',failure=false}={})=>{
   try {const out=execFileSync('docker',['exec','-i',id,'psql','-h','127.0.0.1','-U',role,'-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],
    {input:text,encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']}).trim();assert.equal(failure,false);return out;}
   catch(error){if(!failure||!error.status)throw error;return error.stderr;}
  };
  sql('CREATE EXTENSION pg_cron; GRANT EXECUTE ON FUNCTION cron.alter_job(bigint,text,text,text,text,boolean) TO postgres;',
    {role:'supabase_admin'});
  assert.equal(sql("SELECT has_table_privilege(current_user,'cron.job','UPDATE')"),'f');
  sql("SELECT cron.schedule('originally-active','0 0 1 1 *','SELECT 1'); SELECT cron.schedule('originally-inactive','0 0 1 1 *','SELECT 2'); SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='originally-inactive'),active:=false);");
  const inventory=()=>JSON.parse(sql(`SELECT json_agg(j) FROM (${SOURCE_CRON_INVENTORY_SQL}) j`));
  const original=inventory();
  const plan=()=>renderSourceCronPause({projectRef:'ppqgtbjykitqtiaisyji',runId:randomUUID(),jobs:original});
  await t.test('pause owns a durable marker and restore preserves inactive jobs and exact definitions',()=>{
   const p=plan();sql(p.pauseSql);sql(p.verifySql);
   assert.ok(inventory().every(row=>row.active===false));assert.equal(p.requiresSchedulerConfigurationFreeze,true);
   sql(p.resumeSql);assert.deepEqual(inventory(),original);
  });
  await t.test('new jobs and changed commands are rejected before any pause',()=>{
   const p=plan();sql("SELECT cron.schedule('unreviewed','0 0 1 1 *','SELECT 3')");
   assert.match(sql(p.pauseSql,{failure:true}),/source_cron_inventory_changed/);
   assert.equal(inventory().find(row=>row.jobname==='originally-active').active,true);
   sql("SELECT cron.unschedule('unreviewed')");
   sql(`SELECT cron.alter_job(${original[0].id}::bigint,command:='SELECT 99')`);
   assert.match(sql(p.pauseSql,{failure:true}),/source_cron_inventory_changed/);
   sql(`SELECT cron.alter_job(${original[0].id}::bigint,command:='SELECT 1')`);
  });
  await t.test('wrong inverse or a changed schedule cannot enable any job',()=>{
   const p=plan();sql(p.pauseSql);
   assert.match(sql(plan().resumeSql,{failure:true}),/does not exist/);
   sql(`SELECT cron.alter_job(${original[0].id}::bigint,schedule:='0 1 1 1 *')`);
   assert.match(sql(p.resumeSql,{failure:true}),/source_cron_inventory_changed/);
   assert.ok(inventory().every(row=>row.active===false));
   sql(`SELECT cron.alter_job(${original[0].id}::bigint,schedule:='0 0 1 1 *')`);sql(p.resumeSql);
   assert.deepEqual(inventory(),original);
  });
  await t.test('foreign project, malformed IDs, duplicated rows and unknown active states are rejected',()=>{
   for(const override of [{projectRef:'foreign'},{runId:'bad'},{jobs:[...original,original[0]]},
    {jobs:[{...original[0],id:'1;SELECT 2'}]},{jobs:[{...original[0],active:'true'}]}]){
    assert.throws(()=>renderSourceCronPause({projectRef:'ppqgtbjykitqtiaisyji',runId:randomUUID(),jobs:original,...override}),/source_cron_/);
   }
  });
 }finally{if(id){const info=JSON.parse(docker(['inspect',id]))[0];assert.equal(info.Name,'/'+name);
  assert.equal(info.Config.Labels['fanmark.test'],'source-cron-pause');docker(['rm','--force',id]);}}
});
