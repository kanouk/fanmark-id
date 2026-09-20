import { betterAuth } from "better-auth";
import bcrypt from "bcryptjs";

const bcryptPassword = {
  async hash(password) {
    return bcrypt.hash(password, 10);
  },
  async verify({ password, hash }) {
    return bcrypt.compare(password, hash);
  },
};

function createAuth(env) {
  return betterAuth({
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
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
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) {
      return createAuth(env).handler(request);
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, runtime: "workerd", database: "d1" });
    }

    return new Response("Not found", { status: 404 });
  },
};
