import assert from "node:assert/strict";
import test from "node:test";
import { isResendAuthEmailConfigured, sendResendAuthEmail } from "../src/auth-email.mjs";

const env = {
  AUTH_EMAIL_BACKEND: "resend",
  BETTER_AUTH_URL: "https://fanmark-app-staging.example.workers.dev",
  RESEND_API_KEY: "synthetic-resend-api-key-012345",
  RESEND_FROM_EMAIL: "Fanmark <auth@example.test>",
};

test("Resend auth email sends only a same-origin Better Auth verification link", async () => {
  let sent;
  await sendResendAuthEmail(env, {
    kind: "verification",
    to: "synthetic@example.invalid",
    url: "https://fanmark-app-staging.example.workers.dev/api/auth/verify-email?token=synthetic&callbackURL=https%3A%2F%2Ffanmark-app-staging.example.workers.dev%2Fauth",
  }, async (url, init) => {
    sent = { url: String(url), init, body: JSON.parse(String(init?.body)) };
    return new Response(null, { status: 200 });
  });

  assert.equal(sent.url, "https://api.resend.com/emails");
  assert.equal(sent.init.method, "POST");
  assert.equal(sent.init.headers.authorization, `Bearer ${env.RESEND_API_KEY}`);
  assert.deepEqual(sent.body.to, ["synthetic@example.invalid"]);
  assert.equal(sent.body.subject, "fanmark.id メールアドレスの確認");
  assert.match(sent.body.html, /&amp;callbackURL=/u);
  assert.match(sent.body.text, /\/api\/auth\/verify-email\?token=synthetic/u);
});

test("Resend auth email sends password reset links only on the configured auth origin", async () => {
  let sent;
  await sendResendAuthEmail(env, {
    kind: "passwordReset",
    to: "synthetic@example.invalid",
    url: "https://fanmark-app-staging.example.workers.dev/api/auth/reset-password/1234567890abcdef1234567890abcdef?callbackURL=https%3A%2F%2Ffanmark-app-staging.example.workers.dev%2Freset-password",
  }, async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(null, { status: 200 });
  });
  assert.equal(sent.subject, "fanmark.id パスワードの再設定");
  assert.match(sent.text, /\/api\/auth\/reset-password\/1234567890abcdef/u);
});

test("Resend auth email refuses missing configuration, unsafe links, and provider errors", async () => {
  assert.equal(isResendAuthEmailConfigured({ ...env, AUTH_EMAIL_BACKEND: undefined }), false);
  assert.equal(isResendAuthEmailConfigured({ ...env, RESEND_FROM_EMAIL: "auth@example.test\r\nBcc: victim@example.test" }), false);

  let fetchCalled = false;
  await assert.rejects(sendResendAuthEmail(env, {
    kind: "verification",
    to: "synthetic@example.invalid",
    url: "https://attacker.example/api/auth/verify-email?token=synthetic",
  }, async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  }), /auth_email_link_invalid/u);
  assert.equal(fetchCalled, false);

  await assert.rejects(sendResendAuthEmail(env, {
    kind: "verification",
    to: "synthetic@example.invalid",
    url: "https://fanmark-app-staging.example.workers.dev/api/auth/verify-email?token=synthetic",
  }, async () => new Response("secret provider response", { status: 401 })), /auth_email_provider_failed_401/u);
});
