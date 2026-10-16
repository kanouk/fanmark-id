import type { OwnedFanmark } from "./owned-fanmarks-api.ts";

export interface ActiveFanmark {
  id: string;
  user_input_fanmark: string;
  emoji_ids: string[];
  fanmark: string;
  fanmark_name: string | null;
  license_id: string;
  license_end: string | null;
  access_type: string | null;
}

function isCurrentActiveLicense(item: OwnedFanmark, now: number): boolean {
  if (item.fanmark_licenses.status !== "active") return false;
  const end = item.fanmark_licenses.license_end;
  if (end === null) return true;
  const endTime = Date.parse(end);
  return Number.isFinite(endTime) && endTime > now;
}

export function mapActiveOwnedFanmarks(items: readonly OwnedFanmark[], now = Date.now()): ActiveFanmark[] {
  return items.filter((item) => isCurrentActiveLicense(item, now)).map((item) => ({
    id: item.id,
    user_input_fanmark: item.user_input_fanmark,
    emoji_ids: item.emoji_ids,
    fanmark: item.fanmark,
    fanmark_name: (item.fanmark_name ?? item.fanmark ?? item.user_input_fanmark) || null,
    license_id: item.current_license.id,
    license_end: item.fanmark_licenses.license_end,
    access_type: item.access_type,
  }));
}

export function countActiveOwnedFanmarks(items: readonly OwnedFanmark[], now = Date.now()): number {
  return mapActiveOwnedFanmarks(items, now).length;
}
