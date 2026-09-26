import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BetterAuthClientError,
  createBetterAuthClient,
} from './better-auth-client.ts';

test('Better Auth session requests include cookies and disable caching', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev/',
    fetchImpl: async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({ user: { id: 'synthetic-user', email: 'test@example.invalid' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const session = await client.getSession();

  assert.equal(session?.user.id, 'synthetic-user');
  assert.equal(request?.url, 'https://fanmark-app-staging.example.workers.dev/api/auth/get-session');
  assert.equal(request?.init?.credentials, 'include');
  assert.equal(request?.init?.cache, 'no-store');
});

test('Better Auth email sign-in posts only the entered credentials and includes cookies', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({ user: { id: 'synthetic-user', email: 'test@example.invalid' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.signInWithEmail('test@example.invalid', 'synthetic-password');

  assert.equal(request?.url, 'https://fanmark-app-staging.example.workers.dev/api/auth/sign-in/email');
  assert.equal(request?.init?.method, 'POST');
  assert.equal(request?.init?.credentials, 'include');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    email: 'test@example.invalid',
    password: 'synthetic-password',
  });
});

test('Better Auth two-factor sign-in challenge is returned without requiring a session', async () => {
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async () => new Response(JSON.stringify({
      twoFactorRedirect: true,
      twoFactorMethods: ['totp'],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });

  assert.deepEqual(
    await client.signInWithEmail('admin@example.invalid', 'synthetic-password'),
    { twoFactorRedirect: true, twoFactorMethods: ['totp'] },
  );
});

test('Better Auth TOTP enrollment validates the URI and backup-code response', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({
        method: 'totp',
        totpURI: 'otpauth://totp/fanmark.id:admin?secret=SYNTHETIC',
        backupCodes: ['synthetic-backup-code'],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.deepEqual(await client.enableTotp('synthetic-password'), {
    method: 'totp',
    totpURI: 'otpauth://totp/fanmark.id:admin?secret=SYNTHETIC',
    backupCodes: ['synthetic-backup-code'],
  });
  assert.equal(request?.url, 'https://fanmark-app-staging.example.workers.dev/api/auth/two-factor/enable');
  assert.equal(request?.init?.credentials, 'include');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    method: 'totp',
    password: 'synthetic-password',
  });
});

test('Better Auth TOTP verification requires a positive response and sends only the code', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.verifyTotp('123456');

  assert.equal(request?.url, 'https://fanmark-app-staging.example.workers.dev/api/auth/two-factor/verify-totp');
  assert.equal(request?.init?.credentials, 'include');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { code: '123456' });
});

test('Better Auth TOTP verification accepts the session response returned by its Worker endpoint', async () => {
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async () => new Response(JSON.stringify({
      token: 'synthetic-session-token',
      user: { id: 'synthetic-user', email: 'admin@example.invalid' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });

  assert.deepEqual(await client.verifyTotp('123456'), {
    token: 'synthetic-session-token',
    user: { id: 'synthetic-user', email: 'admin@example.invalid' },
  });
});

test('admin session maps only known authorization states and fails closed on malformed responses', async () => {
  const resultClient = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async (input, init) => {
      assert.equal(String(input), 'https://fanmark-app-staging.example.workers.dev/api/admin/session');
      assert.equal(init?.credentials, 'include');
      assert.equal(init?.cache, 'no-store');
      return new Response(JSON.stringify({ error: 'mfa_enrollment_required' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.deepEqual(await resultClient.getAdminSession(), {
    authorized: false,
    reason: 'mfa_enrollment_required',
  });

  const malformedClient = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'unknown_state' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
  });
  await assert.rejects(malformedClient.getAdminSession());
});

test('Better Auth errors retain HTTP status for safe UI handling', async () => {
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async () => new Response(JSON.stringify({ message: 'Invalid credentials' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  });

  await assert.rejects(
    client.signInWithEmail('test@example.invalid', 'wrong-password'),
    (error: unknown) => error instanceof BetterAuthClientError && error.status === 401,
  );
});

test('Better Auth sign-out revokes the server cookie session', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async (input, init) => {
      request = { url: String(input), init };
      return new Response(null, { status: 204 });
    },
  });

  await client.signOut();

  assert.equal(request?.url, 'https://fanmark-app-staging.example.workers.dev/api/auth/sign-out');
  assert.equal(request?.init?.method, 'POST');
  assert.equal(request?.init?.credentials, 'include');
  assert.equal(request?.init?.cache, 'no-store');
});

test('an empty Better Auth session remains unauthenticated', async () => {
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async () => new Response('null', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });

  assert.equal(await client.getSession(), null);
});

test('Better Auth capabilities are fetched without caching and validate the feature boundary', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({
        emailVerification: true,
        passwordReset: true,
        signUp: false,
        invitationRequired: true,
        socialProviders: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.deepEqual(await client.getCapabilities(), {
    emailVerification: true,
    passwordReset: true,
    signUp: false,
    invitationRequired: true,
    socialProviders: [],
  });
  assert.equal(request?.url, 'https://fanmark-app-staging.example.workers.dev/api/auth/capabilities');
  assert.equal(request?.init?.credentials, 'include');
  assert.equal(request?.init?.cache, 'no-store');
});

test('Better Auth validates invitation availability and submits signup command terms', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(
        String(input).endsWith('/invitations/validate')
          ? { isValid: true, remainingUses: 1, perks: {}, invitationRequired: true }
          : { status: true },
      ), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.deepEqual(await client.validateInvitationCode('welcome'), {
    isValid: true,
    remainingUses: 1,
    perks: {},
    invitationRequired: true,
  });
  assert.deepEqual(await client.signUpWithEmail({
    email: 'user@example.invalid',
    password: 'synthetic-password',
    commandId: 'a8f53c30-f3e6-41f8-9d2e-970ceb5793f1',
    invitationCode: 'WELCOME',
    preferredLanguage: 'ja',
  }), { pending: false });
  assert.deepEqual(requests, [
    {
      url: 'https://fanmark-app-staging.example.workers.dev/api/auth/invitations/validate',
      body: { code: 'welcome' },
    },
    {
      url: 'https://fanmark-app-staging.example.workers.dev/api/auth/sign-up/email',
      body: {
        email: 'user@example.invalid',
        password: 'synthetic-password',
        commandId: 'a8f53c30-f3e6-41f8-9d2e-970ceb5793f1',
        invitationCode: 'WELCOME',
        preferredLanguage: 'ja',
      },
    },
  ]);
});

test('Better Auth email verification and password reset use their dedicated endpoints', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ status: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.sendVerificationEmail('user@example.invalid', 'https://fanmark-app-staging.example.workers.dev/auth');
  await client.requestPasswordReset('user@example.invalid', 'https://fanmark-app-staging.example.workers.dev/reset-password');
  await client.resetPassword('synthetic-reset-token', 'new-synthetic-password');

  assert.deepEqual(requests, [
    {
      url: 'https://fanmark-app-staging.example.workers.dev/api/auth/send-verification-email',
      body: { email: 'user@example.invalid', callbackURL: 'https://fanmark-app-staging.example.workers.dev/auth' },
    },
    {
      url: 'https://fanmark-app-staging.example.workers.dev/api/auth/request-password-reset',
      body: { email: 'user@example.invalid', redirectTo: 'https://fanmark-app-staging.example.workers.dev/reset-password' },
    },
    {
      url: 'https://fanmark-app-staging.example.workers.dev/api/auth/reset-password',
      body: { token: 'synthetic-reset-token', newPassword: 'new-synthetic-password' },
    },
  ]);
});

test('Better Auth social sign-in validates the redirect response before handing it to the browser', async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const client = createBetterAuthClient({
    baseUrl: 'https://fanmark-app-staging.example.workers.dev',
    fetchImpl: async (input, init) => {
      request = { url: String(input), init };
      return new Response(JSON.stringify({
        url: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic',
        redirect: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(
    await client.signInWithSocial('google', 'https://fanmark-app-staging.example.workers.dev/auth'),
    'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic',
  );
  assert.equal(request?.url, 'https://fanmark-app-staging.example.workers.dev/api/auth/sign-in/social');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    provider: 'google',
    callbackURL: 'https://fanmark-app-staging.example.workers.dev/auth',
    newUserCallbackURL: 'https://fanmark-app-staging.example.workers.dev/auth',
    errorCallbackURL: 'https://fanmark-app-staging.example.workers.dev/auth',
  });
});
