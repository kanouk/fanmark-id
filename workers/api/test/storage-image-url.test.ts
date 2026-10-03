import { describe, expect, it } from 'vitest';
import { mapStoredStorageImageUrl, mapStoredProfileImages, preserveStoredImagePatch } from '../src/storage-image-url.mjs';

const source = 'https://synthetic-source.example.invalid';
const target = 'https://api.example.test';
const config = { STORAGE_BACKEND: 'r2', STORAGE_LEGACY_ORIGIN: source, STORAGE_PUBLIC_BASE_URL: target };
const original = `${source}/storage/v1/object/public/avatars/owner/1700000000000.jpg`;
const projected = `${target}/api/storage/public/avatars/owner/1700000000000.jpg`;

describe('stored legacy Storage image projections', () => {
  it('keeps logical buckets separate and preserves imported timestamp/nested/Unicode object keys', () => {
    expect(mapStoredStorageImageUrl(original, 'avatars', config)).toBe(projected);
    const key = 'owner/archive/%E6%97%A5%E6%9C%AC_cover.png';
    expect(mapStoredStorageImageUrl(`${source}/storage/v1/object/public/cover-images/${key}`, 'cover-images', config))
      .toBe(`${target}/api/storage/public/cover-images/${key}`);
  });
  it('requires explicit R2 source selection and leaves unrelated third-party URLs intact', () => {
    expect(mapStoredStorageImageUrl(original, 'avatars', {})).toBe(original);
    expect(mapStoredStorageImageUrl(original, 'avatars', { ...config, STORAGE_BACKEND: 'supabase' })).toBe(original);
    const unrelated = original.replace(source, 'https://external.example.test');
    expect(mapStoredStorageImageUrl(unrelated, 'avatars', config)).toBe(unrelated);
    expect(mapStoredStorageImageUrl(null, 'avatars', config)).toBeNull();
  });
  it('rejects signed/transformed/ambiguous source paths, credentials and cross-bucket identities without exposing URLs', () => {
    for (const value of [original + '?token=private', original + '#private', original.replace('owner/', 'owner/%2e%2e/'),
      original.replace('1700000000000.jpg', '%2fsecret.jpg'), original.replace('1700000000000.jpg', '%00.jpg'),
      original.replace('avatars/', 'cover-images/'), original.replace('/object/public/', '/render/image/public/'),
      original.replace('https://', 'https://user:private@')]) {
      try { mapStoredStorageImageUrl(value, 'avatars', config); throw new Error('mapping unexpectedly accepted'); }
      catch (error) { expect((error as Error).message).toBe('storage_image_mapping_invalid'); }
    }
  });
  it('refuses unsafe destination/source configuration instead of creating credential-bearing or insecure URLs', () => {
    for (const destination of ['http://external.example.test', 'https://user:secret@example.test', target + '/path', target + '?token=secret']) {
      expect(() => mapStoredStorageImageUrl(original, 'avatars', { ...config, STORAGE_PUBLIC_BASE_URL: destination })).toThrow('storage_image_mapping_invalid');
    }
  });
  it('clones only image fields and preserves raw snapshot values when an unchanged form returns the projection', () => {
    const theme = { cover_image_url: original.replace('avatars/', 'cover-images/'), theme_color: '#123456', nested: { value: 7 } };
    const mapped = mapStoredProfileImages(theme, config);
    expect(mapped.cover_image_url).toBe(projected.replace('avatars/', 'cover-images/'));
    expect(theme.cover_image_url).toContain(source);
    expect(mapped.theme_color).toBe(theme.theme_color);
    expect(mapped.nested).toBe(theme.nested);
    expect(preserveStoredImagePatch(projected, original, 'avatars', config)).toBe(original);
    expect(preserveStoredImagePatch(original, original, 'avatars', config)).toBe(original);
  });
});
