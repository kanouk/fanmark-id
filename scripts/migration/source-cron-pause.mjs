/** SQL-only pg_cron pause/restore. Running Edge/network effects drain separately. */
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const HASH=/^[a-f0-9]{64}$/u;
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const sha=value=>createHash('sha256').update(value).digest('hex');
export const SOURCE_CRON_INVENTORY_SQL=`SELECT jobid::text AS id,schedule,nodename,nodeport,database,username,active,jobname,
encode(sha256(convert_to(command,'UTF8')),'hex') AS command_sha256 FROM cron.job ORDER BY jobid`;
export function renderSourceCronPause({projectRef,runId,jobs}) {
 if(projectRef!=='ppqgtbjykitqtiaisyji'||!UUID.test(runId??'')||!Array.isArray(jobs)||jobs.length>100)throw Error('source_cron_identity_invalid');
 const normalized=jobs.map(row=>{
  if(!row||!/^[1-9][0-9]{0,14}$/u.test(row.id??'')||!Number.isSafeInteger(Number(row.id))||typeof row.active!=='boolean'||
    !Number.isInteger(row.nodeport)||row.nodeport<1||row.nodeport>65535||!HASH.test(row.command_sha256??'')||
    !['schedule','nodename','database','username'].every(k=>typeof row[k]==='string'&&row[k].length>0&&row[k].length<=1000)||
    !(row.jobname===null||(typeof row.jobname==='string'&&row.jobname.length<=1000)))throw Error('source_cron_job_invalid');
  return Object.fromEntries(['id','schedule','nodename','nodeport','database','username','active','jobname','command_sha256'].map(k=>[k,row[k]]));
 }).sort((a,b)=>Number(a.id)-Number(b.id));
 if(new Set(normalized.map(row=>row.id)).size!==normalized.length)throw Error('source_cron_duplicate_job');
 const frozen=normalized.map(row=>({...row,active:false}));
 const inventorySha256=sha(JSON.stringify(normalized));
 const scope='fanmark_cron_pause_'+runId.replaceAll('-','');
 // Do not require direct UPDATE on the managed cron.job table. Use
 // cron.alter_job for owner-authorized changes. The ACCESS SHARE lock
 // protects the relation from DDL, not concurrent administrator rescheduling.
 const start=`BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='30s';\nSET LOCAL row_security=off;\nLOCK TABLE cron.job IN ACCESS SHARE MODE;\n`;
 const check=rows=>`DO $inventory$ BEGIN IF (SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY j.id::bigint),'[]'::jsonb)
FROM (${SOURCE_CRON_INVENTORY_SQL}) j) <> ${literal(JSON.stringify(rows))}::jsonb THEN
RAISE EXCEPTION 'source_cron_inventory_changed'; END IF; END $inventory$;\n`;
 const marker=`DO $marker$ BEGIN IF (SELECT count(*) FROM ${scope}.identity)<>1 OR NOT EXISTS
(SELECT 1 FROM ${scope}.identity WHERE run_id=${literal(runId)} AND inventory_sha256=${literal(inventorySha256)})
THEN RAISE EXCEPTION 'source_cron_pause_identity_changed'; END IF; END $marker$;\n`;
 const pauseSql=start+check(normalized)+`CREATE SCHEMA ${scope};\nREVOKE ALL ON SCHEMA ${scope} FROM PUBLIC;\n`+
  `CREATE TABLE ${scope}.identity(run_id text PRIMARY KEY,inventory_sha256 text NOT NULL);\n`+
  `INSERT INTO ${scope}.identity VALUES(${literal(runId)},${literal(inventorySha256)});\n`+
  normalized.filter(row=>row.active).map(row=>`SELECT cron.alter_job(${row.id}::bigint,active:=false);`).join('\n')+'\n'+check(frozen)+'COMMIT;\n';
 const verifySql=start+marker+check(frozen)+'COMMIT;\n';
 const resumeSql=start+marker+check(frozen)+normalized.filter(row=>row.active)
  .map(row=>`SELECT cron.alter_job(${row.id}::bigint,active:=true);`).join('\n')+'\n'+check(normalized)+
  `DROP TABLE ${scope}.identity;\nDROP SCHEMA ${scope};\nCOMMIT;\n`;
 return Object.freeze({projectRef,runId,jobCount:normalized.length,activeJobCount:normalized.filter(row=>row.active).length,
  inventorySha256,pauseSql,verifySql,resumeSql,pauseSha256:sha(pauseSql),resumeSha256:sha(resumeSql),
  sourceChanged:false,requiresSchedulerConfigurationFreeze:true,runningJobsDrained:false,edgeEffectsDrained:false,productionReady:false});
}
