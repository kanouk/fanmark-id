const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Page.navigate acknowledges the request before the new document necessarily
// commits. Wait for that document's loader, never the previous page's DOM.
export async function navigateDocument(cdp, url, { timeoutMs = 40_000 } = {}) {
  await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
  const loaded = new Set();
  const unsubscribe = cdp.on('Page.lifecycleEvent', event => {
    if (event.name === 'DOMContentLoaded') loaded.add(event.frameId + ':' + event.loaderId);
  });
  try {
    const navigation = await cdp.send('Page.navigate', { url });
    if (navigation.errorText || !navigation.loaderId || !navigation.frameId) {
      throw new Error('browser_document_navigation_failed');
    }
    const key = navigation.frameId + ':' + navigation.loaderId;
    const deadline = Date.now() + timeoutMs;
    while (!loaded.has(key)) {
      if (Date.now() >= deadline) throw new Error('browser_document_navigation_timeout');
      await delay(25);
    }
  } finally {
    unsubscribe();
  }
}
