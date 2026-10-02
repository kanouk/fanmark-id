import assert from "node:assert/strict";
import test from "node:test";
import { getAdminDataResetMode } from "./admin-data-reset-mode.ts";

test("data reset keeps the existing Supabase mode by default and disables the destructive action in staging", () => {
  assert.equal(getAdminDataResetMode(undefined), "supabase");
  assert.equal(getAdminDataResetMode(" supabase "), "supabase");
  assert.equal(getAdminDataResetMode("disabled"), "disabled");
  assert.equal(getAdminDataResetMode("worker"), "worker");
  assert.throws(() => getAdminDataResetMode("invalid"), /not supported/u);
});
