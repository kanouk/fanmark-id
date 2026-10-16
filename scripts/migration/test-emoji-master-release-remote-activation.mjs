import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExpectedActiveCurrent,
  assertRemoteActivationReadback,
  parseRemoteActivationArguments,
  validateExpectedActive,
} from "./emoji-master-release-remote-activation.mjs";

const first = "a".repeat(64);
const second = "b".repeat(64);

function args(overrides = {}) {
  const values = {
    "account-id": "synthetic-account",
    email: "operator@example.invalid",
    "database-name": "synthetic-master",
    "database-id": "synthetic-database",
    "release-directory": "/private/synthetic/release",
    "expected-active": second,
    config: "/private/synthetic/wrangler.jsonc",
    wrangler: "/private/synthetic/wrangler",
    ...overrides,
  };
  return Object.entries(values).flatMap(([key, value]) => [`--${key}`, value]);
}

function event(generation, action, fromVersion, toVersion) {
  return {
    activation_id: `activation-${generation}`,
    generation,
    action,
    from_version: fromVersion,
    to_version: toVersion,
    created_at: `2026-09-25 00:00:0${generation}`,
  };
}

test("remote activation arguments default to promotion and expose guarded rollback", () => {
  assert.equal(parseRemoteActivationArguments(args()).action, "promotion");
  assert.equal(parseRemoteActivationArguments(args({ action: "rollback" })).action, "rollback");
  assert.equal(validateExpectedActive("none"), null);
  assert.equal(validateExpectedActive(second), second);
  assertExpectedActiveCurrent(null, null);
  assertExpectedActiveCurrent(second, second);
  assert.throws(() => assertExpectedActiveCurrent(first, second), { message: "activation_precondition_failed" });
  assert.throws(() => assertExpectedActiveCurrent(null, first), { message: "activation_precondition_failed" });
  assert.throws(() => parseRemoteActivationArguments(args({ action: "activate" })), { message: "activation_action_invalid" });
  assert.throws(() => parseRemoteActivationArguments([...args(), "--action", "promotion", "--action", "rollback"]), { message: "arguments_invalid" });
  assert.throws(() => parseRemoteActivationArguments(args({ "expected-active": undefined })), { message: "arguments_invalid" });
  assert.throws(() => validateExpectedActive("not-a-release"), { message: "expected_active_version_invalid" });
});

test("readback accepts an audited rollback and rejects an incorrect rollback event", () => {
  const before = {
    activeRows: [{
      singleton_id: 1,
      release_version: second,
      previous_release_version: first,
      activation_id: "activation-2",
      action: "promotion",
      generation: 2,
      updated_at: "2026-09-25 00:00:02",
    }],
    activationRows: [event(1, "promotion", null, first), event(2, "promotion", first, second)],
  };
  const after = {
    activeRows: [{
      singleton_id: 1,
      release_version: first,
      previous_release_version: second,
      activation_id: "activation-3",
      action: "rollback",
      generation: 3,
      updated_at: "2026-09-25 00:00:03",
    }],
    activationRows: [...before.activationRows, event(3, "rollback", second, first)],
  };
  const activation = { version: first, previousVersion: second, generation: 3, changed: true };

  assertRemoteActivationReadback({
    before,
    after,
    current: { version: first, generation: 3 },
    activation,
    version: first,
    action: "rollback",
  });

  const corrupt = structuredClone(after);
  corrupt.activationRows.at(-1).action = "promotion";
  assert.throws(() => assertRemoteActivationReadback({
    before,
    after: corrupt,
    current: { version: first, generation: 3 },
    activation,
    version: first,
    action: "rollback",
  }), { message: "activation_audit_readback_mismatch" });
});

test("an idempotent promotion preserves a prior rollback record and rejects stale state", () => {
  const before = {
    activeRows: [{
      singleton_id: 1,
      release_version: first,
      previous_release_version: second,
      activation_id: "activation-3",
      action: "rollback",
      generation: 3,
      updated_at: "2026-09-25 00:00:03",
    }],
    activationRows: [event(1, "promotion", null, first), event(2, "promotion", first, second), event(3, "rollback", second, first)],
  };
  const activation = { version: first, previousVersion: second, generation: 3, changed: false };

  assertRemoteActivationReadback({
    before,
    after: structuredClone(before),
    current: { version: first, generation: 3 },
    activation,
    version: first,
    action: "promotion",
  });

  const changed = structuredClone(before);
  changed.activeRows[0].generation = 4;
  assert.throws(() => assertRemoteActivationReadback({
    before,
    after: changed,
    current: { version: first, generation: 3 },
    activation,
    version: first,
    action: "promotion",
  }), { message: "activation_state_readback_mismatch" });
  assert.throws(() => assertRemoteActivationReadback({
    before,
    after: structuredClone(before),
    current: { version: first, generation: 3 },
    activation: { ...activation, changed: false },
    version: first,
    action: "rollback",
  }), { message: "activation_state_readback_mismatch" });
});
