import { promises as fs } from "node:fs";
import path from "node:path";
import { verifyRelease } from "../build-emoji-release.ts";

import { stageVerifiedEmojiMasterRelease, EmojiMasterReleaseStageError } from "./emoji-master-release-stage-core.mjs";
export { EMOJI_MASTER_RELEASE_TABLES, EmojiMasterReleaseStageError } from "./emoji-master-release-stage-core.mjs";

export async function stageEmojiMasterRelease(options) {
  if (!options.database || typeof options.database.prepare !== "function" || typeof options.database.batch !== "function") throw new EmojiMasterReleaseStageError("d1_binding_required");
  if (typeof options.releaseDirectory !== "string" || !options.releaseDirectory) throw new EmojiMasterReleaseStageError("release_directory_required");
  const verified = await verifyRelease(options.releaseDirectory).catch(() => { throw new EmojiMasterReleaseStageError("release_verification_failed"); });
  const manifest = JSON.parse(await fs.readFile(path.join(options.releaseDirectory, "manifest.json"), "utf8"));
  return stageVerifiedEmojiMasterRelease({...options,artifact:{...verified,manifest}});
}
