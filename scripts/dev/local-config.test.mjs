import assert from 'node:assert/strict';
import test from 'node:test';
import { localBindings, assertLocalOrigin, localFrontendEnvironment } from './local-config.mjs';

test('local config is generated independently of production credentials and remote resources', () => {
  const bindings = localBindings('https://127.0.0.1:8080');
  assert.equal(bindings.AUTH_BACKEND, 'better-auth');
  assert.equal(bindings.D1_TOPOLOGY, 'split');
  for (const name of ['AUTH_EMAIL_BACKEND', 'AUTH_SOCIAL_BACKEND', 'BROADCAST_SEND_BACKEND',
    'STRIPE_WEBHOOK_BACKEND', 'STRIPE_PLAN_CHECKOUT_BACKEND', 'RECOVERY_DRAIN_BACKEND',
    'STAGING_BACKUP_BACKEND', 'SUPABASE_URL', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY']) {
    assert.equal(Object.hasOwn(bindings, name), false, name);
  }
  assert.notEqual(bindings.BETTER_AUTH_SECRET, localBindings('https://127.0.0.1:8080').BETTER_AUTH_SECRET);
});

test('local origin cannot target another host or include credentials or a path', () => {
  assert.equal(assertLocalOrigin('https://127.0.0.1:8080'), 'https://127.0.0.1:8080');
  for (const origin of ['https://fanmark.id', 'http://127.0.0.1:8080', 'https://localhost:8080',
    'https://user:password@127.0.0.1:8080', 'https://127.0.0.1:8080/api', 'https://127.0.0.1:8080/?remote=true']) {
    assert.throws(() => assertLocalOrigin(origin));
  }
});

test('frontend uses local APIs and preserves disabled sends', () => {
  const environment = localFrontendEnvironment('https://127.0.0.1:8080', {
    scripts: { 'build:cloudflare-staging': 'VITE_PROFILE_BACKEND=worker VITE_BROADCAST_SEND_BACKEND=worker vite build ' },
  });
  assert.equal(environment.VITE_PROFILE_BACKEND, 'worker');
  assert.equal(environment.VITE_BROADCAST_SEND_BACKEND, 'disabled');
  assert.equal(environment.VITE_BROADCAST_TEST_SEND_BACKEND, 'disabled');
  assert.equal(environment.VITE_AUTH_API_BASE_URL, 'https://127.0.0.1:8080');
});
