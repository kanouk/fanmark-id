interface AuthEnvironment {
  AUTH_DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  AUTH_EMAIL_BACKEND?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

interface BetterAuthOptions {
  appName?: string;
  issuer?: string;
  trustedOrigins?: string[];
  socialProviders?: Partial<Record<"google" | "github" | "discord" | "apple", {
    clientId: string;
    clientSecret: string;
    disableSignUp: true;
  }>>;
}

interface BetterAuthHandler {
  handler(request: Request): Promise<Response>;
  api: {
    getSession(input: {
      headers: Headers;
      query?: { disableCookieCache?: boolean };
    }): Promise<{
      user: { id: string };
      session: { id: string; expiresAt: string | Date };
    } | null>;
  };
}

export function captureMfaGeneration(env: Pick<AuthEnvironment, "AUTH_DB">): Promise<number | null>;

export function createAuth(
  env: AuthEnvironment,
  additionalPlugins?: unknown[],
  requestState?: number | null,
  assuranceBarrier?: unknown,
  authOptions?: BetterAuthOptions,
): BetterAuthHandler;
