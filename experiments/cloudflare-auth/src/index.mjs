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
) {
  const plugins = [
    twoFactor({ issuer: "fanmark-auth-feasibility" }),
    createAdminMfaAssurancePlugin(env, requestState, assuranceBarrier),
    ...additionalPlugins,
  ];

  return betterAuth({
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    appName: "fanmark-auth-feasibility",
    trustedOrigins: [env.BETTER_AUTH_URL],
    advanced: {
      database: {
        // The schema is applied before this proof runs. Validation is disabled
        // here so every request does not re-introspect D1 in a fresh instance.
        validateSchema: false,
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      password: bcryptPassword,
    },
    plugins,
  });
}

function adminJson(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: { ...init.headers, "cache-control": "no-store" },
  });
}

async function adminResponse(request, env) {
  const auth = createAuth(env);
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  if (!session?.session) {
    return adminJson({ error: "unauthenticated" }, { status: 401 });
  }

  const adminRole = await env.AUTH_DB.prepare(
    'select "role" from "adminRole" where "userId" = ? limit 1',
  )
    .bind(session.user.id)
    .first();
  if (adminRole?.role !== "admin") {
    return adminJson({ error: "admin_required" }, { status: 403 });
  }

  const userState = await env.AUTH_DB.prepare(
    'select "twoFactorEnabled" from "user" where "id" = ? limit 1',
  )
    .bind(session.user.id)
    .first();
  const factorState = await env.AUTH_DB.prepare(
    'select "id", "verified" from "twoFactor" where "userId" = ? limit 1',
  )
    .bind(session.user.id)
    .first();
  if (Number(userState?.twoFactorEnabled) !== 1 || Number(factorState?.verified) !== 1) {
    return adminJson({ error: "mfa_required" }, { status: 403 });
  }

  const assurance = await env.AUTH_DB.prepare(
    `select "userId", "sessionId", "factorId", "generation", "expiresAt"
       from "mfaAssurance"
      where "userId" = ? and "sessionId" = ? limit 1`,
  )
    .bind(session.user.id, session.session.id)
    .first();
  if (
    assurance?.userId !== session.user.id ||
    assurance?.sessionId !== session.session.id ||
    assurance?.factorId !== factorState?.id
  ) {
    return adminJson({ error: "mfa_required" }, { status: 403 });
  }
  const assuranceExpiresAt = assurance?.expiresAt
    ? new Date(assurance.expiresAt).getTime()
    : NaN;
  if (!Number.isFinite(assuranceExpiresAt) || assuranceExpiresAt <= Date.now()) {
    return adminJson({ error: "mfa_required" }, { status: 403 });
  }

  return adminJson({
    ok: true,
    userId: session.user.id,
    sessionId: session.session.id,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/admin/protected") {
      return adminResponse(request, env);
    }

    if (url.pathname.startsWith("/api/auth/")) {
      let requestState = null;
      if (url.pathname === "/api/auth/two-factor/verify-totp") {
        try {
          requestState = await captureMfaGeneration(env);
        } catch {
          // A missing/unreadable generation must never create admin
          // assurance, but Better Auth can still complete the user-facing
          // TOTP response.
          requestState = null;
        }
      }
      const auth = createAuth(env, [], requestState);
      return auth.handler(request);
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, runtime: "workerd", database: "d1" });
    }

    return new Response("Not found", { status: 404 });
  },
};
