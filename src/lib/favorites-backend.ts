import { supabase } from "@/integrations/supabase/client";
import {
  addWorkerFavoriteFanmark,
  getFavoritesBackend,
  loadWorkerFavoriteFanmarkRows,
  removeWorkerFavoriteFanmark,
} from "./favorites-api.ts";
import type { FavoriteFanmarkRow } from "./favorites-api.ts";

export async function loadFavoriteFanmarkRows(): Promise<FavoriteFanmarkRow[]> {
  if (getFavoritesBackend() === "worker") return loadWorkerFavoriteFanmarkRows();
  const { data, error } = await supabase.rpc("get_favorite_fanmarks");
  if (error) throw error;
  if (data === null) return [];
  if (!Array.isArray(data)) throw new Error("Invalid favorites response");
  return data as unknown as FavoriteFanmarkRow[];
}

export async function addFavoriteFanmark(emojiIds: string[], displayFanmark: string): Promise<boolean> {
  if (getFavoritesBackend() === "worker") return addWorkerFavoriteFanmark(emojiIds, displayFanmark);
  const { data, error } = await supabase.rpc("add_fanmark_favorite", {
    input_emoji_ids: emojiIds,
    input_display_fanmark: displayFanmark,
  });
  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("Invalid favorites response");
  return data;
}

export async function removeFavoriteFanmark(emojiIds: string[]): Promise<boolean> {
  if (getFavoritesBackend() === "worker") return removeWorkerFavoriteFanmark(emojiIds);
  const { data, error } = await supabase.rpc("remove_fanmark_favorite", { input_emoji_ids: emojiIds });
  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("Invalid favorites response");
  return data;
}
