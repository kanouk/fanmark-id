/** Deterministic, network-free credential capability for production transport fixtures. */
import {createCloudflareCredentialLease} from '../cloudflare-credential-lease.mjs';
import {readFileSync} from 'node:fs';
const {accountId}=JSON.parse(readFileSync(new URL('../../../docs/migration/production-resources.json',import.meta.url),'utf8'));
export function syntheticProductionCredential(token='synthetic_token_only'){
  return createCloudflareCredentialLease({accountId,
    load:async()=>({accountId,token,expiresAt:Date.now()+3600000}),
    refresh:async()=>{throw Error('synthetic_refresh_not_expected');}});
}
