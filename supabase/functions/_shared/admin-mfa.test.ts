import assert from "node:assert/strict";
import { test } from "node:test";

import { hasCurrentAal2 } from "./admin-mfa.ts";

test("accepts only Supabase-confirmed AAL2 for the request access token", async () => {
  let receivedToken = "";
  const result = await hasCurrentAal2({
    async getAuthenticatorAssuranceLevel(token) {
      receivedToken = token;
      return { data: { currentLevel: "aal2" }, error: null };
    },
  }, "request-access-token");

  assert.equal(result, true);
  assert.equal(receivedToken, "request-access-token");
});

test("rejects AAL1, absent assurance, API errors, and unavailable assurance checks", async () => {
  const clients = [
    { async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: "aal1" }, error: null }; } },
    { async getAuthenticatorAssuranceLevel() { return { data: null, error: null }; } },
    { async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: "aal2" }, error: new Error("unverified") }; } },
    { async getAuthenticatorAssuranceLevel() { throw new Error("network unavailable"); } },
  ];

  for (const client of clients) {
    assert.equal(await hasCurrentAal2(client, "request-access-token"), false);
  }
});

test("does not call Supabase when the access token is empty", async () => {
  let called = false;
  const result = await hasCurrentAal2({
    async getAuthenticatorAssuranceLevel() {
      called = true;
      return { data: { currentLevel: "aal2" }, error: null };
    },
  }, "");

  assert.equal(result, false);
  assert.equal(called, false);
});
