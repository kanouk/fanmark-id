import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Actual local Worker/browser. Capability variants are synthetic UI responses;
// no OAuth, signup, mail or production request is sent by this test.
export async function verifySupportingUx({ stack, cdp, value, wait, navigate, fill, artifactDirectory }) {
  const paused = [];
  const unsubscribe = cdp.on('Fetch.requestPaused', event => { paused.push(event.requestId); });
  try {
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: stack.origin + '/src/main.tsx*', requestStage: 'Request' }] });
    // DOMContentLoaded waits for the deliberately held module; observe the
    // committed public HTML directly instead of using the normal navigation helper.
    const navigation = await cdp.send('Page.navigate', { url: stack.origin + '/profile' });
    assert.ok(navigation.loaderId && !navigation.errorText);
    await wait('location.pathname==="/profile"&&!!document.querySelector("[data-static-startup]")');
    await wait('document.querySelector("[data-static-startup] img").complete');
    assert.ok(paused.length);
    assert.equal(await value('document.querySelector("#root").querySelectorAll("button,a,input").length'), 0);
    assert.equal(await value('document.querySelector("[data-static-startup] img").naturalWidth>0'), true);
    assert.equal(await value('getComputedStyle(document.body).backgroundColor'), 'rgb(250, 247, 245)');
    await writeFile(artifactDirectory + '/before-js.png', Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'), { mode: 0o600 });
  } finally {
    for (const requestId of paused) await cdp.send('Fetch.continueRequest', { requestId });
    await cdp.send('Fetch.disable'); unsubscribe();
  }
  await wait('location.pathname==="/auth"&&!!document.querySelector("#auth-email")');
  assert.equal(await value('!!document.querySelector("[data-static-startup]")'), false);
  const variants = [];
  let injected;
  try {
    const cases = ['ja', 'en', 'ko', 'id'].flatMap(language => [320, 768].map(width => ({ language, width, variant: 'enabled' })));
    cases.push(...['disabled', 'one', 'error'].map(variant => ({ language: 'ja', width: 390, variant })));
    for (const scenario of cases) {
      if (injected) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
      injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
        localStorage.setItem('fanmark-language',${JSON.stringify(scenario.language)});
        const original=fetch.bind(window);
        window.fetch=async(input,init)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
          if(u.pathname!=='/api/auth/capabilities')return original(input,init);
          const r=await original(input,init);const body=await r.json();
          await new Promise(resolve=>window.__uxReleaseCapabilities=resolve);
          if(${JSON.stringify(scenario.variant)}==='error')return Response.json({},{status:503});
          return Response.json({...body,signUp:${scenario.variant !== 'disabled'},passwordReset:${scenario.variant !== 'disabled'},invitationRequired:false,
            socialProviders:${JSON.stringify(scenario.variant === 'disabled' ? [] : scenario.variant === 'one' ? ['google'] : ['google', 'apple', 'discord', 'github'])}});
        };
      })();` });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: scenario.width, height: 844, deviceScaleFactor: 1, mobile: true });
      await navigate('/auth'); await wait('!!window.__uxReleaseCapabilities&&!!document.querySelector("#auth-email")');
      assert.equal(await value('document.documentElement.lang'), scenario.language);
      assert.equal(await value('document.querySelector("[data-auth-capabilities]").dataset.authCapabilities'), 'loading');
      assert.equal(await value('document.querySelectorAll("[data-auth-capabilities-placeholder]").length'), 3);
      assert.equal(await value(`!!document.querySelector('a[href="/forgot-password"]')`), false);
      assert.equal(await value('document.querySelectorAll("form button[type=button]").length'), 1, 'Only the existing password toggle is mounted before capability confirmation');
      if (scenario.language === 'ja' && scenario.width === 320) await writeFile(artifactDirectory + '/auth-pending-320.png', Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'), { mode: 0o600 });
      await fill('#auth-email', 'retained@example.test');
      await value('window.__uxEmail=document.querySelector("#auth-email");true');
      const before = await value('({email:__uxEmail.getBoundingClientRect().top,submit:__uxEmail.closest("form").querySelector("button[type=submit]").getBoundingClientRect().top,login:document.querySelector("[role=tab]").getBoundingClientRect().x})');
      await value('window.__uxReleaseCapabilities();true');
      await wait('document.querySelector("[data-auth-capabilities]").dataset.authCapabilities!=="loading"');
      const after = await value('({email:__uxEmail.getBoundingClientRect().top,submit:__uxEmail.closest("form").querySelector("button[type=submit]").getBoundingClientRect().top,login:document.querySelector("[role=tab]").getBoundingClientRect().x})');
      assert.equal(await value('document.querySelector("#auth-email")===__uxEmail&&__uxEmail.value==="retained@example.test"&&document.activeElement===__uxEmail'), true);
      assert.ok(Math.abs(before.email - after.email) < 1 && Math.abs(before.submit - after.submit) < 1);
      if (scenario.variant === 'enabled') assert.ok(Math.abs(before.login - after.login) < 1);
      assert.equal(await value('document.querySelectorAll("[data-auth-capabilities-placeholder]").length'), 0);
      const providers = await value('document.querySelectorAll("form button[type=button]").length-1');
      assert.equal(providers, scenario.variant === 'enabled' ? 4 : scenario.variant === 'one' ? 1 : 0);
      assert.equal(await value(`!!document.querySelector('a[href="/forgot-password"]')`), ['enabled', 'one'].includes(scenario.variant));
      assert.ok(await value('document.documentElement.scrollWidth<=innerWidth'));
      if (scenario.language === 'ja' && scenario.width === 320) await writeFile(artifactDirectory + '/auth-ready-320.png', Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'), { mode: 0o600 });
      variants.push({ ...scenario, before, after, retainedInputAndFocus: true, providers });
    }
  } finally {
    if (injected) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await value('localStorage.setItem("fanmark-language","ja");true'); await navigate('/');
  }
  return { publicChromeBeforeJs: true, protectedRouteStillRefuses: true, variants };
}
