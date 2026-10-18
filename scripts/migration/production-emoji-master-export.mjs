#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import {exportEmojiMain,readProductionEmojiMaster} from './staging-emoji-master-export.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
function productionToken(){
 if(process.env.FANMARK_PRODUCTION_MASTER_READ_TOKEN)return process.env.FANMARK_PRODUCTION_MASTER_READ_TOKEN;
 const args=['auth','token','--profile','fanmark-staging-inapp','--json'];
 return JSON.parse(execFileSync(path.join(root,'workers/api/node_modules/.bin/wrangler'),args,
  {cwd:root,encoding:'utf8',timeout:60000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']})).token;
}
export function exportProductionEmojiMain(argv,dependencies={}){
 return exportEmojiMain(argv,{readSnapshot:readProductionEmojiMaster,readToken:productionToken,...dependencies});
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 process.umask(0o077);try{console.log(JSON.stringify(await exportProductionEmojiMain(process.argv.slice(2))));}
 catch{console.error('production_emoji_export_failed');process.exitCode=1;}
}
