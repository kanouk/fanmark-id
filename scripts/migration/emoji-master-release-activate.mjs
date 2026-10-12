import { randomUUID } from "node:crypto";
import { createEmojiReleaseArtifacts, verifyRelease } from "../build-emoji-release.ts";

import { activateVerifiedEmojiMasterRelease, readVerifiedEmojiMasterActiveRelease, EmojiMasterReleaseActivationError } from "./emoji-master-release-activation-core.mjs";
export { EmojiMasterReleaseActivationError } from "./emoji-master-release-activation-core.mjs";

const rebuild = records => createEmojiReleaseArtifacts(records);
export async function activateEmojiMasterRelease(options) {
  const artifact = await verifyRelease(options.releaseDirectory).catch(() => { throw new EmojiMasterReleaseActivationError("release_artifact_invalid"); });
  return activateVerifiedEmojiMasterRelease({...options,artifact,rebuild});
}
export function readEmojiMasterActiveRelease(database) {
  return readVerifiedEmojiMasterActiveRelease(database,rebuild);
}
