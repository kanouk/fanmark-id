import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./repository";
import { PRODUCTION_RUNTIME, PRODUCTION_STORE_IDS } from "./production-runtime-identity";
import { shouldFreezeRecoveryWrites } from "./recovery-write-freeze";
import { BROADCAST_EMAIL_WEBHOOK_PATH } from "./broadcast-email-webhook-d1";

type AcceptanceEnv = Env & { STAGING_BACKUP_SOURCE_IDS?: string };
const COOKIE = "__Host-fanmark-migration-owner";
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const DOMAIN = "fanmark-production-owner-acceptance-v1\n";
const BOOTSTRAP = "/__migration/owner";
const GRANT = "/api/migration/owner-session";
const MAX_MS = 10 * 60_000;
type Grant = { format: "fanmark-production-owner-acceptance-v1"; runId: string; runtimeVersion: string;
  nonce: string; issuedAt: number; expiresAt: number };
const fail = (): never => { throw Error("production_owner_acceptance_unavailable"); };
function selected(env: AcceptanceEnv): boolean {
  if (env.PRODUCTION_OWNER_ACCEPTANCE_BACKEND !== "owner-browser-v1" ||
    env.BETTER_AUTH_URL !== "https://fanmark.id" || env.CUTOVER_WRITE_FREEZE !== "receipt_only" ||
    shouldFreezeRecoveryWrites(env.RECOVERY_WRITE_FREEZE) || env.D1_TOPOLOGY !== "split" ||
    env.RECOVERY_DRAIN_BACKEND !== "durable-object" || !env.RECOVERY_DRAIN ||
    env.RECOVERY_DRAIN_SCOPE_DIGEST !== PRODUCTION_RUNTIME.scope ||
    !UUID.test(env.CF_VERSION_METADATA?.id ?? "") || !HASH.test(env.VERIFIED_ACCESS_SECRET ?? "") ||
    [env.STRIPE_DISPATCH_BACKEND, env.LICENSE_EXPIRY_BACKEND, env.NOTIFICATION_ARCHIVE_BACKEND].some(Boolean)) return false;
  try {
    const ids = JSON.parse(env.STAGING_BACKUP_SOURCE_IDS ?? "null");
    return ids && Object.keys(ids).length === 5 && Object.entries(PRODUCTION_STORE_IDS).every(([k, v]) => ids[k] === v);
  } catch { return false; }
}
const origin = (r: Request) => new URL(r.url).origin === "https://fanmark.id";
async function signingKey(env: AcceptanceEnv): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.VERIFIED_ACCESS_SECRET!),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function mac(payload: string, env: AcceptanceEnv): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(env), new TextEncoder().encode(DOMAIN + payload)));
}
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
function b64(text: string): string { return btoa(text).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, ""); }
/** No secret export, user/session creation, datastore access, or HTTP route. */
export async function issueProductionOwnerAcceptance(env: AcceptanceEnv, input: { runId: string; expiresAt: number }, now = Date.now()) {
  if (!selected(env) || !input || Object.keys(input).sort().join(",") !== "expiresAt,runId" ||
    !UUID.test(input.runId) || !Number.isSafeInteger(input.expiresAt) ||
    input.expiresAt <= now || input.expiresAt > now + MAX_MS) fail();
  const grant: Grant = { format: "fanmark-production-owner-acceptance-v1", runId: input.runId,
    runtimeVersion: env.CF_VERSION_METADATA!.id, nonce: crypto.randomUUID(), issuedAt: now, expiresAt: input.expiresAt };
  const payload = b64(JSON.stringify(grant));
  return { token: payload + "." + hex(await mac(payload, env)), expiresAt: grant.expiresAt,
    runId: grant.runId, runtimeVersion: grant.runtimeVersion };
}
async function verify(token: string, env: AcceptanceEnv, now: number): Promise<Grant | null> {
  if (!selected(env) || typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/u.test(parts[0]) || !HASH.test(parts[1])) return null;
  try {
    const text = atob(parts[0].replace(/-/gu, "+").replace(/_/gu, "/")), g = JSON.parse(text) as Grant;
    if (b64(text) !== parts[0] || JSON.stringify(g) !== text ||
      Object.keys(g).sort().join(",") !== "expiresAt,format,issuedAt,nonce,runId,runtimeVersion" ||
      g.format !== "fanmark-production-owner-acceptance-v1" || !UUID.test(g.runId) || !UUID.test(g.nonce) ||
      g.runtimeVersion !== env.CF_VERSION_METADATA!.id || !Number.isSafeInteger(g.issuedAt) || !Number.isSafeInteger(g.expiresAt) ||
      g.issuedAt > now || g.expiresAt <= now || g.expiresAt <= g.issuedAt || g.expiresAt - g.issuedAt > MAX_MS) return null;
    const actual = Uint8Array.from(parts[1].match(/../gu)!, s => parseInt(s, 16));
    return await crypto.subtle.verify("HMAC", await signingKey(env), actual,
      new TextEncoder().encode(DOMAIN + parts[0])) ? g : null;
  } catch { return null; }
}
/** This admits the normal app router only. Existing Auth/MFA, permissions,
 * recovery fences and writer tracking still apply. Public traffic stays shut. */
export async function productionOwnerAcceptanceAllowed(r: Request, env: AcceptanceEnv, now = Date.now()): Promise<boolean> {
  if (!origin(r) || !selected(env)) return false;
  const rows = (r.headers.get("cookie") ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(COOKIE + "="));
  return rows.length === 1 && await verify(rows[0].slice(COOKIE.length + 1), env, now) !== null;
}
/** G5 also admits the existing signed Resend ingress for delivery verification.
 * It can write the delivery ledger; activating this mode crosses the conservative
 * forward-recovery boundary before opening any browser or provider request. */
export function productionOwnerAcceptanceIngressAllowed(r: Request, env: AcceptanceEnv): boolean {
  const u = new URL(r.url);
  return origin(r) && selected(env) && r.method === "POST" && !u.search && u.pathname === BROADCAST_EMAIL_WEBHOOK_PATH;
}
const SCRIPT = `const token=location.hash.slice(1);history.replaceState(null,'','${BOOTSTRAP}');
if(!token){document.body.textContent='確認用の入口が無効です。';}else{fetch('${GRANT}',{method:'POST',credentials:'same-origin',headers:{authorization:'Bearer '+token}}).then(r=>{if(!r.ok)throw Error();location.replace('/');}).catch(()=>{document.body.textContent='確認用の入口が失効しました。実施者へ戻ってください。';});}`;
/** Only the short-lived bearer is exchanged for a host-only HttpOnly cookie.
 * SameSite=None is required for Apple's cross-site form POST callback. */
export async function productionOwnerAcceptanceResponse(r: Request, env: AcceptanceEnv, now = Date.now()): Promise<Response | null> {
  if (!origin(r)) return null;
  const u = new URL(r.url); if (![BOOTSTRAP, GRANT].includes(u.pathname)) return null;
  const json = (status: number) => Response.json({ error: "production_owner_acceptance_unavailable" },
    { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  if (!selected(env) || u.search) return json(503);
  if (u.pathname === BOOTSTRAP && r.method === "GET") {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SCRIPT)));
    const cspHash = btoa(String.fromCharCode(...digest));
    return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本番移行の本人確認 | fanmark.id</title><body>確認用の入口を検査しています。<script>' + SCRIPT + "</script></body></html>",
      { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow", "content-security-policy": "default-src 'none'; script-src 'sha256-" + cspHash + "'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" } });
  }
  if (u.pathname !== GRANT || r.method !== "POST" || r.headers.get("origin") !== "https://fanmark.id") return json(403);
  const header = r.headers.get("authorization") ?? "", g = header.startsWith("Bearer ") ? await verify(header.slice(7), env, now) : null;
  if (!g) return json(403);
  if (r.body) { const reader = r.body.getReader(); try {
    if (!(await reader.read()).done) { await reader.cancel(); return json(403); }
  } finally { reader.releaseLock(); } }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer",
    "set-cookie": COOKIE + "=" + header.slice(7) + "; Path=/; Secure; HttpOnly; SameSite=None; Max-Age=" + Math.max(1, Math.floor((g.expiresAt - now) / 1000)) } });
}
export function privateProductionOwnerResponse(response: Response): Response {
  const result = new Response(response.body, response); result.headers.set("cache-control", "no-store");
  result.headers.append("vary", "Cookie"); result.headers.set("referrer-policy", "no-referrer"); return result;
}
export class ProductionOwnerAcceptanceService extends WorkerEntrypoint<AcceptanceEnv> {
  issue(input: { runId: string; expiresAt: number }) { return issueProductionOwnerAcceptance(this.env, input); }
}
