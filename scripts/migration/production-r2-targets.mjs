import { readFileSync } from 'node:fs';
const resources = JSON.parse(readFileSync(new URL('../../docs/migration/production-resources.json', import.meta.url), 'utf8'));
export const PRODUCTION_R2_TARGETS = Object.freeze(['avatars', 'covers'].map(store => {
  const row = resources.r2.find(row => row.purpose === store);
  if (!row) throw Error('production_r2_target_missing');
  return Object.freeze({ accountId: resources.accountId, store, bucketName: row.name, createdAt: row.createdAt });
}));
