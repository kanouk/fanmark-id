import assert from 'node:assert/strict';

// Keep the real local Worker/D1 response and delay only its delivery. Honour the
// client's abort signal so the previous five-second deadline fails this test.
export async function verifyStartupWait({ cdp, value, wait, navigate }) {
  const languages = ['ja', 'en', 'ko', 'id'];
  const messages = [];
  for (const language of languages) {
    const injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      localStorage.setItem('fanmark-language', ${JSON.stringify(language)});
      window.__startupWait = { reads: 0, aborted: 0 };
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
        if (url.pathname === '/api/system/maintenance') {
          window.__startupWait.reads++;
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 6_000);
            init.signal.addEventListener('abort', () => {
              clearTimeout(timer); window.__startupWait.aborted++; reject(new DOMException('Aborted', 'AbortError'));
            }, {once: true});
          });
        }
        return original(input, init);
      };
    })();` });
    try {
      await navigate('/');
      await wait('!!document.querySelector(".app-startup-status")?.textContent');
      const state = await value(`({ language: document.documentElement.lang,
        message: document.querySelector('.app-startup-status').textContent,
        reads: window.__startupWait.reads, aborted: window.__startupWait.aborted,
        busy: document.querySelector('[data-app-startup]').getAttribute('aria-busy'),
        controls: document.querySelectorAll('button,input,a[href]').length,
        overflow: document.documentElement.scrollWidth > innerWidth })`);
      assert.equal(state.language, language);
      assert.equal(state.busy, 'true');
      assert.equal(state.reads, 1);
      assert.equal(state.aborted, 0);
      assert.equal(state.controls, 0, 'Pending admission must not expose route controls');
      assert.equal(state.overflow, false);
      await wait('!!document.querySelector("#search") && !document.querySelector("[data-app-startup]")');
      assert.deepEqual(await value('window.__startupWait'), { reads: 1, aborted: 0 });
      messages.push(state.message);
    } finally {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
    }
  }
  assert.equal(new Set(messages).size, 4, 'All supported languages need their own waiting message');
  await value('localStorage.setItem("fanmark-language", "ja")');
  return { languages, delayedResponseMs: 6_000, keptGateClosed: true, readsPerNavigation: 1, aborted: 0 };
}
