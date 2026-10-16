/** Loopback helper engine, not a public authentication endpoint. No business API. */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Miniflare } from "../../workers/api/node_modules/miniflare/dist/src/index.js";
import { symmetricDecrypt } from "../../workers/api/node_modules/better-auth/dist/crypto/index.mjs";
import { createAuth, captureMfaGeneration } from "../../workers/api/src/better-auth.mjs";
import { businessMigrationStatements } from "./business-runtime-import-schema.mjs";
import { adminSource, adminSourceBinding, sealAdminReenrollment, openAdminReenrollment, SOURCE_PROJECT } from "./admin-reenrollment-capsule.mjs";

const fail = () => { throw Error("reenrollment_step_failed"); };
export function createReenrollmentSession({ source, sourceClient, readFreshSource, key, saveCapsule, now = Date.now }) {
  const { user, factor } = adminSource(source), binding = adminSourceBinding(source, key);
  const started = now(), deadline = started + 20 * 60000;
  let stage = "password", password = null, challengeId = null, sourceVerifiedAt = null, mf = null, db = null, env = null;
  let busy = false, attempts = 0, cookies = new Map(), inFlight = null;
  const dispose = async () => {
    password = null; cookies.clear();
    try { await sourceClient.auth.signOut({ scope: "local" }); } catch { /* never log provider errors */ }
    if (mf) { const current = mf; mf = null; await current.dispose(); }
    db = null; env = null;
  };
  const target = async (path, body) => {
    const auth = createAuth(env, [], await captureMfaGeneration(env), null, {
      appName: "fanmark.id", issuer: "fanmark.id Cloudflare", logger: { disabled: true },
    });
    const response = await auth.handler(new Request(`${env.BETTER_AUTH_URL}/api/auth${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin: env.BETTER_AUTH_URL,
        cookie: [...cookies.values()].join("; ") }, body: JSON.stringify(body),
    }));
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";", 1)[0], name = pair.split("=", 1)[0];
      if (/max-age=0(?:;|$)/i.test(value)) cookies.delete(name); else cookies.set(name, pair);
    }
    if (!response.ok) fail();
    return response.json();
  };
  const createIsolatedTarget = async () => {
    mf = new Miniflare({ workers: [{ config: { name: "admin-reenrollment-local", type: "worker", compatibilityDate: "2026-09-18",
      env: { AUTH_DB: { type: "d1", name: "admin-reenrollment-local" } },
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: "export default {fetch(){return new Response('not available',{status:404})}}" } } },
    } }] });
    db = await mf.getD1Database("AUTH_DB");
    for (const file of ["0003_better_auth_core.sql", "0007_auth_signup_command.sql", "0008_auth_user_suspension.sql", "0009_auth_oauth_signup.sql"]) {
      await db.batch(businessMigrationStatements(await readFile(new URL(`../../workers/api/migrations/${file}`, import.meta.url), "utf8")).map(s => db.prepare(s)));
    }
    // This single-user, in-memory store exists only after source AAL2. It has no
    // public handler, business records, exports, or remote binding. MFA-off here
    // permits the SDK's ordinary enrollment, never a production projection.
    const time = new Date(now()).toISOString();
    await db.batch([
      db.prepare('INSERT INTO "user" (id,name,email,emailVerified,twoFactorEnabled,createdAt,updatedAt) VALUES (?, ?, ?, 1, 0, ?, ?)').bind(user.id, "Migration administrator", user.email.toLowerCase(), time, time),
      db.prepare('INSERT INTO "account" (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(`credential:${user.id}`, user.id, "credential", user.id, user.encrypted_password, time, time),
      db.prepare('INSERT INTO "adminRole" (userId,role) VALUES (?, ?)').bind(user.id, "admin"),
    ]);
    env = { AUTH_DB: db, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), BETTER_AUTH_URL: "https://reenrollment.example.invalid", AUTH_USER_STATUS_BACKEND: "d1" };
    const login = await target("/sign-in/email", { email: user.email.toLowerCase(), password });
    if (login.user?.id !== user.id) fail();
    return target("/two-factor/enable", { method: "totp", password });
  };
  const assertFreshSource = async () => {
    if (adminSourceBinding(await readFreshSource(), key) !== binding) fail();
    if (stage === "closed" || now() >= deadline) fail();
  };
  return {
    status: () => ({ stage: now() >= deadline ? "closed" : stage, expired: now() >= deadline, remainingAttempts: Math.max(0, 5 - attempts) }),
    close: async () => { stage = "closed"; if (inFlight) await inFlight; await dispose(); },
    async step(input) {
      if (busy || stage === "done" || stage === "closed" || now() >= deadline || attempts >= 5) fail();
      busy = true; attempts += 1;
      let release; inFlight = new Promise(resolve => { release = resolve; });
      try {
        if (stage === "password") {
          if (typeof input.password !== "string" || input.password.length < 1 || input.password.length > 1024) fail();
          const signed = await sourceClient.auth.signInWithPassword({ email: user.email, password: input.password });
          if (signed.error || signed.data?.user?.id !== user.id || !signed.data.session) fail();
          const checked = await sourceClient.auth.getUser(signed.data.session.access_token);
          if (checked.error || checked.data?.user?.id !== user.id || !checked.data.user.factors?.some(f => f.id === factor.id && f.status === "verified" && f.factor_type === "totp")) fail();
          const challenge = await sourceClient.auth.mfa.challenge({ factorId: factor.id });
          if (challenge.error || typeof challenge.data?.id !== "string") fail();
          if (stage === "closed" || now() >= deadline) fail();
          challengeId = challenge.data.id; password = input.password; stage = "old-totp"; attempts = 0;
          return { stage };
        }
        if (!/^\d{6}$/.test(input.code ?? "")) fail();
        if (stage === "old-totp") {
          const verified = await sourceClient.auth.mfa.verify({ factorId: factor.id, challengeId, code: input.code });
          if (verified.error || typeof verified.data?.access_token !== "string") fail();
          // getUser validates this freshly returned token at Supabase; do not
          // trust a client-supplied JWT or decoded claims alone.
          const checked = await sourceClient.auth.getUser(verified.data.access_token);
          const claims = JSON.parse(Buffer.from(verified.data.access_token.split(".")[1], "base64url").toString("utf8"));
          if (checked.error || checked.data?.user?.id !== user.id || claims.sub !== user.id || claims.aal !== "aal2" || claims.iss !== `https://${SOURCE_PROJECT}.supabase.co/auth/v1` || !Number.isInteger(claims.exp) || !Number.isInteger(claims.iat) || claims.exp * 1000 <= now() || claims.iat * 1000 < started - 60000 || claims.iat * 1000 > now() + 60000) fail();
          await assertFreshSource(); sourceVerifiedAt = new Date(now()).toISOString();
          const enabled = await createIsolatedTarget();
          if (enabled.method !== "totp" || !enabled.totpURI || !Array.isArray(enabled.backupCodes)) fail();
          if (stage === "closed" || now() >= deadline) fail();
          stage = "new-totp"; attempts = 0;
          return { stage, totpURI: enabled.totpURI, backupCodes: enabled.backupCodes };
        }
        if (stage !== "new-totp") fail();
        await target("/two-factor/verify-totp", { code: input.code });
        // Prove a fresh password login demands the NEW factor. The same entered
        // TOTP is verified by the SDK, not by a custom algorithm in this helper.
        cookies.clear();
        const login = await target("/sign-in/email", { email: user.email.toLowerCase(), password });
        if (login.twoFactorRedirect !== true) fail();
        const verified = await target("/two-factor/verify-totp", { code: input.code });
        if (verified.user?.id !== user.id || typeof verified.token !== "string") fail();
        const row = await db.prepare(`SELECT f.id, f.secret, f.backupCodes FROM "session" s
          JOIN "user" u ON u.id=s.userId AND u.twoFactorEnabled=1 AND u.banned=0
          JOIN "adminRole" r ON r.userId=u.id AND r.role='admin'
          JOIN "twoFactor" f ON f.userId=u.id AND f.verified=1
          JOIN "mfaAssurance" a ON a.sessionId=s.id AND a.userId=u.id AND a.factorId=f.id
          JOIN "mfaGeneration" g ON g.id=1 AND g.generation=a.generation
          WHERE s.token=? AND u.id=? AND s.expiresAt>? AND a.expiresAt>?`).bind(verified.token, user.id, new Date(now()).toISOString(), new Date(now()).toISOString()).first();
        if (!row) fail();
        await assertFreshSource();
        const payload = { version: 1, userId: user.id, sourceFactorId: factor.id, sourceBinding: binding,
          sourceVerifiedAt, sourceAal: "aal2", verifiedAt: new Date(now()).toISOString(), targetFreshSessionVerified: true,
          factorId: row.id, rawSecret: await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: row.secret }),
          backupCodes: JSON.parse(await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: row.backupCodes })),
        };
        const capsule = sealAdminReenrollment(payload, key);
        openAdminReenrollment(source, { capsule, key }, now());
        await saveCapsule(capsule);
        stage = "done"; await dispose(); return { stage };
      } catch {
        // Setup failures after source verification are terminal. Never allow
        // retries to leave multiple isolated targets or save partial evidence.
        if (stage === "old-totp" && mf) { stage = "closed"; await dispose(); }
        if (attempts >= 5) { stage = "closed"; await dispose(); }
        fail();
      } finally { busy = false; release(); inFlight = null; }
    },
  };
}
