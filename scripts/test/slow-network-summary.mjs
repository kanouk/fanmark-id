import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function catalogPageCount(metadata) {
  assert.ok(Number.isSafeInteger(metadata?.total) && metadata.total > 0);
  assert.ok(Number.isSafeInteger(metadata?.limit) && metadata.limit > 0);
  assert.match(metadata.version, /^[0-9a-f]{64}$/);
  return Math.ceil(metadata.total / metadata.limit);
}

export function assertCompatibleSamples(samples) {
  assert.ok(samples.length);
  const common = sample => ({ entry: sample.entry, browser: sample.browser, viewport: sample.viewport,
    cpuSlowdown: sample.cpuSlowdown, origin: sample.origin, auditMode: sample.auditMode ?? 'passive',
    catalog: ['catalog-action', 'supporting-ux'].includes(sample.auditMode) ? { version: sample.catalogMetadata.version, total: sample.catalogMetadata.total } : sample.catalogMetadata });
  const profiles = new Map();
  for (const sample of samples) {
    assert.deepEqual(common(sample), common(samples[0]), 'Do not aggregate different builds, catalogs or browser/device configurations');
    if (profiles.has(sample.profile)) assert.deepEqual(sample.conditions, profiles.get(sample.profile), 'A profile name must have one network definition');
    else profiles.set(sample.profile, sample.conditions);
  }
}

// CLS uses the largest session window, excluding shifts after recent input.
// Windows end at a 1s gap or after 5s from their first shift.
export function largestShiftWindow(shifts) {
  let maximum = 0, current = 0, first = 0, previous = 0;
  for (const shift of shifts.filter(s => !s.recentInput).sort((a, b) => a.at - b.at)) {
    if (current && shift.at - previous < 1000 && shift.at - first < 5000) {
      current += shift.value;
    } else {
      first = shift.at;
      current = shift.value;
    }
    previous = shift.at;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

export function validateCatalogTransport(run) {
  catalogPageCount(run.catalogMetadata); // Validate the observed version/count.
  const requests = run.requests.filter(r => r.path === '/api/emoji/catalog');
  const resources = run.resources.filter(r => r.path === '/api/emoji/catalog');
  assert.ok(requests.length > 0);
  assert.equal(run.probe.catalog.length, requests.length);
  assert.equal(resources.length, requests.length, 'Every observed catalog body must finish');
  assert.ok(requests.every(r => r.method === 'GET' && r.status === 200 && Number.isFinite(r.end) && !r.failure));
  const probe = [], pages = [];
  for (const r of requests) {
    const q = new URLSearchParams(r.query);
    if (q.get('limit') === '1' && !q.has('offset')) probe.push(r);
    else {
      assert.equal(q.get('limit'), '500');
      const offset = Number(q.get('offset') || 0); assert.ok(Number.isSafeInteger(offset) && offset >= 0);
      if (offset > 0 || q.has('version')) assert.equal(q.get('version'), run.catalogMetadata.version);
      pages.push(offset);
    }
  }
  assert.ok(probe.length <= 1);
  if (pages.length) {
    assert.deepEqual(pages.sort((a, b) => a - b), Array.from({ length: Math.ceil(run.catalogMetadata.total / 500) }, (_, i) => i * 500));
    return { strategy: 'full-pages', requests: requests.length };
  }
  assert.equal(probe.length, 1); assert.equal(run.catalogMetadata.limit, 1);
  return { strategy: 'metadata-check', requests: 1 };
}

export function validateCatalogActionTransport(run) {
  assert.ok(Number.isFinite(run.catalogAction?.startMs) && Number.isFinite(run.catalogAction?.readyPaintMs));
  assert.ok(run.catalogAction.readyPaintMs >= run.catalogAction.startMs);
  const result = validateCatalogTransport(run);
  return { ...result, strategy: result.strategy === 'metadata-check' ? 'validated-local' : result.strategy };
}

export function summarizeRun(run) {
  assert.ok(run.probe.marks.readyPaint && run.probe.lcp.length);
  if (run.auditMode === 'supporting-ux') {
    assert.ok(Number.isFinite(run.probe.marks.publicChromePaint) && run.probe.marks.publicChromePaint > 0);
    assert.ok(run.interaction?.typed && run.interaction.submitted === false && Number.isFinite(run.interaction.inputPaintMs));
    assert.ok(Array.isArray(run.probe.authPositions));
  }
  const transport = run.auditMode === 'catalog-action' ? validateCatalogActionTransport(run) : undefined;
  const passiveTransport = run.auditMode === 'supporting-ux' ? validateCatalogTransport(run) : undefined;
  const expected = transport?.requests ?? passiveTransport?.requests ?? catalogPageCount(run.catalogMetadata);
  assert.equal(run.probe.catalog.length, expected);
  assert.deepEqual(run.probe.writes, []);
  assert.ok(run.requests.every(r => ['GET', 'HEAD', 'OPTIONS'].includes(r.method)));
  const catalog = run.resources.filter(r => r.path === '/api/emoji/catalog');
  assert.equal(catalog.length, expected);
  const network = run.requests.filter(r => !(r.fromSW || r.fromDisk || r.fromCache));
  const wire = rows => rows.reduce((total, r) => total + (r.wireBytes || 0), 0);
  const main = run.resources.find(r => r.path === run.entry);
  return {
    state: run.state,
    ...(passiveTransport ? { catalogTransport: passiveTransport, publicChromePaintMs: run.probe.marks.publicChromePaint,
      inputPaintMs: run.interaction?.inputPaintMs, fontStylesheetRequests: run.requests.filter(r => r.host === 'fonts.googleapis.com').length,
      authInputShiftPx: run.probe.authPositions.length ? Math.max(...run.probe.authPositions.map(p => p.top)) - Math.min(...run.probe.authPositions.map(p => p.top)) : 0 } : {}),
    ...(transport ? { catalogTransport: transport, catalogOperationReadyMs: run.catalogAction.readyPaintMs,
      catalogOperationWaitMs: run.catalogAction.waitMs } : {}),
    ttfbMs: run.navigation[0].ttfb,
    fcpMs: run.paints.find(p => p.name === 'first-contentful-paint').at,
    lcpMs: run.probe.lcp.at(-1).at,
    lcpElement: run.probe.lcp.at(-1).element,
    cls: largestShiftWindow(run.probe.shifts),
    uiReadyPaintMs: run.probe.marks.readyPaint,
    catalogBodyCompleteMs: Math.max(...catalog.map(r => r.end)),
    firstCatalogBodyCompleteMs: catalog[0].end,
    catalogEncodedBytes: catalog.reduce((total, r) => total + r.encodedBodySize, 0),
    mainJsDurationMs: main.duration,
    mainJsEncodedBytes: main.encodedBodySize,
    mainJsTransferBytes: main.transferSize,
    totalWireBytes: wire(network),
    precacheWireBytes: wire(network.filter(r => r.session !== 'page')),
    ogPrecacheWireBytes: wire(network.filter(r => r.session !== 'page' && r.path === '/og-image.png')),
    observedMs: run.observedMs,
    dialogOpenMs: run.dialogClick?.afterMs,
    longTaskCount: run.probe.longtasks.length,
    longTaskExcessMs: run.probe.longtasks.reduce((n, r) => n + Math.max(0, r.duration - 50), 0),
    requestCount: run.requests.length,
    serviceWorkerControlled: run.controlled,
    precachedPaths: [...new Set(run.cacheEntries.flatMap(cache => cache.paths))].sort(),
    resourceSummary: run.resources.filter(r => !r.path.startsWith('/api/')).map(r => ({
      host: r.host, path: r.path, startMs: r.start, endMs: r.end, encodedBytes: r.encodedBodySize, transferBytes: r.transferSize,
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [output, ...directories] = process.argv.slice(2);
  assert.ok(output && directories.length, 'Usage: node slow-network-summary.mjs output.json report-directory...');
  const samples = [];
  for (const directory of directories) {
    const report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
    assert.deepEqual(report.errors, [], 'Reject samples with runtime/instrumentation errors');
    assert.equal(report.runs.length, 2, 'Reject incomplete cold/warm pairs');
    for (const run of report.runs) samples.push({
      profile: report.profile, route: report.route, observedAt: report.observedAt, auditMode: report.auditMode ?? 'passive',
      browser: report.browser, conditions: report.conditions, cpuSlowdown: report.cpuSlowdown,
      viewport: report.viewport, origin: report.origin, entry: run.entry, catalogMetadata: run.catalogMetadata, ...summarizeRun(run),
    });
  }
  assertCompatibleSamples(samples);
  const groupKeys = [...new Set(samples.map(s => `${s.profile}:${s.route}:${s.state}`))];
  const fields = ['ttfbMs', 'fcpMs', 'lcpMs', 'cls', 'uiReadyPaintMs', 'catalogBodyCompleteMs', 'firstCatalogBodyCompleteMs', 'totalWireBytes', 'precacheWireBytes', 'ogPrecacheWireBytes', 'dialogOpenMs', 'catalogOperationReadyMs', 'catalogOperationWaitMs', 'catalogEncodedBytes', 'publicChromePaintMs', 'inputPaintMs', 'fontStylesheetRequests', 'authInputShiftPx'];
  const groups = groupKeys.map(key => {
    const rows = samples.filter(s => `${s.profile}:${s.route}:${s.state}` === key);
    const median = values => { const sorted = values.sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
    return { key, count: rows.length, metrics: Object.fromEntries(fields.filter(f => rows.every(s => s[f] !== undefined)).map(f => {
      const values = rows.map(s => s[f]); return [f, { median: median([...values]), min: Math.min(...values), max: Math.max(...values) }];
    })) };
  });
  await writeFile(output, JSON.stringify({ schemaVersion: 1, samples, groups }, null, 2) + '\n');
  console.log(JSON.stringify(groups, null, 2));
}
