interface AuthEmailEnvironment {
  AUTH_EMAIL_BACKEND?: string;
  BETTER_AUTH_URL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

type AuthEmailKind = "verification" | "passwordReset";

export function isResendAuthEmailConfigured(env: AuthEmailEnvironment): boolean;
export function sendResendAuthEmail(
  env: AuthEmailEnvironment,
  message: { kind: AuthEmailKind; to: string; url: string },
  fetchImpl?: typeof fetch,
): Promise<void>;
