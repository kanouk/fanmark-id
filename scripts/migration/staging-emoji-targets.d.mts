export interface StagingEmojiTarget {readonly name:'staging-v2'|'staging-v3';readonly masterId:string;readonly masterName:string;readonly scope:string;readonly entrypoint:'EmojiMasterPublicationService'|'EmojiMasterPublicationServiceV3';}
export const STAGING_EMOJI_PUBLICATION_TARGETS:readonly StagingEmojiTarget[];
export function resolveStagingEmojiTarget(masterId:unknown,scope:unknown):StagingEmojiTarget;
