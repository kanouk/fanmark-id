import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
export async function verifyEmojiPalette({
  cdp,
  value,
  wait,
  navigate,
  artifactDirectory,
}) {
  const report = { layouts: [], syntheticProvider: true };
  const click = (selector) =>
    value("document.querySelector(" + JSON.stringify(selector) + ").click()");
  const query = async (text) => {
    await value(
      '(()=>{const i=document.querySelector("[data-palette-search]");i.focus();i.select();})()',
    );
    await cdp.send("Input.insertText", { text });
  };
  const textClick = (text) =>
    value(
      'Array.from(document.querySelector("[data-emoji-palette]").querySelectorAll("button")).find(b=>b.textContent.trim()===' +
        JSON.stringify(text) +
        ").click()",
    );
  const count = (n) =>
    wait(
      'document.querySelector("[data-emoji-palette]").innerText.includes(' +
        JSON.stringify(n + " / 5") +
        ")",
    );
  const status = (s) =>
    wait(
      'document.querySelector("[data-jev-status]")?.dataset.jevStatus===' +
        JSON.stringify(s),
    );
  const escape = async () => {
    for (const type of ["keyDown", "keyUp"])
      await cdp.send("Input.dispatchKeyEvent", {
        type,
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
    await wait('!document.querySelector("[data-palette-dialog]")');
  };
  const trigger = "#search button[aria-haspopup=dialog]:not(:disabled)";
  await value('localStorage.setItem("fanmark-language","ja")');
  await navigate("/");
  await wait("!!document.querySelector(" + JSON.stringify(trigger) + ")");
  assert.equal(
    await value(
      'performance.getEntriesByType("resource").some(e=>new URL(e.name).pathname.startsWith("/assets/palette-dictionary-"))',
    ),
    false,
    "Dictionary must not load during startup",
  );
  await wait(
    '(async()=> (await import("/src/lib/emojiConversion.ts")).getInstalledEmojiCatalog().items.length>0)()',
  );
  await value(
    `(()=>{const original=window.fetch.bind(window);window.__paletteRequests=[];window.__paletteMode='mock';window.__heldAvailability=[];window.__holdAvailability=true;window.fetch=async(input,init)=>{const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href);if(url.pathname==='/api/fanmarks/availability'&&window.__holdAvailability)await new Promise(r=>window.__heldAvailability.push(r));if(url.pathname!=='/api/emoji/palette/search')return original(input,init);const b=JSON.parse(init.body);window.__paletteRequests.push(b);if(window.__paletteMode==='real')return original(input,init);const release=(await import('/src/lib/emojiConversion.ts')).getInstalledEmojiCatalog(),find=e=>release.items.find(i=>i.emoji.replace(/\uFE0F/g,'')===e)?.id;const ids=[find('💈'),find('✂')];if(b.query==='slow')await new Promise(r=>setTimeout(r,1200));if(b.query==='unavailable')return new Response('{}',{status:503});return Response.json({catalogVersion:b.query==='stale'?'0'.repeat(64):release.version,dictionaryVersion:b.dictionaryVersion,schemaVersion:1,normalizationVersion:1,ids:b.query==='invalid'?['invalid-id']:b.query==='slow'?[find('😀')]:ids,cached:false});};})()`,
  );
  await click(trigger);
  await wait('!!document.querySelector("[data-palette-search]")');
  await textClick("すべてクリア");
  await count(0);
  await value(
    '(async()=>{await Promise.all(document.querySelector("[data-palette-dialog]").getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined)));return true;})()',
  );
  const beforeSearchPosition = await value(
    'document.querySelector("[data-palette-search]").getBoundingClientRect().top',
  );
  await query("美容室");
  await status("ready");
  assert.ok(
    Math.abs(
      (await value(
        'document.querySelector("[data-palette-search]").getBoundingClientRect().top',
      )) - beforeSearchPosition,
    ) < 2,
    "Suggestions must not move the search input",
  );
  await value(
    'window.__paletteInput=document.querySelector("[data-palette-search]");true',
  );
  await click('[data-palette-emoji="💈"]');
  await count(1);
  await click('[data-palette-emoji="✂️"]');
  await count(2);
  assert.equal(
    await value(
      'document.querySelector("[data-palette-search]")===window.__paletteInput&&window.__paletteInput.value==="美容室"',
    ),
    true,
    "Keep input DOM and text during continuous selection",
  );
  for (let i = 0; i < 3; i++) {
    await click('[data-palette-emoji="💈"]');
    await count(i + 3);
  }
  assert.equal(
    await value(
      '[...document.querySelectorAll("[data-palette-emoji]")].every(b=>b.disabled)',
    ),
    true,
  );
  await click('button[aria-label="削除 2"]');
  await count(4);
  await click('[data-palette-emoji="✂️"]');
  await count(5);
  await click('button[aria-label="左へ 2"]');
  await textClick("ひとつ戻す");
  await textClick("すべてクリア");
  await count(0);
  await textClick("ひとつ戻す");
  await count(5);
  assert.equal(
    await value(
      'Array.from(document.querySelector("#search").querySelectorAll("button")).some(b=>b.textContent.trim()==="取得する"&&!b.disabled)',
    ),
    false,
    "Old acquisition actions must disappear while a changed search is pending",
  );
  assert.ok(
    await value("window.__heldAvailability.length>0"),
    "Actual pending availability reads must be exercised",
  );
  await value(
    "window.__holdAvailability=false;window.__heldAvailability.forEach(r=>r())",
  );
  report.continuousMaxDeleteReaddMoveUndoClear = true;
  const previousSequence = await value(
    'Array.from(document.querySelectorAll("#search button[aria-haspopup=dialog]")).map(b=>b.textContent.trim()).join("")',
  );
  await query("");
  await click('[data-emoji-palette] button[aria-label="置き換え 1"]');
  await click('[data-palette-emoji="🌸"]');
  await wait('!document.querySelector("[data-palette-dialog]")');
  await wait('!!document.querySelector("[data-palette-undo]")');
  await click("[data-palette-undo]");
  assert.equal(
    await value(
      'Array.from(document.querySelectorAll("#search button[aria-haspopup=dialog]")).map(b=>b.textContent.trim()).join("")',
    ),
    previousSequence,
    "Replacement can be undone after its dialog closes",
  );
  report.replacementUndoAfterClose = true;
  await click(trigger);
  await wait('!!document.querySelector("[data-palette-search]")');

  for (const text of ["invalid", "stale", "unavailable"]) {
    await query(text);
    await status("error");
  }
  await query("slow");
  await wait('window.__paletteRequests.some(r=>r.query==="slow")');
  await query("fresh");
  await status("ready");
  await value("new Promise(r=>setTimeout(r,1300))");
  assert.equal(
    await value(
      "document.querySelector(" +
        JSON.stringify('[data-palette-emoji="😀"]') +
        ")===null",
    ),
    true,
    "Old response must not overwrite fresh candidates",
  );
  report.failedInvalidStaleAndReorderedResponses = true;
  const beforeIme = await value("window.__paletteRequests.length");
  await value(
    'document.querySelector("[data-palette-search]").focus();document.querySelector("[data-palette-search]").select()',
  );
  await cdp.send("Input.imeSetComposition", {
    text: "びよう",
    selectionStart: 3,
    selectionEnd: 3,
  });
  await value("new Promise(r=>setTimeout(r,500))");
  assert.equal(
    await value("window.__paletteRequests.length"),
    beforeIme,
    "No Jev calls during IME composition",
  );
  await cdp.send("Input.insertText", { text: "美容室" });
  await status("ready");
  report.imeSuppression = true;
  for (const request of await value("window.__paletteRequests"))
    assert.deepEqual(Object.keys(request).sort(), [
      "catalogVersion",
      "category",
      "dictionaryVersion",
      "normalizationVersion",
      "query",
      "schemaVersion",
      "variants",
    ]);
  const beforeDisabled = await value("window.__paletteRequests.length");
  await click("[data-emoji-palette] input[type=checkbox]");
  await query("coffee");
  await value("new Promise(r=>setTimeout(r,500))");
  assert.equal(await value("window.__paletteRequests.length"), beforeDisabled);
  await wait(
    "!!document.querySelector(" +
      JSON.stringify('[data-palette-emoji="☕️"]') +
      ")",
  );
  await click("[data-emoji-palette] input[type=checkbox]");
  report.dictionaryWithoutJev = true;
  await value('window.__paletteMode="real"');
  await query("real fallback");
  await status("error");
  report.actualWorkerWithoutSecretFallback = true;
  await query("");
  await value(
    'window.__originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==="fanmark.palette.history.v1")throw new DOMException("test denied","QuotaExceededError");return window.__originalStorageSet.call(this,k,v);};true',
  );
  await textClick("履歴を消す");
  await wait(
    'document.querySelector("[data-emoji-palette]").innerText.includes("履歴を保存できません")',
  );
  await count(5);
  await value("Storage.prototype.setItem=window.__originalStorageSet;true");
  report.historyWriteFailureKeepsInput = true;
  await escape();
  await wait(
    'document.activeElement?.getAttribute("aria-haspopup")===("dialog")',
  );
  for (const language of ["ja", "en", "ko", "id"])
    for (const width of [320, 768]) {
      await value(
        'localStorage.setItem("fanmark-language",' +
          JSON.stringify(language) +
          ")",
      );
      await navigate("/");
      await wait("!!document.querySelector(" + JSON.stringify(trigger) + ")");
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 844,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
      await click(trigger);
      await wait('!!document.querySelector("[data-palette-search]")');
      const bounds = await value(
        '(()=>{const d=document.querySelector("[data-palette-dialog]").getBoundingClientRect();return {left:d.left,right:d.right,scroll:document.documentElement.scrollWidth,width:innerWidth};})()',
      );
      assert.ok(
        bounds.left >= 0 && bounds.right <= width && bounds.scroll <= width,
      );
      report.layouts.push({ language, width, ...bounds });
      if (language === "ja" && width === 320)
        await writeFile(
          path.join(artifactDirectory, "emoji-palette-320.png"),
          Buffer.from(
            (await cdp.send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
          ),
          { mode: 0o600 },
        );
      await escape();
    }
  await value('localStorage.setItem("fanmark-language","ja")');
  return report;
}
