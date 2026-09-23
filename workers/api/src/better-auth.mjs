import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import bcrypt from "bcryptjs";
import { twoFactor } from "better-auth/plugins";

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

export function createAuth(
  env,
  additionalPlugins = [],
  requestState = null,
  assuranceBarrier = null,
  authOptions = {},
) {
  const appName = authOptions.appName ?? "fanmark-auth-feasibility";
  const issuer = authOptions.issuer ?? appName;
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
      autoSignIn: false,
      requireEmailVerification: true,
      password: bcryptPassword,
    },
    plugins,
  });
}
