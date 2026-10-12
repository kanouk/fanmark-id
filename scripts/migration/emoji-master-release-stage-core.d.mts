import type { VerifiedEmojiArtifact } from "../../workers/api/src/emoji-release-artifact.ts";
export class EmojiMasterReleaseStageError extends Error { code: string }
export function stageVerifiedEmojiMasterRelease(options: {database: D1Database; artifact: VerifiedEmojiArtifact; maxRowsPerBatch?: number; hooks?: {afterBatch?: (value: {batchNumber:number;rowsStaged:number})=>Promise<void>}}): Promise<{version:string;recordCount:number;status:string;reused:boolean}>;
