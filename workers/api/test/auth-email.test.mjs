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

function templateD1({ language = "en", template = null } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              calls.push({ sql, values });
              if (sql.includes("user_settings")) return language ? { preferred_language: language } : null;
              return template;
            },
          };
        },
      };
    },
  };
}

test("D1 auth templates use the user's language and escape stored copy as HTML", async () => {
  const db = templateD1({
    language: "en",
    template: {
      subject: "Verify from D1", body_text: "Hello\n<script>alert(1)</script>",
      button_text: "Verify <now>", is_active: 1,
    },
  });
  let sent;
  await sendResendAuthEmail({
    ...env,
    D1_TOPOLOGY: "split",
    AUTH_EMAIL_TEMPLATE_BACKEND: "d1",
    FANMARK_DB: db,
  }, {
    kind: "verification",
    userId: "synthetic-user-id",
    to: "synthetic@example.invalid",
    url: "https://fanmark-app-staging.example.workers.dev/api/auth/verify-email?token=synthetic",
  }, async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(null, { status: 200 });
  });

  assert.equal(sent.subject, "Verify from D1");
  assert.match(sent.html, /Hello<br>&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(sent.html, /Verify &lt;now&gt;/u);
  assert.match(sent.text, /Hello\n<script>alert\(1\)<\/script>/u);
  assert.deepEqual(db.calls.map(({ values }) => values), [["synthetic-user-id"], ["signup", "en"]]);
});

test("D1 auth templates default missing or unsupported preferences to Japanese", async () => {
  const db = templateD1({ language: "fr", template: {
    subject: "D1 recovery ja", body_text: "D1 body", button_text: "Continue", is_active: 1,
  } });
  let sent;
  await sendResendAuthEmail({ ...env, D1_TOPOLOGY: "split", AUTH_EMAIL_TEMPLATE_BACKEND: "d1", FANMARK_DB: db }, {
    kind: "passwordReset", userId: "synthetic-user-id", to: "synthetic@example.invalid",
    url: "https://fanmark-app-staging.example.workers.dev/api/auth/reset-password/1234567890abcdef1234567890abcdef",
  }, async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(null, { status: 200 });
  });
  assert.equal(sent.subject, "D1 recovery ja");
  assert.deepEqual(db.calls[1].values, ["recovery", "ja"]);
});

test("inactive D1 auth template is not bypassed by the static copy", async () => {
  const db = templateD1({ template: {
    subject: "Inactive", body_text: "Inactive body", button_text: "Continue", is_active: 0,
  } });
  let fetchCalled = false;
  await assert.rejects(sendResendAuthEmail({
    ...env, D1_TOPOLOGY: "split", AUTH_EMAIL_TEMPLATE_BACKEND: "d1", FANMARK_DB: db,
  }, {
    kind: "verification", userId: "synthetic-user-id", to: "synthetic@example.invalid",
    url: "https://fanmark-app-staging.example.workers.dev/api/auth/verify-email?token=synthetic",
  }, async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  }), /auth_email_template_unavailable/u);
  assert.equal(fetchCalled, false);
});

test("D1 auth template selection fails closed without binding, identity, or active template", async () => {
  const message = {
    kind: "verification", userId: "synthetic-user-id", to: "synthetic@example.invalid",
    url: "https://fanmark-app-staging.example.workers.dev/api/auth/verify-email?token=synthetic",
  };
  let fetchCalled = false;
  const fetchImpl = async () => {
    fetchCalled = true;
    return new Response(null, { status: 200 });
  };
  await assert.rejects(sendResendAuthEmail({ ...env, AUTH_EMAIL_TEMPLATE_BACKEND: "d1" }, message, fetchImpl), /auth_email_template_unavailable/u);
  await assert.rejects(sendResendAuthEmail({ ...env, D1_TOPOLOGY: "split", AUTH_EMAIL_TEMPLATE_BACKEND: "d1", FANMARK_DB: templateD1() }, { ...message, userId: undefined }, fetchImpl), /auth_email_template_unavailable/u);
  await assert.rejects(sendResendAuthEmail({ ...env, D1_TOPOLOGY: "split", AUTH_EMAIL_TEMPLATE_BACKEND: "d1", FANMARK_DB: templateD1({ template: null }) }, message, fetchImpl), /auth_email_template_unavailable/u);
  await assert.rejects(sendResendAuthEmail({ ...env, D1_TOPOLOGY: "split", AUTH_EMAIL_TEMPLATE_BACKEND: "other", FANMARK_DB: templateD1() }, message, fetchImpl), /auth_email_template_unavailable/u);
  assert.equal(fetchCalled, false);
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
