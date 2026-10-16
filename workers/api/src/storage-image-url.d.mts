export interface StorageImageMappingEnv {
  STORAGE_BACKEND?: string;
  STORAGE_LEGACY_ORIGIN?: string;
  STORAGE_PUBLIC_BASE_URL?: string;
}
export function mapStoredStorageImageUrl(value: string | null, bucket: 'avatars' | 'cover-images', env?: StorageImageMappingEnv): string | null;
export function mapStoredProfileImages<T extends Record<string, unknown>>(theme: T, env?: StorageImageMappingEnv): T;
export function preserveStoredImagePatch(value: string, current: string | null, bucket: 'avatars' | 'cover-images', env?: StorageImageMappingEnv): string | null;
