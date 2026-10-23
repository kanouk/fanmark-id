import {
  DICTIONARY_VERSION,
  DICTIONARY_URL,
} from "../../../shared/emoji-palette/version";
import type { Dictionary } from "../../../shared/emoji-palette/search";
let pending: Promise<Dictionary> | undefined;
export function loadPaletteDictionary(): Promise<Dictionary> {
  if (!pending)
    pending = (async () => {
      const r = await fetch(DICTIONARY_URL, {
        signal: AbortSignal.timeout(12000),
        credentials: "omit",
      });
      if (!r.ok) throw new Error("dictionary_unavailable");
      const buffer = await r.arrayBuffer();
      if (buffer.byteLength > 4_000_000)
        throw new Error("dictionary_too_large");
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (digest !== DICTIONARY_VERSION) throw new Error("dictionary_invalid");
      return JSON.parse(new TextDecoder().decode(buffer)) as Dictionary;
    })().catch((error) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
