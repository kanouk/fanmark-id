import { useEffect, useState } from "react";
import {
  DICTIONARY_VERSION,
  PALETTE_SCHEMA_VERSION,
  NORMALIZATION_VERSION,
} from "../../../shared/emoji-palette/version";
type State = {
  key: string;
  status: "idle" | "loading" | "ready" | "error";
  ids: string[];
};
const empty: State = { key: "", status: "idle", ids: [] };
export function useJevSearch(
  query: string,
  category: string,
  variants: boolean,
  enabled: boolean,
  composing: boolean,
  catalogVersion: string,
  validIds: ReadonlySet<string>,
) {
  const [state, setState] = useState<State>(empty);
  const key = JSON.stringify({
    query: query.trim(),
    category,
    variants,
    catalogVersion,
    dictionaryVersion: DICTIONARY_VERSION,
    schemaVersion: PALETTE_SCHEMA_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
  });
  const eligible =
    enabled &&
    !composing &&
    [...query.trim()].length >= 2 &&
    [...query].length <= 160 &&
    !!catalogVersion;
  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    let disposed = false;
    const timer = window.setTimeout(async () => {
      const deadline = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch("/api/emoji/palette/search", {
          method: "POST",
          credentials: "omit",
          headers: {
            "content-type": "application/json",
            "x-fanmark-palette": "1",
          },
          body: key,
          signal: controller.signal,
        });
        const result = await response.json();
        if (
          !response.ok ||
          result.catalogVersion !== catalogVersion ||
          result.dictionaryVersion !== DICTIONARY_VERSION ||
          result.schemaVersion !== PALETTE_SCHEMA_VERSION ||
          result.normalizationVersion !== NORMALIZATION_VERSION ||
          !Array.isArray(result.ids) ||
          result.ids.length > 12 ||
          new Set(result.ids).size !== result.ids.length ||
          !result.ids.every(
            (id: unknown) => typeof id === "string" && validIds.has(id),
          )
        )
          throw new Error("unavailable");
        if (!disposed) setState({ key, status: "ready", ids: result.ids });
      } catch {
        if (!disposed) setState({ key, status: "error", ids: [] });
      } finally {
        clearTimeout(deadline);
      }
    }, 350);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, eligible, catalogVersion, validIds]);
  if (!eligible) return empty;
  return state.key === key
    ? state
    : { ...empty, key, status: "loading" as const };
}
