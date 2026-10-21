import { frontendEnvironment } from '../frontend-build-config.mjs';
import { randomUUID } from 'node:crypto';

// Deliberate allowlist: no deployment config, inherited secrets, routes or Cron.
const D1_FEATURES = [
  'ACCOUNT_DELETION', 'ADMIN_DATA_RESET', 'ADMIN_USER_MANAGEMENT', 'AUTH_EMAIL_TEMPLATE',
  'AUTH_USER_STATUS', 'AVAILABILITY', 'AVAILABILITY_RULES_ADMIN', 'BROADCAST_EMAIL',
  'EMOJI_CATALOG', 'EMOJI_MASTER_ADMIN', 'EXTENSION_COUPON', 'EXTENSION_COUPON_ADMIN',
  'FANMARK_ACCESS_ANALYTICS', 'FANMARK_ANALYTICS', 'FANMARK_DETAILS', 'FANMARK_LOTTERY',
  'FANMARK_PROFILE', 'FANMARK_REGISTRATION', 'FANMARK_RETURN', 'FANMARK_SEARCH',
  'FANMARK_SETTINGS', 'FANMARK_TRANSFER', 'FAVORITES', 'INVITATION_ADMIN',
  'MAINTENANCE_SETTINGS', 'LIFECYCLE_SETTINGS', 'NOTIFICATION_MASTER',
  'NOTIFICATIONS', 'NOTIFICATION_PROCESSOR', 'OWNED_FANMARKS', 'PROFILE', 'PUBLIC_ACCESS', 'RECENT_FANMARKS',
  'REFERENCE_MASTER', 'REFERENCE_MASTER_ADMIN', 'EMAIL_TEMPLATE_ADMIN', 'STORAGE',
  'SUBSCRIPTION', 'SYSTEM_SETTINGS', 'VERIFIED_ACCESS', 'WAITLIST_ADMIN', 'WAITLIST_SIGNUP',
];

export function assertLocalOrigin(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.hostname !== '127.0.0.1' ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('local_origin_must_be_loopback_https');
  }
  return url.origin;
}

export function localBindings(origin) {
  origin = assertLocalOrigin(origin);
  return {
    ...Object.fromEntries(D1_FEATURES.map(name => [name + '_BACKEND', 'd1'])),
    STORAGE_BACKEND: 'r2',
    D1_TOPOLOGY: 'split',
    AUTH_BACKEND: 'better-auth',
    BETTER_AUTH_URL: origin,
    CORS_ALLOWED_ORIGINS: origin,
    STORAGE_PUBLIC_BASE_URL: origin,
    STORAGE_LEGACY_ORIGIN: 'https://synthetic-source.example.invalid',
    BETTER_AUTH_SECRET: 'local-development-only-' + randomUUID(),
    VERIFIED_ACCESS_SECRET: 'local-development-proof-' + randomUUID(),
    REFERENCE_MASTER_SERVICE_SECRET: 'local-development-master-' + randomUUID(),
    CUTOVER_WRITE_FREEZE: 'false',
    NOTIFICATION_WAKE_BACKEND: 'durable-object',
    STRIPE_MODE_POLICY: 'test_only',
  };
}

export function localFrontendEnvironment(origin) {
  return frontendEnvironment('local', assertLocalOrigin(origin));
}
