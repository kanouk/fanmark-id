import assert from "node:assert/strict";
import test from "node:test";
import type { OwnedFanmark } from "./owned-fanmarks-api.ts";
import { countActiveOwnedFanmarks, mapActiveOwnedFanmarks } from "./owned-fanmarks-plan-projection.ts";

function item(id: string, status: string, licenseEnd: string | null): OwnedFanmark {
  return {
    id,
    user_input_fanmark: `🌿${id}`,
    emoji_ids: [`emoji-${id}`],
    fanmark: `display-${id}`,
    emoji_key: `key-${id}`,
    fanmark_name: null,
    short_id: `short-${id}`,
    access_type: "inactive",
    tier_level: 1,
    current_license_id: `license-${id}`,
    is_transferable: true,
    status: "active",
    created_at: "2026-09-24T00:00:00.000Z",
    updated_at: "2026-09-24T00:00:00.000Z",
    current_license: {
      id: `license-${id}`,
      license_start: "2026-09-24T00:00:00.000Z",
      license_end: licenseEnd,
      status,
      created_at: "2026-09-24T00:00:00.000Z",
    },
    fanmark_licenses: {
      license_start: "2026-09-24T00:00:00.000Z",
      license_end: licenseEnd,
      grace_expires_at: null,
      status,
      is_returned: false,
      excluded_at: null,
      excluded_from_plan: null,
    },
  };
}

test("active owner projection includes perpetual licenses and keeps the downgrade DTO", () => {
  const items = [item("perpetual", "active", null), item("future", "active", "2026-10-03T00:00:00.000Z")];
  assert.deepEqual(mapActiveOwnedFanmarks(items, Date.parse("2026-10-02T00:00:00.000Z")), [
    {
      id: "perpetual",
      user_input_fanmark: "🌿perpetual",
      emoji_ids: ["emoji-perpetual"],
      fanmark: "display-perpetual",
      fanmark_name: "display-perpetual",
      license_id: "license-perpetual",
      license_end: null,
      access_type: "inactive",
    },
    {
      id: "future",
      user_input_fanmark: "🌿future",
      emoji_ids: ["emoji-future"],
      fanmark: "display-future",
      fanmark_name: "display-future",
      license_id: "license-future",
      license_end: "2026-10-03T00:00:00.000Z",
      access_type: "inactive",
    },
  ]);
  assert.equal(countActiveOwnedFanmarks(items, Date.parse("2026-10-02T00:00:00.000Z")), 2);
});

test("expired, malformed, and non-active licenses do not count toward the plan", () => {
  const now = Date.parse("2026-10-02T00:00:00.000Z");
  const items = [
    item("expired", "active", "2026-10-01T23:59:59.999Z"),
    item("boundary", "active", "2026-10-02T00:00:00.000Z"),
    item("invalid", "active", "not-a-date"),
    item("grace", "grace", "2026-10-03T00:00:00.000Z"),
    item("perpetual-grace", "grace", null),
  ];
  assert.deepEqual(mapActiveOwnedFanmarks(items, now), []);
  assert.equal(countActiveOwnedFanmarks(items, now), 0);
});
