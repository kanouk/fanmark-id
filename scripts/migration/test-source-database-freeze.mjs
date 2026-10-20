import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { renderSourceDatabaseFreeze } from './source-database-freeze.mjs';

const relations = ['auth','public','storage'].map(schema => ({ schema, name: 'items', kind: 'r', partition: false, owner_role_available: true, trigger_privilege: true }));
const plan = () => renderSourceDatabaseFreeze({ projectRef: 'ppqgtbjykitqtiaisyji', runId: randomUUID(), relations });

test('source freeze refuses foreign source, duplicate/missing schemas and unsupported relations', () => {
  for (const change of [
    { projectRef: 'foreign' }, { runId: 'not-a-uuid' }, { relations: relations.slice(1) },
    { relations: [...relations, relations[0]] }, { relations: [{...relations[0],name:'items; DROP SCHEMA auth'}, ...relations.slice(1)] },
    { relations: [{...relations[0],kind:'p'}, ...relations.slice(1)] },
    { relations: [{...relations[0],partition:true}, ...relations.slice(1)] },
  ]) assert.throws(() => renderSourceDatabaseFreeze({ projectRef:'ppqgtbjykitqtiaisyji',runId:randomUUID(),relations,...change }), /source_freeze_/);
});

test('source freeze and inverse on isolated PostgreSQL 17; no ports or production connections', { timeout: 60000 }, async context => {
  const name = 'fanmark-source-freeze-test-' + randomUUID();
  const docker = args => execFileSync('docker', args, { encoding:'utf8', timeout:20000, stdio:['pipe','pipe','pipe'] }).trim();
  let id;
  try {
    id = docker(['run','--detach','--network','none','--name',name,'--label','fanmark.test=source-freeze',
      '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94']);
    const sql = (text, success = true) => {
      try {
        const output = execFileSync('docker',['exec','-i',id,'psql','-h','127.0.0.1','-U','postgres','-d','postgres','-XqAt','-v','ON_ERROR_STOP=1'],
          { input:text, encoding:'utf8', timeout:15000, stdio:['pipe','pipe','pipe'] });
        assert.equal(success,true,'SQL unexpectedly succeeded'); return output.trim();
      } catch(error) {
        if (success || !error.status) throw error;
        return error.stderr;
      }
    };
    const deadline = Date.now()+20000;
    while (true) {
      try { docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres']); break; }
      catch { if(Date.now()>deadline)throw Error('local_postgres_not_ready'); await new Promise(resolve=>setTimeout(resolve,250)); }
    }
    sql(`CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE ROLE app_actor; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.items(id integer primary key, value text); CREATE TABLE auth.items(LIKE public.items INCLUDING ALL); CREATE TABLE storage.items(LIKE public.items INCLUDING ALL);
GRANT USAGE ON SCHEMA public,auth,storage TO app_actor,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public,auth,storage TO app_actor,service_role;
INSERT INTO public.items VALUES(1,'before'); INSERT INTO auth.items VALUES(1,'before'); INSERT INTO storage.items VALUES(1,'before');`);
    await context.test('all SQL writers, zero-row operations, TRUNCATE and replica mode stop; reads remain', () => {
      const p=plan();sql(p.freezeSql);sql(p.verifySql);
      for(const schema of ['public','auth','storage']) {
        for(const role of ['app_actor','service_role','postgres']) {
          for(const command of [`INSERT INTO ${schema}.items VALUES(2,'blocked')`,`UPDATE ${schema}.items SET value='blocked' WHERE id=1`,
            `DELETE FROM ${schema}.items WHERE false`,`TRUNCATE ${schema}.items`]) {
            assert.match(sql(`SET ROLE ${role}; ${command}`,false),/fanmark_source_write_frozen/);
          }
        }
        assert.match(sql(`SET session_replication_role=replica; INSERT INTO ${schema}.items VALUES(2,'blocked')`,false),/fanmark_source_write_frozen/);
        assert.equal(sql(`SELECT value FROM ${schema}.items WHERE id=1`),'before');
      }
      sql(p.resumeSql);
      sql(`SET ROLE app_actor; INSERT INTO public.items VALUES(2,'after');`);
      assert.equal(sql('SELECT value FROM public.items WHERE id=2'),'after');
    });
    await context.test('an incomplete inventory refuses before installing anything', () => {
      const p=plan();sql('CREATE TABLE public.unreviewed(id integer)');
      assert.match(sql(p.freezeSql,false),/source_freeze_inventory_changed/);
      assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname='fanmark_cutover_block'"),'0');
      sql('DROP TABLE public.unreviewed');
    });
    await context.test('wrong inverse and altered guard are rejected without partial unfreeze', () => {
      const p=plan();sql(p.freezeSql);
      assert.match(sql(plan().resumeSql,false),/source_freeze_function_mismatch/);
      sql('ALTER TABLE auth.items DISABLE TRIGGER fanmark_cutover_block');
      assert.match(sql(p.resumeSql,false),/source_freeze_trigger_mismatch/);
      assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname='fanmark_cutover_block'"),'3');
      sql('ALTER TABLE auth.items ENABLE ALWAYS TRIGGER fanmark_cutover_block');sql(p.resumeSql);
    });
    await context.test('non-owner with TRIGGER grants can freeze and use the exact function inverse', () => {
      sql('GRANT CREATE ON DATABASE postgres TO app_actor');
      const p=renderSourceDatabaseFreeze({projectRef:'ppqgtbjykitqtiaisyji',runId:randomUUID(),
        relations:relations.map(row=>({...row,owner_role_available:false}))});
      assert.equal(p.requiresOriginReplicationRole,true);
      sql('SET ROLE app_actor; '+p.freezeSql);
      assert.match(sql("SET ROLE service_role; INSERT INTO auth.items VALUES(8,'blocked')",false),/fanmark_source_write_frozen/);
      sql('SET ROLE app_actor; '+p.verifySql);
      sql('SET ROLE app_actor; '+p.resumeSql);
      sql("SET ROLE service_role; INSERT INTO auth.items VALUES(8,'resumed')");
    });
    await context.test('lock timeout rolls back all changes and leaves the previous writer intact', async () => {
      const child=spawn('docker',['exec','-i',id,'psql','-h','127.0.0.1','-U','postgres','-XqAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
      const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('fixture_writer_failed')));});
      child.stdin.end("BEGIN; LOCK TABLE auth.items IN ACCESS EXCLUSIVE MODE; SELECT 'LOCKED'; SELECT pg_sleep(7); INSERT INTO auth.items VALUES(3,'finished'); COMMIT;");
      await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
      assert.match(sql(plan().freezeSql,false),/lock timeout/);
      await done;
      assert.equal(sql("SELECT value FROM auth.items WHERE id=3"),'finished');
      assert.equal(sql("SELECT count(*) FROM pg_trigger WHERE tgname='fanmark_cutover_block'"),'0');
    });
  } finally {
    if(id) {
      const info=JSON.parse(docker(['inspect',id]))[0];
      assert.equal(info.Name,'/'+name);assert.equal(info.Config.Labels['fanmark.test'],'source-freeze');
      docker(['rm','--force',id]);
    }
  }
});
