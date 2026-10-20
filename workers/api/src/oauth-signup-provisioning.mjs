import { APIError, addOAuthServerContext, createAuthMiddleware, getOAuthState } from "better-auth/api";
import { apple, discord, github, google } from "better-auth/social-providers";
import { assertUserCanCreateSession } from "./better-auth.mjs";

const PROVIDERS = { apple, discord, github, google };
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MARKER_FIELDS = ["oauthSignupCommandId", "oauthSignupProfileId", "oauthSignupProvider",
  "oauthSignupSubject", "oauthSignupLanguage", "oauthSignupState"];

function unavailable() {
  throw APIError.from("INTERNAL_SERVER_ERROR", {
    code: "oauth_provisioning_unavailable", message: "Unable to finish account setup",
  });
}

function conflict() {
  throw APIError.from("CONFLICT", {
    code: "oauth_identity_conflict", message: "Unable to finish account setup",
  });
}

function rows(result) {
  if (result?.success !== true || !Array.isArray(result.results)) unavailable();
  return result.results;
}

function marker(user) {
  if (!user || typeof user.id !== "string") unavailable();
  if (MARKER_FIELDS.every(field => user[field] == null)) return null;
  const value = {
    userId: user.id, commandId: user.oauthSignupCommandId, profileId: user.oauthSignupProfileId,
    provider: user.oauthSignupProvider, subject: user.oauthSignupSubject,
    language: user.oauthSignupLanguage, state: user.oauthSignupState,
  };
  if (!UUID.test(value.userId) || !UUID.test(value.commandId ?? "") || !UUID.test(value.profileId ?? "") ||
      !Object.hasOwn(PROVIDERS, value.provider ?? "") || typeof value.subject !== "string" ||
      value.subject.length === 0 || value.subject.length > 512 ||
      !LANGUAGES.has(value.language) || !["pending", "completed"].includes(value.state)) unavailable();
  return value;
}

async function readUser(database, userId) {
  // SELECT * deliberately supports unmarked users on the pre-marker schema.
  // A partial/non-null marker is rejected; a read failure never means unmarked.
  const users = rows(await database.prepare('SELECT * FROM "user" WHERE "id" = ? LIMIT 2').bind(userId).all());
  if (users.length !== 1) unavailable();
  return users[0];
}

async function readProfile(database, value) {
  const profiles = rows(await database.prepare("SELECT id, user_id FROM user_settings WHERE user_id = ? LIMIT 2")
    .bind(value.userId).all());
  if (profiles.length > 1) conflict();
  if (!profiles.length) return null;
  if (profiles[0].id !== value.profileId || profiles[0].user_id !== value.userId) conflict();
  return profiles[0];
}

async function finishProfile(env, value) {
  if (!env.FANMARK_DB) unavailable();
  let profile = await readProfile(env.FANMARK_DB, value);
  if (value.state === "completed") {
    // A deleted completed profile is not a creation retry; never resurrect it.
    if (!profile) unavailable();
    return;
  }
  if (!profile) {
    const timestamp = new Date().toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
    const username = `user_${value.userId.slice(0, 8)}`;
    const result = await env.FANMARK_DB.prepare(`INSERT INTO user_settings
      (id, user_id, username, display_name, plan_type, preferred_language,
       requires_password_setup, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'free', ?, 1, ?, ?)
      ON CONFLICT(user_id) DO NOTHING`).bind(value.profileId, value.userId, username, username,
        value.language, timestamp, timestamp).run();
    if (result?.success !== true) unavailable();
    profile = await readProfile(env.FANMARK_DB, value);
    if (!profile) unavailable();
  }
  // Do not delete Auth or Business rows after an uncertain acknowledgement.
  // The preassigned profile ID proves an earlier successful Business commit.
  const result = await env.AUTH_DB.prepare(`UPDATE "user" SET "oauthSignupState" = 'completed'
    WHERE "id" = ? AND "oauthSignupState" = 'pending'
      AND "oauthSignupCommandId" = ? AND "oauthSignupProfileId" = ?
      AND "oauthSignupProvider" = ? AND "oauthSignupSubject" = ? AND "oauthSignupLanguage" = ?`)
    .bind(value.userId, value.commandId, value.profileId, value.provider, value.subject, value.language).run();
  if (result?.success !== true) unavailable();
  const current = marker(await readUser(env.AUTH_DB, value.userId));
  if (!current || current.state !== "completed" || current.commandId !== value.commandId ||
      current.profileId !== value.profileId || current.provider !== value.provider ||
      current.subject !== value.subject || current.language !== value.language) conflict();
}

function trustedFlow(state, provider) {
  const flow = state?.serverContext?.fanmarkSignup;
  if (flow?.version !== 1 || flow.provider !== provider || !UUID.test(flow.commandId ?? "") ||
      !UUID.test(flow.profileId ?? "") || !LANGUAGES.has(flow.language)) return null;
  return flow;
}

function stableSubject(provider, subject) {
  if ((typeof subject !== "string" && typeof subject !== "number") ||
      (typeof subject === "number" && !Number.isFinite(subject))) unavailable();
  const value = String(subject);
  if (!Object.hasOwn(PROVIDERS, provider) || !value.trim() || value === "undefined" ||
      value === "null" || value.length > 512) unavailable();
  return value;
}

async function recoverPendingAccount(env, provider, subject) {
  const users = rows(await env.AUTH_DB.prepare(`SELECT * FROM "user"
    WHERE "oauthSignupProvider" = ? AND "oauthSignupSubject" = ? AND "oauthSignupState" = 'pending' LIMIT 2`)
    .bind(provider, subject).all());
  if (users.length > 1) conflict();
  if (!users.length) return;
  const value = marker(users[0]);
  if (!value || value.provider !== provider || value.subject !== subject) conflict();
  await assertUserCanCreateSession(env, value.userId);
  const owner = async () => rows(await env.AUTH_DB.prepare(`SELECT "userId" FROM "account"
    WHERE "providerId" = ? AND "accountId" = ? LIMIT 2`).bind(provider, subject).all());
  let owners = await owner();
  if (owners.length > 1 || (owners.length === 1 && owners[0].userId !== value.userId)) conflict();
  if (!owners.length) {
    const now = new Date().toISOString();
    const result = await env.AUTH_DB.prepare(`INSERT INTO "account"
      ("id", "accountId", "providerId", "userId", "createdAt", "updatedAt")
      SELECT ?, ?, ?, u."id", ?, ? FROM "user" u
      WHERE u."id" = ? AND u."oauthSignupState" = 'pending'
        AND u."oauthSignupProvider" = ? AND u."oauthSignupSubject" = ?
        AND u."oauthSignupCommandId" = ? AND u."oauthSignupProfileId" = ?
        AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."providerId" = ? AND a."accountId" = ?)`)
      .bind(crypto.randomUUID(), subject, provider, now, now, value.userId, provider, subject,
        value.commandId, value.profileId, provider, subject).run();
    if (result?.success !== true) unavailable();
    owners = await owner();
  }
  if (owners.length !== 1 || owners[0].userId !== value.userId) conflict();
}

export async function isOAuthSignupSchemaReady(authDatabase, businessDatabase) {
  if (!authDatabase || !businessDatabase) return false;
  try {
    const authColumns = rows(await authDatabase.prepare('PRAGMA table_info("user")').all());
    const businessColumns = rows(await businessDatabase.prepare('PRAGMA table_info("user_settings")').all());
    const fieldsReady = MARKER_FIELDS.every(field => authColumns.some(column => column.name === field)) &&
      ["banned", "banExpires"].every(field => authColumns.some(column => column.name === field)) &&
      ["id", "user_id", "username", "display_name", "plan_type", "preferred_language", "requires_password_setup"]
        .every(field => businessColumns.some(column => column.name === field));
    if (!fieldsReady) return false;
    // Columns alone do not prove the identity uniqueness required by recovery.
    // Match the checked-in unique indexes, including their partial predicates.
    const expectedIndexes = {
      user_oauthSignupCommandId_key: 'CREATE UNIQUE INDEX "user_oauthSignupCommandId_key" ON "user" ("oauthSignupCommandId") WHERE "oauthSignupCommandId" IS NOT NULL',
      user_oauthSignupProfileId_key: 'CREATE UNIQUE INDEX "user_oauthSignupProfileId_key" ON "user" ("oauthSignupProfileId") WHERE "oauthSignupProfileId" IS NOT NULL',
      user_oauthSignupIdentity_key: 'CREATE UNIQUE INDEX "user_oauthSignupIdentity_key" ON "user" ("oauthSignupProvider", "oauthSignupSubject") WHERE "oauthSignupSubject" IS NOT NULL',
      account_providerId_accountId_key: 'CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account" ("providerId", "accountId")',
    };
    const indexes = rows(await authDatabase.prepare(`SELECT name, sql FROM sqlite_master
      WHERE type = 'index' AND name IN (?, ?, ?, ?)`).bind(...Object.keys(expectedIndexes)).all());
    const normalizedSql = sql => typeof sql === "string" ? sql.replace(/[\s";]/gu, "").toLowerCase() : null;
    return Object.entries(expectedIndexes).every(([name, sql]) =>
      indexes.some(index => index.name === name && normalizedSql(index.sql) === normalizedSql(sql)));
  } catch {
    return false;
  }
}

export function createOAuthSignupIntegration(env, socialProviders, provisioningEnabled = false) {
  // Each parsed state object belongs to one validated callback. A cached Auth
  // instance must never keep a mutable last-provider/last-user proof.
  const verifiedIdentities = new WeakMap();
  const providers = { ...socialProviders };
  if (provisioningEnabled) {
    for (const [provider, options] of Object.entries(socialProviders)) {
      const original = PROVIDERS[provider](options);
      providers[provider] = {
        ...options,
        disableSignUp: false,
        getUserInfo: async tokens => {
          const result = await original.getUserInfo(tokens);
          if (!result?.user) return result;
          const state = await getOAuthState();
          if (!trustedFlow(state, provider)) return result;
          // Use the provider's declared account namespace, exactly as the SDK
          // does. Google/Apple subjects come from claims, not user.id or email.
          const subject = stableSubject(provider, await original.accountSubject({ tokens, profile: result.data }));
          verifiedIdentities.set(state, { provider, subject });
          await recoverPendingAccount(env, provider, subject);
          return result;
        },
      };
    }
  }

  const plugin = {
    id: "fanmark-oauth-signup",
    ...(provisioningEnabled ? {
      schema: { user: { fields: Object.fromEntries(MARKER_FIELDS.map(field => [field,
        { type: "string", required: false, input: false, returned: false }])) } },
      hooks: { before: [{
        matcher: context => context.path === "/sign-in/social",
        handler: createAuthMiddleware(async context => {
          const provider = context.body?.provider;
          if (!Object.hasOwn(socialProviders, provider ?? "")) return;
          const requestedLanguage = context.body?.additionalData?.preferredLanguage;
          await addOAuthServerContext({ fanmarkSignup: {
            version: 1, commandId: crypto.randomUUID(), profileId: crypto.randomUUID(), provider,
            language: LANGUAGES.has(requestedLanguage) ? requestedLanguage : "ja",
          } });
        }),
      }] },
    } : {}),
    init() {
      return { options: { databaseHooks: {
        session: { create: { before: async session => {
          const value = marker(await readUser(env.AUTH_DB, session.userId));
          if (!value) return;
          // Plugin hooks run before the core database hook in Better Auth.
          // Check suspension before doing any Business provisioning write.
          await assertUserCanCreateSession(env, value.userId);
          // Disabling new signup is not permission to bypass a pending marker.
          if (!provisioningEnabled && value.state === "pending") unavailable();
          if (value.state === "pending") {
            const owners = rows(await env.AUTH_DB.prepare(`SELECT "userId" FROM "account"
              WHERE "providerId" = ? AND "accountId" = ? LIMIT 2`).bind(value.provider, value.subject).all());
            if (owners.length !== 1 || owners[0].userId !== value.userId) conflict();
          }
          await finishProfile(env, value);
        } } },
        ...(provisioningEnabled ? {
          user: { create: { before: async (user, context) => {
            if (context?.path !== "/callback/:id") {
              if (context?.path === "/sign-in/social") unavailable();
              return;
            }
            const state = await getOAuthState();
            const identity = state && verifiedIdentities.get(state);
            const flow = identity && trustedFlow(state, identity.provider);
            // Database hooks receive the endpoint template, while params.id
            // identifies the provider selected by the validated callback.
            if (!flow || context.params?.id !== identity.provider) unavailable();
            return { data: { ...user, oauthSignupCommandId: flow.commandId,
              oauthSignupProfileId: flow.profileId, oauthSignupProvider: identity.provider,
              oauthSignupSubject: identity.subject, oauthSignupLanguage: flow.language,
              oauthSignupState: "pending" } };
          } } },
          account: { create: { before: async account => {
            const value = marker(await readUser(env.AUTH_DB, account.userId));
            if (!value || value.state === "completed") return;
            const state = await getOAuthState();
            const identity = state && verifiedIdentities.get(state);
            if (!identity || account.providerId !== value.provider || String(account.accountId) !== value.subject ||
                identity.provider !== value.provider || identity.subject !== value.subject) conflict();
          } } },
        } : {}),
      } } };
    },
  };
  return { plugin, socialProviders: providers };
}
