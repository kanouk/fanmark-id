/** Private migration artifact. Never log the payload, source, or keys. */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export const SOURCE_PROJECT = "ppqgtbjykitqtiaisyji";
const AAD = Buffer.from(`fanmark-admin-reenrollment-v1:${SOURCE_PROJECT}`);
const fail = () => { throw Error("admin_reenrollment_invalid_or_stale"); };
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export function adminSource(source) {
  if (source?.version !== 1 || !["users", "identities", "factors", "roles", "settings"].every(k => Array.isArray(source[k]))) fail();
  if (source.roles.length !== 1 || source.roles[0].role !== "admin") fail();
  const id = source.roles[0].user_id;
  const users = source.users.filter(u => u.id === id), factors = source.factors.filter(f => f.user_id === id);
  const settings = source.settings.filter(s => s.user_id === id);
  if (!uuid(id) || users.length !== 1 || factors.length !== 1 || settings.length !== 1) fail();
  const user = users[0], factor = factors[0];
  if (settings[0].plan_type !== "admin" || !uuid(factor.id) || factor.factor_type !== "totp" || factor.status !== "verified" || !/^[A-Z2-7]{32}$/.test(factor.secret)) fail();
  if (user.deleted_at !== null || user.is_anonymous !== false || user.is_sso_user !== false || ![null, false].includes(user.is_super_admin) || user.banned_until !== null) fail();
  if (!Number.isFinite(Date.parse(user.email_confirmed_at)) || typeof user.email !== "string" || !/^[^\s@]+@[^\s@]+$/.test(user.email) || !/^\$2[ab]\$10\$[./A-Za-z0-9]{53}$/.test(user.encrypted_password)) fail();
  return { user, factor, setting: settings[0] };
}

// Exclude login-updated timestamps and display names. Include all identity,
// authorization and credential state so final-source drift invalidates the proof.
export function adminSourceBinding(source, key) {
  const { user: u, factor: f, setting } = adminSource(source);
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
  const identity = source.identities.filter(i => i.user_id === u.id).map(i =>
    [i.id, i.provider, i.provider_id, i.subject]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHmac("sha256", key).update("source-binding-v1\0").update(JSON.stringify({
    id: u.id, email: u.email, password: u.encrypted_password, emailVerified: u.email_confirmed_at,
    bannedUntil: u.banned_until, deletedAt: u.deleted_at, anonymous: u.is_anonymous,
    sso: u.is_sso_user, superAdmin: u.is_super_admin, identity,
    factor: [f.id, f.factor_type, f.status, f.secret], role: "admin", plan: setting.plan_type,
  })).digest("hex");
}

export function sealAdminReenrollment(payload, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { version: 1, project: SOURCE_PROJECT, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function openAdminReenrollment(source, { capsule, key }, now = Date.now()) {
  try {
    if (capsule?.version !== 1 || capsule.project !== SOURCE_PROJECT || !Buffer.isBuffer(key) || key.length !== 32 || typeof capsule.ciphertext !== "string" || capsule.ciphertext.length > 65536) fail();
    const iv = Buffer.from(capsule.iv, "base64"), tag = Buffer.from(capsule.tag, "base64");
    if (iv.length !== 12 || tag.length !== 16) fail();
    const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAAD(AAD); decipher.setAuthTag(tag);
    const p = JSON.parse(Buffer.concat([decipher.update(Buffer.from(capsule.ciphertext, "base64")), decipher.final()]).toString("utf8"));
    const { user, factor } = adminSource(source);
    const at = Date.parse(p.verifiedAt), oldAt = Date.parse(p.sourceVerifiedAt);
    if (p.version !== 1 || p.sourceBinding !== adminSourceBinding(source, key) || p.userId !== user.id || p.sourceFactorId !== factor.id || p.sourceAal !== "aal2" || p.targetFreshSessionVerified !== true) fail();
    if (!Number.isFinite(now) || !Number.isFinite(at) || !Number.isFinite(oldAt) || oldAt > at || at - oldAt > 20 * 60000 || at > now || now - at > 24 * 3600000) fail();
    if (!uuid(p.factorId) || p.factorId === factor.id || !/^[A-Za-z0-9_-]{32}$/.test(p.rawSecret) || !Array.isArray(p.backupCodes) || p.backupCodes.length !== 10 || new Set(p.backupCodes).size !== 10 || p.backupCodes.some(c => typeof c !== "string" || !/^[A-Za-z0-9-]{8,32}$/.test(c))) fail();
    return p;
  } catch { fail(); }
}
