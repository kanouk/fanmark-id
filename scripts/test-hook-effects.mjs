import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual hook with dependency-aware effects, including cleanup.
function hookRuntime() {
  const slots = []; let cursor = 0; const pending = [];
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const api = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return api.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (changed(slots[i]?.deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps }; pending.push(() => { slots[i].cleanup = fn(); }); } },
  };
  return { api, render(fn) { cursor = 0; const value = fn(); pending.splice(0).forEach(effect => effect()); return value; }, unmount() { slots.forEach(slot => slot?.cleanup?.()); } };
}
const source = await readFile(new URL('../src/hooks/useFanmarkSearch.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(initialCatalogReady = true) {
  let catalogReady = initialCatalogReady;
  const h = hookRuntime(), reads = [], completed = [];
  let user = { id: 'owner-a' }, query = '😀';
  const t = key => key;
  const imports = {
    react: h.api,
    '@/lib/fanmark-availability': { loadFanmarkAvailability: () => { const d = deferred(); reads.push(d); return d.promise; } },
    '@/lib/recent-fanmarks': { loadRecentFanmarks: async () => [] },
    './useEmojiCatalog': { useEmojiCatalog: () => ({ ready: catalogReady }) },
    '@/lib/emoji-catalog-state': { requireEmojiCatalog: async () => true },
    './useTranslation': { useTranslation: () => ({ t }) },
    './useAuth': { useAuth: () => ({ user, loading: false }) },
    './useFavoriteFanmarks': { useInvalidateFavoriteFanmarks: () => () => {} },
    '@/lib/auth-backend': { betterAuthClient: {} },
    '@/lib/fanmark-registration-api': { invokeFanmarkRegistration() {} },
    '@/lib/fanmark-search-api': { recordFanmarkSearch: async () => {}, loadFanmarkSearchDetails: async () => ({ id: 'existing', status: 'active', current_owner_id: 'owner-a', has_active_license: true }) },
    '@/lib/emojiConversion': { canonicalizeEmojiString: v => v, segmentEmojiSequence: v => [...v], stripSkinToneModifiers: v => v, convertEmojiSequenceToIdPair: v => ({ emojiIds: [v], normalizedEmojiIds: [v] }) },
  };
  const exports = {};
  runInNewContext(code, { exports, require(name) { assert.ok(name in imports, name); return imports[name]; }, AbortController, process: { env: { NODE_ENV: 'test' } }, console: { error() {}, warn() {} } });
  const onSearchCompleted = v => completed.push(v);
  return { reads, completed, catalog(ready) { catalogReady = ready; }, render: () => h.render(() => exports.useFanmarkSearch({ searchQuery: query, onSearchCompleted })), query(v) { query = v; }, owner(v) { user = { id: v }; }, unmount: () => h.unmount() };
}

test('a late old search cannot replace a newer result or completion callback', async () => {
  const x = fixture(); x.render(); x.query('🌙'); x.render();
  x.reads[1].resolve({ available: true }); await settle();
  assert.equal(x.render().result.fanmark, '🌙');
  x.reads[0].resolve({ available: true }); await settle();
  assert.equal(x.render().result.fanmark, '🌙'); assert.deepEqual(x.completed, ['🌙']);
});
test('clearing input cancels late results and clears the loading state', async () => {
  const x = fixture(); x.render(); x.query(''); x.render(); x.reads[0].resolve({ available: true }); await settle();
  assert.equal(x.render().result, null); assert.equal(x.render().loading, false); assert.deepEqual(x.completed, []);
});
test('owner changes repeat the search and stale failures cannot clear its result', async () => {
  const x = fixture(); x.render(); x.owner('owner-b'); x.render();
  x.reads[1].resolve({ available: false, fanmark_id: 'existing' }); await settle();
  assert.equal(x.render().result.status, 'not_available');
  x.reads[0].reject(Error('old request failed')); await settle();
  assert.equal(x.render().result.status, 'not_available'); assert.equal(x.reads.length, 2);
});
test('ordinary rerenders do not issue another search; unmount blocks late callbacks', async () => {
  const x = fixture(); x.render(); x.render(); assert.equal(x.reads.length, 1); x.unmount();
  x.reads[0].resolve({ available: true }); await settle(); assert.deepEqual(x.completed, []);
});

const extensionSource = await readFile(new URL('../src/components/ExtendLicenseDialog.tsx', import.meta.url), 'utf8');
const extensionCode = ts.transpileModule(extensionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function extensionFixture() {
  const h = hookRuntime(), reads = [], selections = [];
  const imports = {
    react: h.api,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'date-fns': { addMonths: date => date }, 'date-fns-tz': { formatInTimeZone: () => 'date' },
    '@/lib/utils': { cn: () => '' }, '@/hooks/useTranslation': { useTranslation: () => ({ t: key => key }) },
    '@/lib/extension-coupon-api': {}, '@/lib/reference-master-api': { fetchExtensionPriceMaster: () => { const d = deferred(); reads.push(d); return d.promise; } },
    'lucide-react': {}, sonner: { toast: {} }, 'react-router-dom': { Link: 'Link' },
  };
  const exports = {};
  runInNewContext(extensionCode, { exports, require(name) {
    if (name.startsWith('@/components/ui/')) return new Proxy({}, { get: (_, key) => key });
    assert.ok(name in imports, name); return imports[name];
  }, console: { error() {} }, Date });
  let props = { target: { fanmarkId: 'synthetic', tierLevel: 1, licenseEnd: '2027-01-01T00:00:00Z' }, open: true, onChangePlan: plan => selections.push(plan), selectedPlan: null };
  return { reads, selections, render: () => h.render(() => exports.ExtendLicenseDialog(props)), update(value) { props = { ...props, ...value }; } };
}
const price = (tierLevel, months) => ({ tierLevel, months, priceYen: months * 100, isActive: true });
test('extension plans follow the latest target and ignore a slower prior response', async () => {
  const x = extensionFixture(); x.render();
  x.update({ target: { fanmarkId: 'second', tierLevel: 2, licenseEnd: '2027-01-01T00:00:00Z' } }); x.render();
  x.reads[1].resolve([price(2, 6)]); await settle(); x.render();
  x.reads[0].resolve([price(1, 1)]); await settle(); x.render();
  assert.equal(x.selections.at(-1).months, 6); assert.ok(x.selections.every(plan => plan?.months !== 1));
});
test('closing the extension dialog prevents late default-plan selection', async () => {
  const x = extensionFixture(); x.render(); x.update({ open: false }); x.render();
  x.reads[0].resolve([price(1, 1)]); await settle(); x.render(); assert.deepEqual(x.selections, []);
});
test('extension pricing preserves the selected duration; unrelated rerenders do not refetch', async () => {
  const x = extensionFixture(); x.update({ selectedPlan: { months: 12, price: 1200 } }); x.render(); x.render();
  assert.equal(x.reads.length, 1); x.reads[0].resolve([price(1, 1), price(1, 12)]); await settle(); x.render();
  assert.deepEqual(x.selections, []); assert.equal(x.reads.length, 1);
});


test('catalog-pending input is retained and only the latest query searches after readiness', async () => {
  const x = fixture(false);
  assert.equal(x.render().result, null);
  assert.equal(x.reads.length, 0);
  x.query('🌙'); x.render();
  assert.equal(x.reads.length, 0);
  x.catalog(true); x.render();
  assert.equal(x.reads.length, 1);
  x.reads[0].resolve({ available: true }); await settle();
  assert.equal(x.render().result.fanmark, '🌙');
  assert.deepEqual(x.completed, ['🌙']);
});

const inputSource = await readFile(new URL('../src/components/emoji-input/useEmojiInputController.tsx', import.meta.url), 'utf8');
const inputCode = ts.transpileModule(inputSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function inputFixture(clipboard = '') {
  const h = hookRuntime(), catalog = deferred(), changes = [], notices = [];
  let ready = false, demands = 0, value = '';
  const imports = {
    react: h.api,
    '@/hooks/useToast': {},
    '@/hooks/use-toast': { useToast: () => ({ toast: notice => notices.push(notice) }) },
    '@/hooks/useImeAwareSubmit': { useImeAwareSubmit: () => ({}) },
    '@/hooks/useTranslation': { useTranslation: () => ({ t: key => key }) },
    '@/hooks/useEmojiCatalog': { useEmojiCatalog: () => ({ ready }) },
    '@/lib/emoji-catalog-state': { requireEmojiCatalog: () => { demands++; return catalog.promise; } },
    '@/lib/emoji-display': { segmentEmojiForDisplay: v => Array.from(v) },
    '@/lib/emojiConversion': { canonicalizeEmojiString: v => v, segmentEmojiSequence: v => Array.from(v), extractEmojiString: v => v, convertEmojiSequenceToIdPair: v => ({ emojiIds: [v], normalizedEmojiIds: [v] }) },
    './model': { DEFAULT_MAX_LENGTH: 5 },
  };
  const exports = {};
  runInNewContext(inputCode, { exports, require(name) { assert.ok(name in imports, name); return imports[name]; },
    navigator: { clipboard: { readText: async () => clipboard } }, process: { env: { NODE_ENV: 'test' } }, console });
  return { changes, notices, demands: () => demands,
    ready() { ready = true; catalog.resolve(true); },
    render: () => h.render(() => exports.useEmojiInputController({ value, onChange: next => { value = next; changes.push(next); } })),
  };
}

test('empty clipboard reports empty content without demanding a stalled catalog', async () => {
  const x = inputFixture('  \n ');
  await x.render().handlePaste();
  assert.equal(x.demands(), 0);
  assert.equal(x.notices[0].title, 'common.clipboardEmptyTitle');
});
test('picker opens immediately and closing it cancels a pending emoji selection', async () => {
  const x = inputFixture();
  x.render().handleOpenChange(0, true);
  const picker = x.render();
  assert.equal(picker.activeIndex, 0);
  assert.equal(x.demands(), 0);
  const selection = picker.handleSelect(0, '😀');
  assert.equal(x.demands(), 1);
  picker.handleOpenChange(0, false); x.render();
  x.ready(); await selection;
  assert.deepEqual(x.changes, []);
});
test('an open picker resumes its selected emoji after catalog validation', async () => {
  const x = inputFixture();
  x.render().handleOpenChange(0, true);
  const selection = x.render().handleSelect(0, '😀');
  x.ready(); x.render(); await selection;
  assert.deepEqual(x.changes, ['😀']);
});
