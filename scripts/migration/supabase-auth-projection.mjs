/** Offline projection only. Input/output contain credentials: never log or commit them.
 * No sessions, refresh tokens, pending verification links or MFA assurance are copied.
 * This does not prove a frozen source, production import, or provider callback readiness.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PROVIDERS = new Set(["email", "google", "github", "discord", "apple"]);
const fail = (code) => { throw new Error(`source_auth_${code}`); };
function uuid(value) { if (typeof value !== "string" || !UUID.test(value)) fail("uuid_invalid"); return value; }
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value))) fail("timestamp_invalid");
  return new Date(value).toISOString();
}
function unique(rows, field) {
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object" || map.has(uuid(row[field]))) fail("duplicate_or_invalid_row");
    map.set(row[field], row);
  }
  return map;
}
function flag(value) { if (value !== true && value !== false) fail("flag_invalid"); return value; }
function text(value) { if (typeof value !== "string" || !value.trim() || value.length > 4096) fail("text_invalid"); return value; }

// Supabase stores the Base32 representation of random bytes. Better Auth 1.7.5
// feeds the decrypted string's UTF-8 bytes to HMAC. A literal Base32 copy changes
// the key. Only a lossless UTF-8 decoding is portable through that SDK contract.
// Arbitrary binary secrets require protected reenrollment or a reviewed adapter.
function totpRawSecret(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = Uint8Array.from(bits.match(/.{8}/gu).map(part => parseInt(part, 2)));
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const encoded = new TextEncoder().encode(decoded);
    if (encoded.length !== bytes.length || encoded.some((byte, i) => byte !== bytes[i])) fail("totp_binary_key_requires_adapter");
    return decoded;
  } catch { fail("totp_binary_key_requires_adapter"); }
}

export async function projectSupabaseAuth(source, { encrypt } = {}) {
  if (!source || source.version !== 1 || typeof encrypt !== "function") fail("input_invalid");
  for (const table of ["users", "identities", "factors", "roles", "settings"]) {
    if (!Array.isArray(source[table]) || source[table].length > 20000) fail("table_invalid");
  }
  const observedAt = timestamp(source.observedAt);
  const users = unique(source.users, "id"), identities = unique(source.identities, "id");
  const factors = unique(source.factors, "id"), settings = unique(source.settings, "user_id");
  const emails = new Set(), subjects = new Set(), mfaUsers = new Set(), roleUsers = new Set();
  const tables = { user: [], account: [], twoFactor: [], adminRole: [] };
  // Validate every relation before performing encryption. Unknown inputs cannot be silently omitted.
  for (const u of users.values()) {
    if (u.deleted_at !== null || flag(u.is_anonymous) || flag(u.is_sso_user) || u.is_super_admin === true) fail("unsupported_user");
    if (u.is_super_admin !== null && u.is_super_admin !== false) fail("flag_invalid");
    const email = text(u.email);
    if (email !== email.trim() || !/^[^\s@]+@[^\s@]+$/u.test(email) || emails.has(email.toLowerCase())) fail("email_ambiguous");
    emails.add(email.toLowerCase());
    if (!settings.has(u.id)) fail("settings_missing");
    if (u.email_confirmed_at !== null) timestamp(u.email_confirmed_at);
    if (u.banned_until !== null) timestamp(u.banned_until);
    if (typeof u.encrypted_password !== "string" || (u.encrypted_password !== "" && !/^\$2[ab]\$10\$[./A-Za-z0-9]{53}$/u.test(u.encrypted_password))) fail("password_format_unsupported");
    timestamp(u.created_at); timestamp(u.updated_at);
  }
  for (const s of settings.values()) {
    if (!users.has(s.user_id)) fail("orphan_settings");
    if (s.display_name !== null && typeof s.display_name !== "string") fail("name_invalid");
    if (!["free", "creator", "max", "business", "enterprise", "admin"].includes(s.plan_type)) fail("plan_unsupported");
  }
  for (const i of identities.values()) {
    if (!users.has(uuid(i.user_id))) fail("orphan_identity");
    if (!PROVIDERS.has(i.provider)) fail("provider_unsupported");
    const subject = text(i.provider_id);
    if (i.subject !== subject) fail("identity_subject_mismatch");
    if (i.provider === "email" && subject !== i.user_id) fail("email_identity_mismatch");
    const key = JSON.stringify([i.provider, subject]);
    if (subjects.has(key)) fail("duplicate_identity");
    subjects.add(key);
    timestamp(i.created_at); timestamp(i.updated_at);
  }
  for (const f of factors.values()) {
    if (!users.has(uuid(f.user_id))) fail("orphan_factor");
    // Pending/unsupported/multiple factors require an explicit migration disposition.
    if (f.factor_type !== "totp" || f.status !== "verified" || !/^[A-Z2-7]{32}$/u.test(f.secret ?? "")) fail("factor_unsupported");
    totpRawSecret(f.secret);
    if (mfaUsers.has(f.user_id)) fail("multiple_factors");
    mfaUsers.add(f.user_id);
  }
  for (const r of source.roles) {
    if (!users.has(uuid(r.user_id))) fail("orphan_role");
    if (r.role !== "admin" || roleUsers.has(r.user_id)) fail("role_unsupported");
    if (settings.get(r.user_id).plan_type !== "admin" || !mfaUsers.has(r.user_id)) fail("admin_not_ready");
    roleUsers.add(r.user_id);
  }
  for (const s of settings.values()) if (s.plan_type === "admin" && !roleUsers.has(s.user_id)) fail("admin_role_mismatch");
  for (const u of users.values()) {
    if (!u.encrypted_password && ![...identities.values()].some(i => i.user_id === u.id && i.provider !== "email")) fail("no_signin_method");
    const s = settings.get(u.id);
    tables.user.push({ id: u.id, name: s.display_name?.trim() || "", email: u.email.toLowerCase(),
      emailVerified: u.email_confirmed_at === null ? 0 : 1, image: null,
      twoFactorEnabled: mfaUsers.has(u.id) ? 1 : 0,
      banned: u.banned_until !== null && Date.parse(u.banned_until) > Date.parse(observedAt) ? 1 : 0,
      banExpires: u.banned_until === null ? null : timestamp(u.banned_until), banReason: null,
      createdAt: timestamp(u.created_at), updatedAt: timestamp(u.updated_at) });
    if (u.encrypted_password) tables.account.push({ id: `credential:${u.id}`, accountId: u.id, providerId: "credential", userId: u.id,
      password: u.encrypted_password, createdAt: timestamp(u.created_at), updatedAt: timestamp(u.updated_at) });
  }
  for (const i of identities.values()) if (i.provider !== "email") {
    tables.account.push({ id: i.id, accountId: i.provider_id, providerId: i.provider, userId: i.user_id,
      password: null, createdAt: timestamp(i.created_at), updatedAt: timestamp(i.updated_at) });
  }
  try {
    for (const f of factors.values()) {
      const rawSecret = totpRawSecret(f.secret);
      const secret = await encrypt(rawSecret), backupCodes = await encrypt("[]");
      if (typeof secret !== "string" || !secret || secret === rawSecret || typeof backupCodes !== "string" || !backupCodes || backupCodes === "[]") fail("encryption_invalid");
      tables.twoFactor.push({ id: f.id, userId: f.user_id, secret, backupCodes, verified: 1, failedVerificationCount: 0, lockedUntil: null });
    }
  } catch { fail("encryption_failed"); }
  for (const r of source.roles) tables.adminRole.push({ userId: r.user_id, role: "admin" });
  return { version: 1, observedAt, productionReady: false, tables,
    omittedSessionState: ["session", "verification", "mfaAssurance"],
    recoveryCodes: "none-issued-reenroll-or-generate-after-verified-login" };
}
