import assert from 'node:assert/strict';
import test from 'node:test';
import {createCloudflareCredentialLease,createLeaseBoundCloudflareFetch} from './cloudflare-credential-lease.mjs';
const accountId = 'a'.repeat(32), url = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/d1/database/example/query';
const secret = 'synthetic_access_token_never_printed';

test('expired and nearly expired credentials refresh before the first network dispatch', async () => {
  for (const remaining of [-1, 0, 119999]) {
    let at = 1000000, expiresAt = at + remaining, refreshed = 0, requests = 0;
    const lease = createCloudflareCredentialLease({accountId, now:()=>at,
      load:async()=>({accountId,token:secret,expiresAt}), refresh:async()=>{refreshed++;expiresAt=at+3600000;}});
    const request = createLeaseBoundCloudflareFetch({lease,fetchImpl:async(_,o)=>{
      requests++;assert.equal(refreshed,1);assert.equal(o.headers.get('authorization'),'Bearer '+secret);
      return new Response(null,{status:200});}});
    await request(url,{method:'POST',body:'immutable request'});
    assert.equal(requests,1);assert.equal(refreshed,1);
    assert.ok(!JSON.stringify(await lease.acquire()).includes(secret));
  }
});

test('time advancing during a long run causes renewal for the next request', async () => {
  let at = 1000000, expiresAt = at + 3600000, token = secret, refreshes = 0;
  const lease=createCloudflareCredentialLease({accountId,now:()=>at,load:async()=>({accountId,token,expiresAt}),
    refresh:async()=>{refreshes++;token=secret+'_renewed';expiresAt=at+3600000;}});
  const sent=[];const request=createLeaseBoundCloudflareFetch({lease,fetchImpl:async(_,o)=>{
    sent.push(o.headers.get('authorization'));return new Response(null,{status:200});}});
  await request(url);at+=3590000;await request(url);
  assert.equal(refreshes,1);assert.deepEqual(sent,['Bearer '+secret,'Bearer '+secret+'_renewed']);
});

test('refresh failure, unchanged expiry, malformed expiry and wrong account dispatch nothing', async () => {
  for(const mode of ['failure','unchanged','expiry','account']){
    let dispatched=0;
    const lease=createCloudflareCredentialLease({accountId,now:()=>1000000,
      load:async()=>({accountId:mode==='account'?'b'.repeat(32):accountId,token:secret,expiresAt:mode==='expiry'?null:1000000}),
      refresh:async()=>{if(mode==='failure')throw Error('private '+secret);}});
    const request=createLeaseBoundCloudflareFetch({lease,fetchImpl:async()=>{dispatched++;}});
    await assert.rejects(request(url),e=>!e.message.includes(secret)&&/^cloudflare_credential_/.test(e.message));
    assert.equal(dispatched,0);
  }
});

test('concurrent reads share renewal and a write HTTP failure is never retried', async () => {
  let expiresAt=0,refreshes=0,requests=0;
  const lease=createCloudflareCredentialLease({accountId,load:async()=>({accountId,token:secret,expiresAt}),
    refresh:async()=>{refreshes++;await new Promise(r=>setTimeout(r,5));expiresAt=Date.now()+3600000;}});
  await Promise.all(Array.from({length:5},()=>lease.acquire()));assert.equal(refreshes,1);
  const request=createLeaseBoundCloudflareFetch({lease,fetchImpl:async()=>{requests++;return new Response(null,{status:401});}});
  assert.equal((await request(url,{method:'POST'})).status,401);assert.equal(requests,1);assert.equal(refreshes,1);
  await assert.rejects(request('https://example.com/'),/request_target_invalid/);assert.equal(requests,1);
});
