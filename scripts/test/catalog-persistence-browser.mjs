import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';

// Disposable actual local Worker/Master D1 only. Never used against production.
export async function verifyCatalogPersistence({ stack, cdp, value, wait, navigate, fill, clickText }) {
  const dbName = 'fanmark-public-emoji-catalog-v1', storeName = 'catalogs';
  const original = stack.fixtures.catalogVersion, next = 'b'.repeat(64);
  assert.notEqual(original, next);
  const master = await stack.runtime.getD1Database('MASTER_DB');
  const snapshot = command => value(`new Promise((resolve,reject)=>{const r=indexedDB.open(${JSON.stringify(dbName)},1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction(${JSON.stringify(storeName)},'readwrite');const store=tx.objectStore(${JSON.stringify(storeName)});let out;const request=store.get(location.origin);request.onsuccess=()=>{let record=request.result;${command};out=record;};tx.oncomplete=()=>{db.close();resolve(out??null);};tx.onabort=tx.onerror=()=>{db.close();reject(tx.error);};};})`);
  const probe = mode => `(() => {
    const p=window.__cacheProbe={requests:[],complete:0,writeFailures:0,mode:${JSON.stringify(mode)}};
    const original=fetch.bind(window);
    window.fetch=async(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);if(u.pathname==='/api/emoji/catalog')p.requests.push(u.search);const r=await original(input,init);if(u.pathname==='/api/emoji/catalog')p.complete++;return r;};
    if(p.mode==='denied')Object.defineProperty(window,'indexedDB',{configurable:true,get(){throw new DOMException('blocked','SecurityError');}});
    if(p.mode==='blocked')Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){return {};}}});
    if(p.mode==='quota'||p.mode==='abort'){
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args){if(this.name===${JSON.stringify(storeName)}){p.writeFailures++;if(p.mode==='quota')throw new DOMException('quota','QuotaExceededError');const r=put.apply(this,args);this.transaction.abort();return r;}return put.apply(this,args);};
    }
  })();`;
  let injected, switched = false;
  async function start(mode = 'normal') {
    if (injected) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
    injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probe(mode) });
    await navigate('/'); await wait('!!document.querySelector("button[aria-label=直接入力]")');
  }
  async function accept() {
    await value('document.querySelector("button[aria-label=直接入力]").click()');
    await wait('!!document.querySelector("[role=dialog] input")'); await fill('[role=dialog] input', '😀');
    await clickText('確定', 'document.querySelector("[role=dialog]")');
    await wait('!document.querySelector("[role=dialog]")&&document.querySelector("#search")?.innerText.includes("😀")');
    assert.equal(await value('!!document.querySelector("[data-emoji-catalog-notice]")'), false);
  }
  async function saved(version) {
    for (let n = 0; n < 200; n++) { const r = await snapshot(''); if (r && JSON.parse(r.payload).version === version && createHash('sha256').update(r.payload).digest('hex') === r.checksum) return r; await new Promise(resolve => setTimeout(resolve, 25)); }
    throw Error('Expected committed catalog snapshot: ' + version);
  }
  const queries = () => value('window.__cacheProbe.requests');
  const pageCount = Math.ceil(stack.fixtures.catalogCount / 500);
  try {
    // Existing startup test has already exercised catalog download and retry.
    await saved(original); await snapshot('store.delete(location.origin);record=null');
    await start(); await accept(); await saved(original);
    assert.equal((await queries()).length, pageCount);
    await start(); await accept();
    assert.deepEqual(await queries(), ['?limit=1']);

    // A shape-valid mutation with the original checksum must still be refused.
    await snapshot('const p=JSON.parse(record.payload);p.items[1].shortName+=" corrupted";record.payload=JSON.stringify(p);store.put(record,location.origin)');
    await start(); await accept(); await saved(original);
    assert.equal((await queries()).length, pageCount);

    for (const mode of ['denied', 'blocked']) {
      await start(mode); await accept();
      assert.equal((await queries()).length, pageCount);
    }
    await start(); await accept(); await saved(original);
    await snapshot('store.delete(location.origin);record=null');
    await start('quota'); await accept(); await wait('window.__cacheProbe.writeFailures>0');
    assert.equal(await snapshot(''), null, 'Quota failure must not leave a partial snapshot');
    await start(); await accept(); await saved(original);

    // Activate a second complete ready release through the normal local schema
    // guards. Preserve their audit/generation requirements; never drop triggers.
    await master.batch([
      master.prepare("INSERT INTO fanmark_emoji_master_release_imports(release_version,manifest_json,row_count,status) SELECT ?,'{}',row_count,'loading' FROM fanmark_emoji_master_release_imports WHERE release_version=?").bind(next, original),
      master.prepare("INSERT INTO fanmark_emoji_master_release_staging(release_version,ordinal,id,emoji,short_name,keywords_json,category,subcategory,codepoints_json,sort_order) SELECT ?,ordinal,id,emoji,CASE WHEN ordinal=1 THEN 'local cache version B' ELSE short_name END,keywords_json,category,subcategory,codepoints_json,sort_order FROM fanmark_emoji_master_release_staging WHERE release_version=?").bind(next, original),
      master.prepare("UPDATE fanmark_emoji_master_release_imports SET status='ready' WHERE release_version=?").bind(next),
      master.prepare("UPDATE fanmark_emoji_master_active_release SET previous_release_version=release_version,release_version=?,generation=generation+1,activation_id=?,action='promotion' WHERE singleton_id=1").bind(next, randomUUID()),
    ]);
    switched = true;
    // An aborted replacement keeps A intact but cannot serve A as current B.
    await start('abort'); await accept(); await wait('window.__cacheProbe.writeFailures>0');
    assert.equal(JSON.parse((await snapshot('')).payload).version, original);
    const failedQueries = await queries(); assert.equal(failedQueries.length, pageCount + 1);
    assert.ok(failedQueries.slice(1).every(q => new URLSearchParams(q).get('version') === next));
    await start(); await accept();
    const updated = await saved(next);
    assert.equal(JSON.parse(updated.payload).items[0].shortName, 'local cache version B');
    assert.equal((await queries()).length, pageCount + 1);
    await start(); await accept(); assert.deepEqual(await queries(), ['?limit=1']);
    return { coldFullPages: pageCount, warmMetadataRequests: 1, corruptionRefetched: true, storageDeniedAndBlockedFallback: true,
      quotaDoesNotBlockInput: true, abortedWriteKeepsPriorSnapshot: true, readyVersionChangeReloadsPinnedPages: true,
      newVersionSubsequentlyReused: true, actualWorkerAndIndexedDb: true };
  } finally {
    if (injected) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
    if (switched) await master.prepare("UPDATE fanmark_emoji_master_active_release SET previous_release_version=release_version,release_version=?,generation=generation+1,activation_id=?,action='rollback' WHERE singleton_id=1").bind(original, randomUUID()).run();
    // Restore the ordinary local ready selection before the rest of regression.
    await navigate('/');
  }
}
