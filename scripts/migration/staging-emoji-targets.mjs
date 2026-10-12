/** Known staging cohorts only. A resource reset never admits an arbitrary target. */
export const STAGING_EMOJI_PUBLICATION_TARGETS = Object.freeze([
  Object.freeze({name:'staging-v2',masterId:'02681378-5528-45a9-8093-76805a4705c9',masterName:'fanmark-recovery-staging-v2-e434eb11-master',scope:'8b4daf214a4e30a837e43387e18d00885dd0a0a563b213c5b736cd87edb84773',entrypoint:'EmojiMasterPublicationService'}),
  Object.freeze({name:'staging-v3',masterId:'8a52824c-4e9f-411c-95f9-5778b880604b',masterName:'fanmark-recovery-staging-v3-6a5d9114-master',scope:'aee5fcdc74c564c7358234aa0b8346e9b1a874d9bf5b215493ccb708e8a86392',entrypoint:'EmojiMasterPublicationServiceV3'}),
]);
export function resolveStagingEmojiTarget(masterId,scope) {
 const target=STAGING_EMOJI_PUBLICATION_TARGETS.find(x=>x.masterId===masterId&&x.scope===scope);
 if(!target)throw new Error('target_mismatch');
 return target;
}
