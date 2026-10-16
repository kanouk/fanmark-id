import {createEmojiReleaseArtifacts} from '../../../scripts/build-emoji-release.ts';
const record={id:'00000000-0000-4000-8000-000000000001',emoji:'👨‍👩‍👦‍👦',short_name:'family',keywords:['family'],category:'People',subcategory:null,codepoints:['1F468','200D','1F469','200D','1F466','200D','1F466'],sort_order:1};
export default function setup({provide}) {
 const artifact=records=>{const r=createEmojiReleaseArtifacts(records);return {recordsSource:r.recordsSource,moduleSource:r.moduleSource,manifest:r.manifest};};
 provide('publicationArtifacts',{original:artifact([record]),updated:artifact([{...record,keywords:['family','release-check']}]),next:artifact([{...record,keywords:['family','release-next']}])});
}
