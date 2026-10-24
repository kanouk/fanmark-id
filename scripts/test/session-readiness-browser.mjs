import assert from 'node:assert/strict';

// Exercise a real signed-in local session. Failure must not redirect, expose
// cached private controls, or revoke the cookie; retry must confirm that owner.
export async function verifySessionReadiness({ cdp, value, wait, navigate, clickText, owner }) {
  const injection = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const original = window.fetch.bind(window);
    window.__sessionFailure = { failed: true, reads: 0 };
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      if (url.pathname === '/api/auth/get-session') {
        window.__sessionFailure.reads++;
        if (window.__sessionFailure.failed) return new Response(JSON.stringify({error:'recovery_writer_unavailable'}),
          {status:503, headers:{'content-type':'application/json','retry-after':'60'}});
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      return original(input, init);
    };
  })();` });
  try {
    await navigate('/dashboard?session-retry=retained');
    await wait('!!document.querySelector("[role=alert] button")');
    assert.equal(await value('location.pathname+location.search'), '/dashboard?session-retry=retained');
    assert.equal(await value('document.body.innerText.includes('+JSON.stringify(owner.displayFanmark)+')'), false);
    assert.equal(await value('!!document.querySelector("[role=tab],#auth-email,#search")'), false);
    assert.equal(await value('window.__sessionFailure.reads'), 1, 'Session GET can refresh; no automatic replay of a mutating GET');
    await value('window.__sessionFailure.failed=false');
    await clickText('再試行');
    await wait('!!document.querySelector("[data-app-startup]")');
    await wait('document.body.innerText.includes('+JSON.stringify(owner.displayFanmark)+')');
    assert.equal(await value('location.pathname+location.search'), '/dashboard?session-retry=retained');
    assert.equal(await value('window.__sessionFailure.reads'), 2);
    return { session503KeepsGateClosed: true, retainedUrlAndCookie: true, retryConfirmsSameOwner: true };
  } finally {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {identifier: injection.identifier});
  }
}
