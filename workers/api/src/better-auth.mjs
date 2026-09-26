import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import bcrypt from "bcryptjs";
import { twoFactor } from "better-auth/plugins";
import { isResendAuthEmailConfigured, sendResendAuthEmail } from "./auth-email.mjs";

const bcryptPassword = {
  async hash(password) {
    return bcrypt.hash(password, 10);
  },
  async verify({ password, hash }) {
    return bcrypt.compare(password, hash);
  },
};

/**
 * Capture the single D1 MFA mutation generation before Better Auth verifies
 * TOTP. This intentionally does not parse or trust request cookies. The
 * value is only an optimistic concurrency token; the guarded INSERT checks it
 * again alongside the authoritative session, user, and factor rows.
 */
export async function captureMfaGeneration(env) {
  const row = await env.AUTH_DB.prepare(
    'select "generation" from "mfaGeneration" where "id" = 1 limit 1',
  ).first();
  const generation = Number(row?.generation);
  return Number.isInteger(generation) && generation >= 0 ? generation : null;
}

function createAdminMfaAssurancePlugin(
  env,
  requestState = null,
  assuranceBarrier = null,
) {
  const revokeMfaAssurance = async (userId) => {
    await env.AUTH_DB.prepare(
      'delete from "mfaAssurance" where "userId" = ?',
    )
      .bind(userId)
      .run();
  };

  return {
    id: "admin-mfa-assurance",
    hooks: {
      after: [
        {
          matcher(context) {
            return context.path === "/two-factor/verify-totp";
          },
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            // Better Auth's supported context exposes the newly issued
            // session, or the authoritative current session when verification
            // keeps that session. Compare its user with the endpoint result
            // before persisting assurance, without selecting a cookie here.
            const assuredSession = ctx.context.newSession || ctx.context.session;
            if (
              !returned?.user?.id ||
              !assuredSession?.session?.id ||
              !assuredSession.user?.id ||
              returned.user.id !== assuredSession.user.id
            ) {
              return;
            }

            // Re-read pre-existing sessions from the server-side store.
            // Better Auth's supported newSession context identifies a newly
            // issued session. This proof does not establish an atomic D1
            // transaction spanning session creation and this assurance write.
            if (!ctx.context.newSession) {
              const authoritative = await ctx.context.internalAdapter.findSession(
                assuredSession.session.token,
              );
              if (
                !authoritative?.session?.id ||
                authoritative.session.id !== assuredSession.session.id ||
                authoritative.user?.id !== assuredSession.user.id
              ) {
                return;
              }
            }

            const expectedGeneration = requestState;
            if (!Number.isInteger(expectedGeneration) || expectedGeneration < 0) {
              return;
            }

            // The optional barrier exists only for the local race proof. It
            // lets a real D1 mutation occur after Better Auth succeeds but
            // before the guarded INSERT, without adding a runtime endpoint.
            if (assuranceBarrier?.beforeInsert) {
              await assuranceBarrier.beforeInsert({
                userId: assuredSession.user.id,
                sessionId: assuredSession.session.id,
                generation: expectedGeneration,
              });
            }

            const now = new Date().toISOString();
            await env.AUTH_DB.prepare(
              `insert into "mfaAssurance" ("id", "userId", "sessionId", "factorId", "generation", "verifiedAt", "expiresAt")
               select ?, u."id", s."id", f."id", g."generation", ?, ?
               from "session" s
               join "user" u on u."id" = s."userId"
               join "twoFactor" f on f."userId" = u."id" and f."verified" = 1
               join "mfaGeneration" g on g."id" = 1
               where s."id" = ?
                 and s."userId" = ?
                 and u."twoFactorEnabled" = 1
                 and g."generation" = ?
                 and s."expiresAt" > ?
               on conflict ("sessionId") do update set
                 "userId" = excluded."userId",
                 "factorId" = excluded."factorId",
                 "generation" = excluded."generation",
                 "verifiedAt" = excluded."verifiedAt",
                 "expiresAt" = excluded."expiresAt"`,
            )
              .bind(
                crypto.randomUUID(),
                new Date().toISOString(),
                new Date(assuredSession.session.expiresAt).toISOString(),
                assuredSession.session.id,
                assuredSession.user.id,
                expectedGeneration,
                now,
              )
              .run();
          }),
        },
        {
          matcher(context) {
            return (
              context.path === "/two-factor/enable" ||
              context.path === "/two-factor/disable"
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            if (
              ctx.path === "/two-factor/disable" &&
              ctx.context.returned?.status !== true
            ) {
              return;
            }
            if (
              ctx.path === "/two-factor/enable" &&
              !ctx.context.returned?.method
            ) {
              return;
            }
            const userId = ctx.context.session?.user?.id;
            if (!userId) return;
            await revokeMfaAssurance(userId);
          }),
        },
      ],
    },
  };
}

async function assertUserCanCreateSession(env, userId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const user = await env.AUTH_DB.prepare(
      'select "banned", "banExpires" from "user" where "id" = ? limit 1',
    ).bind(userId).first();
    if (!user || (user.banned !== 0 && user.banned !== 1)) {
      throw APIError.from("INTERNAL_SERVER_ERROR", {
        message: "Authentication state is unavailable",
        code: "AUTH_STATE_UNAVAILABLE",
      });
    }
    if (user.banned === 0) return;

    const expiresAt = user.banExpires;
    const expiresAtMs = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
    if (expiresAt === null || !Number.isFinite(expiresAtMs) || expiresAtMs > Date.now()) {
      throw APIError.from("FORBIDDEN", {
        message: "This account is suspended",
        code: "BANNED_USER",
      });
    }

    const cleared = await env.AUTH_DB.prepare(
      'update "user" set "banned" = 0, "banReason" = null, "banExpires" = null where "id" = ? and "banned" = 1 and "banExpires" = ?',
    ).bind(userId, expiresAt).run();
    if (cleared.meta.changes === 1) return;
  }

  throw APIError.from("FORBIDDEN", {
    message: "This account is suspended",
    code: "BANNED_USER",
  });
}

export function createAuth(
  env,
  additionalPlugins = [],
  requestState = null,
  assuranceBarrier = null,
  authOptions = {},
) {
  const appName = authOptions.appName ?? "fanmark-auth-feasibility";
  const issuer = authOptions.issuer ?? appName;
  const resendEmailConfigured = isResendAuthEmailConfigured(env);
  const userStatusSelected = env.AUTH_USER_STATUS_BACKEND?.trim() === "d1";
  const additionalUserFields = {
    ...(userStatusSelected
      ? {
          banned: { type: "boolean", defaultValue: false, required: false, input: false, returned: false },
          banReason: { type: "string", required: false, input: false, returned: false },
          banExpires: { type: "date", required: false, input: false, returned: false },
        }
      : {}),
    ...(authOptions.signupCommandId
      ? {
          signupCommandId: {
            type: "string",
            required: false,
            input: false,
            returned: false,
          },
        }
      : {}),
  };
  const plugins = [
    twoFactor({ issuer }),
    createAdminMfaAssurancePlugin(env, requestState, assuranceBarrier),
    ...additionalPlugins,
  ];

  return betterAuth({
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    appName,
    trustedOrigins: authOptions.trustedOrigins ?? [env.BETTER_AUTH_URL],
    advanced: {
      database: {
        // Provisioning must apply and read back the schema before enabling this
        // backend. Avoid re-introspecting the verified D1 schema on every request.
        validateSchema: false,
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: authOptions.allowSignUp !== true,
      autoSignIn: false,
      requireEmailVerification: true,
      password: bcryptPassword,
      ...(resendEmailConfigured
        ? {
            sendResetPassword: async ({ user, url }) => sendResendAuthEmail(env, {
              kind: "passwordReset",
              to: user.email,
              userId: user.id,
              url,
            }),
          }
        : {}),
    },
    ...(resendEmailConfigured
      ? {
          emailVerification: {
            sendOnSignUp: authOptions.sendVerificationOnSignUp ?? true,
            sendVerificationEmail: async ({ user, url }) => sendResendAuthEmail(env, {
              kind: "verification",
              to: user.email,
              userId: user.id,
              url,
            }),
          },
        }
      : {}),
    user: {
      ...(Object.keys(additionalUserFields).length > 0
        ? { additionalFields: additionalUserFields }
        : {}),
      // The public /api/auth/delete-user path remains explicitly closed in
      // the Worker gateway. The account-deletion coordinator invokes this
      // Better Auth endpoint only after business cleanup and password proof.
      deleteUser: { enabled: true },
    },
    ...(userStatusSelected || authOptions.signupCommandId
      ? {
          databaseHooks: {
            ...(userStatusSelected
              ? {
                  session: {
                    create: {
                      before: async (session) => assertUserCanCreateSession(env, session.userId),
                    },
                  },
                }
              : {}),
            ...(authOptions.signupCommandId
              ? {
                  user: {
                    create: {
                      before: async (user) => ({
                        data: { ...user, signupCommandId: authOptions.signupCommandId },
                      }),
                    },
                  },
                }
              : {}),
          },
        }
      : {}),
    socialProviders: authOptions.socialProviders ?? {},
    plugins,
  });
}
