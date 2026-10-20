import {readFileSync} from 'node:fs';
const resources=JSON.parse(readFileSync(new URL('../../docs/migration/production-resources.json',import.meta.url),'utf8'));
export const PRODUCTION_D1_TARGETS=Object.freeze(resources.d1.map(row=>Object.freeze({
  accountId:resources.accountId,databaseId:row.id,databaseName:row.name,createdAt:row.createdAt,
  store:({AUTH_DB:'auth',MASTER_DB:'master',FANMARK_DB:'business'})[row.binding],
})));
