import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const sources = Object.fromEntries(await Promise.all(['lib/plan-projection-polling.ts', 'hooks/usePlanProjectionPolling.ts', 'pages/PlanSelection.tsx'].map(async path => [path, await readFile(new URL('../src/' + path, import.meta.url), 'utf8')])));
function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return { get now() { return now; }, timers,
    setTimeout(fn, delay) { const key = ++id; timers.set(key, { at: now + delay, fn }); return key; },
    clearTimeout(key) { timers.delete(key); },
    async advance(target, settle = async () => {}) {
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
        await settle();
        for (let i = 0; i < 6; i++) await Promise.resolve();
        await settle();
      }
      now = target; await settle();
    },
  };
}
function load(path, imports, timer, window = {}) {
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  runInNewContext(ts.transpileModule(sources[path], { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require(key) { if (key === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }; assert.ok(key in imports, key); return imports[key]; }, setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout, console: { warn() {}, error() {} }, window, URLSearchParams });
  return exports;
}
function descendants(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(descendants)]; }
function harness() {
  const timer = clock(), slots = [], jobs = [];
  let cursor = 0, dirty = true, tree, profile = { user_id: 'owned-test', plan_type: 'business' }, reads = 0, commands = 0, cleared = 0;
  const storage = new Map();
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: null }; jobs.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const controller = load('lib/plan-projection-polling.ts', {}, timer);
  const polling = load('hooks/usePlanProjectionPolling.ts', { react, '@/lib/plan-projection-polling': controller }, timer);
  const user = { id: 'owned-test' };
  const window = { location: { search: '', pathname: '/plans' }, history: { replaceState() { window.location.search = ''; } }, sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, v) => storage.set(key, v), removeItem: key => storage.delete(key) } };
  let projectAt = Infinity;
  const readProfile = async options => { assert.equal(options?.silent, true); reads++; if (timer.now >= projectAt) { profile = { ...profile, plan_type: 'free' }; dirty = true; } };
  const imports = {
    react, 'react-router-dom': { useNavigate: () => () => {}, useLocation: () => ({ search: window.location.search, state: null }) },
    '@/hooks/useTranslation': { useTranslation: () => ({ t: (key, args) => key + (args?.plan ? ':' + args.plan : '') }) },
    '@/hooks/use-toast': { useToast: () => ({ toast() {} }) },
    '@/hooks/useProfile': { useProfile: () => ({ profile, loading: false, refetch: readProfile }) },
    '@/hooks/useAuth': { useAuth: () => ({ user }) },
    '@/hooks/useSubscription': { useSubscription: () => ({ refetch: async () => {} }) },
    '@/hooks/useSystemSettings': { useSystemSettings: () => ({ settings: {}, loading: false }) },
    '@/hooks/usePlanProjectionPolling': polling,
    '@/lib/utils': { cn: (...xs) => xs.filter(Boolean).join(' ') },
    '@/lib/plan-utils': { getPlanLimit: () => 3, formatPlanPrice: () => '0', evaluatePlanDowngrade: async () => ({ requiresSelection: false }) },
    '@/integrations/supabase/client': { supabase: {} },
    '@/lib/fanmark-return-api': {}, '@/lib/stripe-customer-portal-api': {},
    '@/lib/stripe-plan-change-api': { getStripePlanChangeBackend: () => 'worker', getStripePlanChangeRequestId: () => 'stable-command-id', clearStripePlanChangeRequestId: () => { cleared++; }, changeStripePlanThroughWorker: async input => { commands++; assert.equal(input.requestId, 'stable-command-id'); return { requiresAction: false }; } },
    '@/lib/stripe-plan-checkout-api': { clearStripePlanCheckoutRequestIds() {}, StripePlanCheckoutApiError: class extends Error {} },
  };
  for (const [path, name] of [['ui/button', 'Button'], ['ui/badge', 'Badge'], ['ui/card', 'Card'], ['FanmarkSelectionModal', 'FanmarkSelectionModal'], ['DowngradeWarningDialog', 'DowngradeWarningDialog']]) imports['@/components/' + path] = { [name]: name };
  imports['lucide-react'] = Object.fromEntries('Check ArrowLeft Loader2 Sparkle Crown Star ExternalLink Flame ShieldCheck TrendingUp TrendingDown'.split(' ').map(name => [name, name]));
  const component = load('pages/PlanSelection.tsx', imports, timer, window).default;
  const settle = async () => {
    for (let i = 0; i < 60; i++) {
      await Promise.resolve();
      if (dirty) { dirty = false; cursor = 0; tree = component(); while (jobs.length) jobs.shift()(); }
    }
    assert.equal(dirty, false, 'Effects must settle instead of restarting the timeout indefinitely');
  };
  return { timer, storage, window, settle, get tree() { return tree; }, get reads() { return reads; }, get commands() { return commands; }, get cleared() { return cleared; }, projectAt(value) { projectAt = value; },
    async cancelPaidPlan() { await settle(); const button = descendants(tree).find(x => x.type === 'Button' && x.props.children === 'planSelection.choosePlanCta:planSelection.free.name'); await button.props.onClick(); await settle(); await descendants(tree).find(x => x.type === 'DowngradeWarningDialog').props.onConfirm(); await settle(); },
  };
}

test('Free cancellation waits across the natural minute without another command or reload', async () => {
  const h = harness(); h.projectAt(61_000); await h.cancelPaidPlan(); assert.equal(h.commands, 1);
  await h.timer.advance(31_000, h.settle); assert.equal(h.cleared, 0); assert.ok(!descendants(h.tree).some(x => x.props?.role === 'status'));
  await h.timer.advance(65_000, h.settle); assert.equal(h.cleared, 1); assert.equal(h.commands, 1); assert.equal(h.storage.size, 0); assert.equal(h.timer.timers.size, 0);
});
test('Timeout retains the command and offers only reads, with no automatic restart from storage', async () => {
  const h = harness(); await h.cancelPaidPlan(); await h.timer.advance(90_000, h.settle);
  assert.equal(h.commands, 1); assert.equal(h.cleared, 0); assert.equal(h.storage.get('fanmark.plan-change.pending-plan'), 'free');
  assert.ok(descendants(h.tree).some(x => x.props?.role === 'status'));
  assert.ok(descendants(h.tree).filter(x => x.type === 'Button' && String(x.props.children).startsWith('planSelection.choosePlanCta')).every(x => x.props.disabled));
  const previousReads = h.reads; await h.timer.advance(180_000, h.settle); assert.equal(h.reads, previousReads); assert.equal(h.timer.timers.size, 0);
  h.projectAt(181_000); await descendants(h.tree).find(x => x.type === 'Button' && x.props.children === 'planSelection.checkAgain').props.onClick(); await h.settle();
  await h.timer.advance(184_000, h.settle); assert.equal(h.commands, 1); assert.equal(h.cleared, 1); assert.equal(h.timer.timers.size, 0);
});
test('Checkout return uses the same bounded read confirmation and retry instead of creating checkout again', async () => {
  const h = harness(); h.window.location.search = '?checkout=success'; await h.settle(); await h.timer.advance(90_000, h.settle);
  assert.ok(descendants(h.tree).some(x => x.props?.role === 'status')); assert.equal(h.commands, 0);
  h.projectAt(91_000); await descendants(h.tree).find(x => x.type === 'Button' && x.props.children === 'planSelection.checkAgain').props.onClick(); await h.settle();
  await h.timer.advance(95_000, h.settle); assert.equal(h.commands, 0); assert.ok(!descendants(h.tree).some(x => x.props?.role === 'status')); assert.equal(h.timer.timers.size, 0);
});
test('A slow or rejected read cannot overlap another batch or escape the deadline', async () => {
  const timer = clock(); const { startPlanProjectionPolling } = load('lib/plan-projection-polling.ts', {}, timer);
  let reads = 0, timeout = 0, resolve;
  startPlanProjectionPolling(() => { reads++; return new Promise(r => { resolve = r; }); }, () => { timeout++; });
  await timer.advance(89_000); assert.equal(reads, 1); assert.equal(timeout, 0);
  await timer.advance(90_000); assert.equal(timeout, 1); resolve(); await timer.advance(100_000); assert.equal(reads, 1); assert.equal(timer.timers.size, 0);
  let rejectReads = 0; const cancel = startPlanProjectionPolling(async () => { rejectReads++; throw Error('temporary read failure'); }, () => { timeout++; });
  await timer.advance(106_000); assert.ok(rejectReads > 1); cancel(); const n = rejectReads; await timer.advance(200_000); assert.equal(rejectReads, n); assert.equal(timeout, 1);
});
