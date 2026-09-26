interface AuthEmailEnvironment {
  AUTH_EMAIL_BACKEND?: string;
  AUTH_EMAIL_TEMPLATE_BACKEND?: string;
  BETTER_AUTH_URL?: string;
  D1_TOPOLOGY?: string;
  FANMARK_DB?: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

type AuthEmailKind = "verification" | "passwordReset";

export function isResendAuthEmailConfigured(env: AuthEmailEnvironment): boolean;
export function sendResendAuthEmail(
  env: AuthEmailEnvironment,
  message: { kind: AuthEmailKind; to: string; url: string; userId?: string },
  fetchImpl?: typeof fetch,
): Promise<void>;
