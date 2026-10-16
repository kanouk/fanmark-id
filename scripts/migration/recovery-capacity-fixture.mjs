/** Synthetic material sized from the metadata-only October13 source census. */
import {fixtureUser} from './application-recovery-set-contract.mjs';

export const CAPACITY_PROFILE = 'source-counts-2026-10-13';
export const CAPACITY_COUNTS = Object.freeze({users:15,accounts:18,avatars:69,covers:40,
  imageBytes:13285729,maxObjectBytes:1196603});
function check(value) {if (!value) throw new Error('proof_capacity_fixture_baseline');}

export async function seedCapacityFixture(bindings) {
  check(await bindings.auth.prepare('SELECT COUNT(*) n FROM user').first('n')===1);
  check(await bindings.auth.prepare('SELECT COUNT(*) n FROM account').first('n')===1);
  check(await bindings.business.prepare('SELECT COUNT(*) n FROM user_settings').first('n')===1);
  const password=await bindings.auth.prepare('SELECT password FROM account WHERE id=? AND userId=? AND providerId=?')
    .bind('synthetic-credential',fixtureUser,'credential').first('password');
  check(typeof password==='string' && /^\$2[ab]\$10\$/u.test(password));
  for (const store of ['avatars','covers']) {
    const listed=await bindings[store].list();check(!listed.truncated && listed.objects.length===0);
  }
  const now='2026-10-13T00:00:00.000Z',users=[fixtureUser];
  for(let i=1;i<15;i++) {
    const id=crypto.randomUUID();users.push(id);
    await bindings.auth.prepare('INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)')
      .bind(id,'Synthetic capacity '+i,'capacity-'+i+'@example.invalid',now,now).run();
    await bindings.business.prepare('INSERT INTO user_settings(id,user_id,username,display_name,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .bind('zz-capacity-profile-'+i,id,'capacity-owner-'+i,'Synthetic capacity '+i,now,now).run();
    const provider=i<=3?'credential':'google';
    await bindings.auth.prepare('INSERT INTO account(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)')
      .bind('zz-capacity-account-'+i,provider==='credential'?id:'synthetic-google-'+i,provider,id,
        provider==='credential'?password:null,now,now).run();
  }
  for(const [i,provider] of ['apple','github','discord'].entries()) {
    await bindings.auth.prepare('INSERT INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)')
      .bind('zz-capacity-'+provider,'synthetic-'+provider,provider,users[4+i],now,now).run();
  }
  const sizes=[CAPACITY_COUNTS.maxObjectBytes],remaining=CAPACITY_COUNTS.imageBytes-sizes[0];
  const per=Math.floor(remaining/108),remainder=remaining%108;
  for(let i=0;i<108;i++)sizes.push(per+(i<remainder?1:0));
  check(sizes.reduce((n,size)=>n+size,0)===CAPACITY_COUNTS.imageBytes);
  for(let i=0;i<sizes.length;i++) {
    const bytes=new Uint8Array(sizes[i]);
    for(let offset=0;offset<bytes.length;offset+=65536)crypto.getRandomValues(bytes.subarray(offset,Math.min(bytes.length,offset+65536)));
    const store=i<CAPACITY_COUNTS.avatars?'avatars':'covers';
    await bindings[store].put(fixtureUser+'/capacity-'+i+'.png',bytes,
      {storageClass:'Standard',httpMetadata:{contentType:'image/png'},customMetadata:{fixture:CAPACITY_PROFILE}});
    bytes.fill(0);
  }
  check(await bindings.auth.prepare('SELECT COUNT(*) n FROM user').first('n')===CAPACITY_COUNTS.users);
  check(await bindings.auth.prepare('SELECT COUNT(*) n FROM account').first('n')===CAPACITY_COUNTS.accounts);
  return {...CAPACITY_COUNTS};
}
