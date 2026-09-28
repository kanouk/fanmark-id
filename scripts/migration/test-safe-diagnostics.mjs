import assert from "node:assert/strict";
import test from "node:test";

import { safeErrorSummary, safeWranglerDiagnostics } from "./safe-diagnostics.mjs";

test("sanitizes credential-like Wrangler output and account emails", () => {
  const output = safeWranglerDiagnostics([
    "\u001b[31mrequest failed\u001b[0m",
    "Bearer bearer-secret-value",
    "password=hunter2 token:token-value api_key =key-value",
    "account user@example.com",
    "opaque " + "a".repeat(64),
  ].join("\n")).join(" ");

  for (const secret of ["bearer-secret-value", "hunter2", "token-value", "key-value", "user@example.com", "a".repeat(64)]) {
    assert.equal(output.includes(secret), false, `leaked ${secret}`);
  }
  assert.match(output, /request failed/u);
  assert.match(output, /\[redacted-email\]/u);
  assert.match(output, /\[redacted\]/u);
});

test("keeps concise failure context while sanitizing an Error summary", () => {
  const summary = safeErrorSummary(new Error("canary rejected: account user@example.com token=secret-value"));
  assert.match(summary, /canary rejected/u);
  assert.match(summary, /\[redacted-email\]/u);
  assert.match(summary, /token=\[redacted\]/u);
  assert.equal(summary.includes("secret-value"), false);
  assert.equal(safeErrorSummary(null), "unknown");
  assert.ok(safeErrorSummary(new Error("x".repeat(2_000))).length <= 1_500);
});
