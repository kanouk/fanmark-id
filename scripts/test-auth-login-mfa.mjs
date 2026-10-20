import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {createBetterAuthClient, BetterAuthClientError} from '../src/lib/better-auth-client.ts';

const formSource = await readFile(new URL('../src/hooks/useAuthForm.tsx', import.meta.url), 'utf8');
const providerSource = await readFile(new URL('../src/hooks/useAuth.tsx', import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
function hooks() {
  const slots = []; let cursor = 0;
  return { reset() { cursor = 0; }, api: {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= {current: initial}; },
    useEffect() {}, useCallback(fn) { return fn; },
    createContext() { return {Provider: 'AuthProvider'}; }, useContext() { throw Error('unexpected_context_read'); },
  }};
}
function run(source, imports) {
  const exports = {};
  runInNewContext(compile(source), {exports, require(name) { assert.ok(name in imports, `Unexpected dependency ${name}`); return imports[name]; }, navigator: {language: 'ja'}, window: {}, console: {error() {}, warn() {}}});
  return exports;
}
function fixture({worker = true, factor = true, rejectCode = false, session = true, sessionFailure = false} = {}) {
  const calls = []; const h = hooks();
  const client = createBetterAuthClient({baseUrl: 'https://staging.example.invalid', fetchImpl: async (input, init) => {
    const path = new URL(String(input)).pathname; const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({path, body}); assert.equal(init.credentials, 'include');
    if (path.endsWith('/sign-in/email')) return Response.json(factor ? {twoFactorRedirect: true, twoFactorMethods: ['totp']} : {user: {id: 'synthetic-user', email: 'synthetic@example.invalid'}});
    if (path.endsWith('/two-factor/verify-totp')) return rejectCode ? Response.json({code: 'INVALID_CODE'}, {status: 401}) : Response.json({status: true});
    throw Error('unexpected_endpoint');
  }});
  const imports = {react: h.api, 'react-router-dom': {useNavigate: () => path => calls.push({navigation: path}), useLocation: () => ({state: {from: '/plans'}})},
    '@/hooks/use-toast': {useToast: () => ({toast() {}})}, '@/hooks/useTranslation': {useTranslation: () => ({t: key => key})},
    '@/integrations/supabase/client': {supabase: {auth: {signInWithPassword: async () => {calls.push({legacySignIn: true}); return {error: null}; }}}},
    '@/lib/auth-backend': {betterAuthClient: client, isBetterAuthEnabled: () => worker}, '@/lib/better-auth-client': {BetterAuthClientError},
    '@/hooks/useAuth': {useAuth: () => ({refreshSession: async () => { calls.push({refreshSession: true}); if (sessionFailure) throw Error('synthetic_outage'); return session; }})},
    '@/lib/language': {isActiveLanguage: code => ['ja','en','ko','id'].includes(code)},
  };
  const e = run(formSource, imports); const render = () => { h.reset(); return e.useAuthForm(); };
  let f = render(); f.updateFormData('email', 'synthetic@example.invalid'); f.updateFormData('password', 'Synthetic-existing-credential!'); f = render();
  return {calls, render, async start() { await render().signIn(); return render(); }};
}

test('MFA sign-in stays on challenge without guest refresh/navigation and clears the password', async () => {
  const x = fixture(); const f = await x.start(); assert.equal(f.twoFactorRequired, true); assert.equal(f.formData.password, ''); assert.equal(f.verificationCode, ''); assert.equal(x.calls.length, 1); assert.equal(f.authState.loading, false);
});
test('invalid and expired challenge responses retain the challenge and never claim a session', async () => {
  const x = fixture({rejectCode: true}); let f = await x.start(); f.setVerificationCode('123456'); await x.render().verifyTwoFactor(); f = x.render(); assert.equal(f.twoFactorRequired, true); assert.equal(f.verificationCode, ''); assert.equal(f.authState.error, 'mfa.verificationFailed'); assert.equal(x.calls.filter(c => c.refreshSession || c.navigation).length, 0);
});
test('successful TOTP waits for refreshed authentication, clears challenge, and leaves routing to Auth', async () => {
  const x = fixture(); let f = await x.start(); f.setVerificationCode('123456'); await x.render().verifyTwoFactor(); f = x.render(); assert.equal(f.twoFactorRequired, false); assert.equal(f.verificationCode, ''); assert.equal(f.authState.error, ''); assert.equal(x.calls.filter(c => c.refreshSession).length, 1); assert.equal(x.calls.filter(c => c.navigation || c.legacySignIn).length, 0);
});
test('missing or failed session refresh cannot complete MFA login', async () => {
  for (const options of [{session: false}, {sessionFailure: true}]) { const x = fixture(options); let f = await x.start(); f.setVerificationCode('123456'); await x.render().verifyTwoFactor(); f = x.render(); assert.equal(f.twoFactorRequired, true); assert.equal(f.authState.error, 'mfa.verificationFailed'); assert.equal(x.calls.some(c => c.navigation), false); }
});
test('cancel removes code and password and allows a fresh sign-in; incomplete codes never reach SDK', async () => {
  const x = fixture(); let f = await x.start(); f.setVerificationCode('123'); await x.render().verifyTwoFactor(); assert.equal(x.calls.length, 1); x.render().cancelTwoFactor(); f = x.render(); assert.equal(f.twoFactorRequired, false); assert.equal(f.verificationCode, ''); assert.equal(f.formData.password, ''); assert.equal(f.authState.error, '');
});
test('ordinary Cloudflare login also requires a valid refreshed session before completion', async () => {
  for (const session of [true, false]) { const x = fixture({factor: false, session}); const f = await x.start(); assert.equal(f.twoFactorRequired, false); assert.equal(x.calls.filter(c => c.refreshSession).length, 1); assert.equal(x.calls.some(c => c.navigation || c.legacySignIn), false); assert.equal(Boolean(f.authState.error), !session); }
});
test('legacy Supabase sign-in retains its existing dashboard behavior', async () => {
  const x = fixture({worker: false}); const f = await x.start(); assert.equal(f.twoFactorRequired, false); assert.equal(x.calls.some(c => c.legacySignIn), true); assert.equal(x.calls.at(-1).navigation, '/dashboard');
});

test('actual AuthProvider reports valid, missing and failed sessions and keeps guests unauthenticated', async () => {
  for (const outcome of ['valid', 'missing', 'failure']) { const h = hooks(); const e = run(providerSource, {
    react: h.api, 'react/jsx-runtime': {jsx: (type, props) => ({type, props})}, '@/integrations/supabase/client': {supabase: {}},
    '@/lib/auth-backend': {isBetterAuthEnabled: () => true, betterAuthClient: {getSession: async () => { if (outcome === 'failure') throw Error('synthetic_session_failure'); return outcome === 'valid' ? {user: {id: 'synthetic-user', emailVerified: true}} : null; }}},
    '@/lib/profile-api': {loadOwnProfile: async () => ({user_id: 'synthetic-user', requires_password_setup: false})},
  }); const render = () => {h.reset(); return e.AuthProvider({children: null}).props.value;}; assert.equal(await render().refreshSession(), outcome === 'valid'); const context = render(); assert.equal(Boolean(context.user && context.session), outcome === 'valid'); assert.equal(context.loading, false); }
});
