interface AuthEnvironment {
  AUTH_DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
}

interface BetterAuthOptions {
  appName?: string;
  issuer?: string;
  trustedOrigins?: string[];
}

interface BetterAuthHandler {
  handler(request: Request): Promise<Response>;
}

export function captureMfaGeneration(env: Pick<AuthEnvironment, "AUTH_DB">): Promise<number | null>;

export function createAuth(
  env: AuthEnvironment,
  additionalPlugins?: unknown[],
  requestState?: number | null,
  assuranceBarrier?: unknown,
  authOptions?: BetterAuthOptions,
): BetterAuthHandler;
