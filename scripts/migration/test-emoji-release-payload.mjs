import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createEmojiReleaseArtifacts} from '../build-emoji-release.ts';
import {verifyEmojiReleasePayload,canonicalReleaseValue} from '../../workers/api/src/emoji-release-artifact.ts';
const records=[{id:'00000000-0000-4000-8000-000000000001',emoji:'👨‍👩‍👦‍👦',short_name:'family',keywords:['family'],category:'People',subcategory:null,codepoints:['1F468','200D','1F469','200D','1F466','200D','1F466'],sort_order:1}];
const payload=()=>{const r=createEmojiReleaseArtifacts(records);return {recordsSource:r.recordsSource,moduleSource:r.moduleSource,manifest:r.manifest};};
const sha=s=>createHash('sha256').update(s).digest('hex');
function rehashModule(p){p.manifest.moduleSHA256=sha(p.moduleSource);const{version,...body}=p.manifest;p.manifest.version=sha(canonicalReleaseValue(body));return p;}
test('accepts the real producer bytes, including valid repeated codepoints',async()=>{
 const p=payload();assert.equal((await verifyEmojiReleasePayload(p)).version,p.manifest.version);
});
test('rejects altered records and mixed manifest/module files',async()=>{
 const p=payload();await assert.rejects(verifyEmojiReleasePayload({...p,recordsSource:p.recordsSource.replace('family','altered')}));
 await assert.rejects(verifyEmojiReleasePayload({...p,moduleSource:p.moduleSource+'\n'}));
 await assert.rejects(verifyEmojiReleasePayload({...p,manifest:{...p.manifest,identitySHA256:'0'.repeat(64)}}));
});
test('a coherent rehash cannot conceal a module with different semantics or executable suffix',async()=>{
 const p=payload();p.moduleSource=p.moduleSource.replace('"shortName": "family"','"shortName": "forged"');
 await assert.rejects(verifyEmojiReleasePayload(rehashModule(p)));
 const q=payload();q.moduleSource+='throw new Error("must never execute");\n';await assert.rejects(verifyEmojiReleasePayload(rehashModule(q)));
});
test('rejects malformed codepoints, duplicate lookups, extra fields and malformed grammar before publication',async()=>{
 const p=payload();await assert.rejects(verifyEmojiReleasePayload({...p,unexpected:true}));
 const reversed=records.map(r=>({...r,codepoints:[...r.codepoints].reverse()}));const built=createEmojiReleaseArtifacts(reversed);
 await assert.rejects(verifyEmojiReleasePayload({recordsSource:built.recordsSource,moduleSource:built.moduleSource,manifest:built.manifest}));
 const q=payload();q.moduleSource=q.moduleSource.replace('Record<string, string>','unknown');await assert.rejects(verifyEmojiReleasePayload(rehashModule(q)));
});
