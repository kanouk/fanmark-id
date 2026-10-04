import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { createAuth } from "./index.mjs";

const syntheticAdminId = "77777777-7777-4777-8777-777777777777";
const syntheticFixtureBaseURL = "http://example.test/api/auth";

const syntheticOAuthFixturePlugin = {
  id: "synthetic-oauth-fixture",
  endpoints: {
    issueSyntheticOAuthSession: createAuthEndpoint(
      "/__fixture/oauth-equivalent-session",
      { method: "POST" },
      async (ctx) => {
        if (ctx.context.baseURL !== syntheticFixtureBaseURL) {
          throw new Error("synthetic OAuth fixture is local-only");
        }
        const user = await ctx.context.internalAdapter.findUserById(syntheticAdminId);
        if (!user) throw new Error("synthetic admin fixture is missing");
        const session = await ctx.context.internalAdapter.createSession(user.id);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ mode: "oauth-equivalent", userId: user.id });
      },
    ),
  },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/auth/")) {
      return new Response("Not found", { status: 404 });
    }
    return createAuth(env, [syntheticOAuthFixturePlugin]).handler(request);
  },
};
