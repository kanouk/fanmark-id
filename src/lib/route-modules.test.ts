import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeModuleForPath } from './route-modules.ts';

test('owner deep links preload the requested module without using identifiers as import paths', () => {
  assert.equal(routeModuleForPath('/fanmarks/owner-id/settings'), 'FanmarkSettingsPage');
  assert.equal(routeModuleForPath('/fanmarks/owner-id/profile/edit'), 'EmojiProfileEdit');
  assert.equal(routeModuleForPath('/fanmarks/owner-id/profile/preview'), 'FanmarkProfilePreview');
  assert.equal(routeModuleForPath('/fanmarks/owner-id/messageboard/preview'), 'FanmarkMessageboardPreview');
  assert.equal(routeModuleForPath('/q/short-id'), 'FanmarkPublicQR');
});
test('PWA aliases and router casing/trailing slash use the same module', () => {
  for (const pathname of ['/pwa', '/pwa/search', '/pwa/history/', '/PWA/SEARCH']) {
    assert.equal(routeModuleForPath(pathname), 'PWAApp');
  }
});
test('home, login, public access and unrelated URLs do not prefetch owner modules', () => {
  for (const pathname of ['/', '/auth', '/a/short-id', '/😀', '/profile-other', '/pwa/unknown', '/fanmarks/x/profile/edit/extra', 'https://other.example/profile']) {
    assert.equal(routeModuleForPath(pathname), undefined);
  }
});
