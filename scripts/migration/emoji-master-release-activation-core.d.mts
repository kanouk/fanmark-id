import type { VerifiedEmojiArtifact } from "../../workers/api/src/emoji-release-artifact.ts";
type Rebuild = (records:unknown,manifest:unknown)=>Promise<VerifiedEmojiArtifact>;
export class EmojiMasterReleaseActivationError extends Error { code: string }
export function activateVerifiedEmojiMasterRelease(options: {database:D1Database;artifact:VerifiedEmojiArtifact;rebuild:Rebuild;action?:"promotion"|"rollback";expectedCurrentVersion?:string|null;expectedCurrentGeneration?:number;activationId?:string}): Promise<{version:string;previousVersion:string|null;generation:number;changed:boolean}>;
export function readVerifiedEmojiMasterActiveRelease(database:D1Database,rebuild:Rebuild): Promise<{version:string;generation:number;updatedAt:string;records:unknown[];manifest:unknown}|null>;
