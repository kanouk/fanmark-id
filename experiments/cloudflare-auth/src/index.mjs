import { captureMfaGeneration, createAuth } from "../../../workers/api/src/better-auth.mjs";

export { captureMfaGeneration, createAuth };

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
