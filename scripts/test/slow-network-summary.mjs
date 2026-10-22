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
    cpuSlowdown: sample.cpuSlowdown, origin: sample.origin, catalog: sample.catalogMetadata });
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

export function summarizeRun(run) {
  assert.ok(run.probe.marks.readyPaint && run.probe.lcp.length);
  const expected = catalogPageCount(run.catalogMetadata);
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
      profile: report.profile, route: report.route, observedAt: report.observedAt,
      browser: report.browser, conditions: report.conditions, cpuSlowdown: report.cpuSlowdown,
      viewport: report.viewport, origin: report.origin, entry: run.entry, catalogMetadata: run.catalogMetadata, ...summarizeRun(run),
    });
  }
  assertCompatibleSamples(samples);
  const groupKeys = [...new Set(samples.map(s => `${s.profile}:${s.route}:${s.state}`))];
  const fields = ['ttfbMs', 'fcpMs', 'lcpMs', 'cls', 'uiReadyPaintMs', 'catalogBodyCompleteMs', 'firstCatalogBodyCompleteMs', 'totalWireBytes', 'precacheWireBytes', 'ogPrecacheWireBytes', 'dialogOpenMs'];
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
