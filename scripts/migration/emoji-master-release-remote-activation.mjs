const VERSION_RE = /^[0-9a-f]{64}$/;
const REQUIRED_ARGUMENTS = Object.freeze([
  "account-id",
  "email",
  "database-name",
  "database-id",
  "release-directory",
  "expected-active",
  "config",
  "wrangler",
]);
const ALLOWED_ARGUMENTS = new Set([...REQUIRED_ARGUMENTS, "action"]);

function fail(code) {
  throw new Error(code);
}

export function parseRemoteActivationArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (typeof key !== "string" || !key.startsWith("--") || typeof value !== "string" || value.startsWith("--")) {
      fail("arguments_invalid");
    }
    const name = key.slice(2);
    if (!ALLOWED_ARGUMENTS.has(name) || values.has(name)) fail("arguments_invalid");
    values.set(name, value);
    index += 1;
  }
  for (const key of REQUIRED_ARGUMENTS) if (!values.has(key)) fail("arguments_missing");

  const action = values.get("action") ?? "promotion";
  if (action !== "promotion" && action !== "rollback") fail("activation_action_invalid");
  return {
    ...Object.fromEntries([...values].map(([key, value]) => [key.replaceAll("-", "_"), value])),
    action,
  };
}

export function validateExpectedActive(value) {
  if (value === "none") return null;
  if (!VERSION_RE.test(value)) fail("expected_active_version_invalid");
  return value;
}

export function assertExpectedActiveCurrent(expectedVersion, actualVersion) {
  if (actualVersion !== expectedVersion) fail("activation_precondition_failed");
}

export function assertRemoteActivationReadback({ before, after, current, activation, version, action }) {
  const activeRow = after.activeRows[0];
  if (after.activeRows.length !== 1 || activeRow.singleton_id !== 1 ||
      activeRow.release_version !== version || activeRow.previous_release_version !== activation.previousVersion ||
      activeRow.generation !== activation.generation) {
    fail("activation_state_readback_mismatch");
  }
  if (current.version !== version || current.generation !== activation.generation) {
    fail("activation_release_readback_mismatch");
  }
  if (activation.changed) {
    const priorEvents = after.activationRows.slice(0, before.activationRows.length);
    const event = after.activationRows.at(-1);
    if (activeRow.action !== action ||
        after.activationRows.length !== before.activationRows.length + 1 ||
        JSON.stringify(priorEvents) !== JSON.stringify(before.activationRows) ||
        event?.generation !== activation.generation || event?.action !== action ||
        event?.from_version !== activation.previousVersion || event?.to_version !== version) {
      fail("activation_audit_readback_mismatch");
    }
  } else if (action !== "promotion" || activeRow.action !== before.activeRows[0]?.action ||
      JSON.stringify(after) !== JSON.stringify(before)) {
    fail("activation_state_readback_mismatch");
  }
}
