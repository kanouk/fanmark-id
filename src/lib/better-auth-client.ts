export interface BetterAuthUser {
  id: string;
  email: string;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  name?: string | null;
  image?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface BetterAuthSessionResponse {
  user: BetterAuthUser;
  session?: Record<string, unknown>;
}

export interface BetterAuthTwoFactorRedirect {
  twoFactorRedirect: true;
  twoFactorMethods: string[];
}

export type BetterAuthSignInResponse = BetterAuthSessionResponse | BetterAuthTwoFactorRedirect;

export type AdminSessionFailureReason =
  | 'unauthenticated'
  | 'admin_required'
  | 'mfa_enrollment_required'
  | 'mfa_required';

export type AdminSessionResult =
  | { authorized: true }
  | { authorized: false; reason: AdminSessionFailureReason };

export interface BetterAuthTotpEnrollment {
  method: 'totp';
  totpURI: string;
  backupCodes: string[];
}

export interface BetterAuthCapabilities {
  emailVerification: boolean;
  passwordReset: boolean;
  signUp: boolean;
  invitationRequired: boolean;
  socialProviders: string[];
}

export interface BetterAuthInvitationValidation {
  isValid: boolean;
  remainingUses: number;
  perks: Record<string, unknown>;
  invitationRequired: boolean;
}

export type BetterAuthTotpVerification =
  | { status: true }
  | { token: string; user: BetterAuthUser };

export class BetterAuthClientError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'BetterAuthClientError';
    this.status = status;
    this.code = code;
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface BetterAuthClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
}

const isSessionResponse = (value: unknown): value is BetterAuthSessionResponse => {
  if (!value || typeof value !== 'object' || !('user' in value)) return false;
  const user = (value as { user?: unknown }).user;
  return Boolean(
    user &&
    typeof user === 'object' &&
    typeof (user as { id?: unknown }).id === 'string' &&
    typeof (user as { email?: unknown }).email === 'string'
  );
};

const isTwoFactorRedirect = (value: unknown): value is BetterAuthTwoFactorRedirect => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { twoFactorRedirect?: unknown; twoFactorMethods?: unknown };
  return candidate.twoFactorRedirect === true &&
    Array.isArray(candidate.twoFactorMethods) &&
    candidate.twoFactorMethods.every((method) => typeof method === 'string');
};

const isAdminSessionResult = (value: unknown): value is AdminSessionResult => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { authorized?: unknown; error?: unknown };
  if (candidate.authorized === true) return true;
  return candidate.authorized !== true && [
    'unauthenticated',
    'admin_required',
    'mfa_enrollment_required',
    'mfa_required',
  ].includes(String(candidate.error));
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const responseError = (status: number, body: unknown): BetterAuthClientError => {
  const details = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const message = typeof details.message === 'string'
    ? details.message
    : typeof details.error === 'string'
      ? details.error
      : `Better Auth request failed (${status})`;
  return new BetterAuthClientError(
    message,
    status,
    typeof details.code === 'string' ? details.code : undefined,
  );
};

export const createBetterAuthClient = ({ baseUrl, fetchImpl = fetch }: BetterAuthClientOptions) => {
  const endpoint = (path: string) => `${baseUrl.replace(/\/$/u, '')}/api/auth/${path}`;
  const postAuth = async (path: string, body: Record<string, unknown>): Promise<unknown> => {
    const response = await fetchImpl(endpoint(path), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const responseBody = await readJson(response);
    if (!response.ok) throw responseError(response.status, responseBody);
    return responseBody;
  };

  return {
    async getCapabilities(): Promise<BetterAuthCapabilities> {
      const response = await fetchImpl(endpoint('capabilities'), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      const body = await readJson(response);
      if (!response.ok) throw responseError(response.status, body);
      if (!body || typeof body !== 'object') throw new Error('Better Auth returned invalid capabilities');
      const candidate = body as Record<string, unknown>;
      if (
        typeof candidate.emailVerification !== 'boolean' ||
        typeof candidate.passwordReset !== 'boolean' ||
        typeof candidate.signUp !== 'boolean' ||
        typeof candidate.invitationRequired !== 'boolean' ||
        !Array.isArray(candidate.socialProviders) ||
        !candidate.socialProviders.every((provider) => typeof provider === 'string')
      ) throw new Error('Better Auth returned invalid capabilities');
      return {
        emailVerification: candidate.emailVerification,
        passwordReset: candidate.passwordReset,
        signUp: candidate.signUp,
        invitationRequired: candidate.invitationRequired,
        socialProviders: candidate.socialProviders as string[],
      };
    },

    async validateInvitationCode(code: string): Promise<BetterAuthInvitationValidation> {
      const body = await postAuth('invitations/validate', { code });
      if (!body || typeof body !== 'object') throw new Error('Better Auth returned an invalid invitation response');
      const candidate = body as Record<string, unknown>;
      if (
        typeof candidate.isValid !== 'boolean' ||
        !Number.isSafeInteger(candidate.remainingUses) ||
        (candidate.remainingUses as number) < 0 ||
        typeof candidate.invitationRequired !== 'boolean' ||
        !candidate.perks || typeof candidate.perks !== 'object' || Array.isArray(candidate.perks)
      ) throw new Error('Better Auth returned an invalid invitation response');
      return {
        isValid: candidate.isValid,
        remainingUses: candidate.remainingUses as number,
        perks: candidate.perks as Record<string, unknown>,
        invitationRequired: candidate.invitationRequired,
      };
    },

    async signUpWithEmail(input: {
      email: string;
      password: string;
      commandId: string;
      invitationCode?: string | null;
      preferredLanguage: string;
    }): Promise<{ pending: boolean }> {
      const body = await postAuth('sign-up/email', {
        email: input.email,
        password: input.password,
        commandId: input.commandId,
        invitationCode: input.invitationCode ?? null,
        preferredLanguage: input.preferredLanguage,
      });
      if (!body || typeof body !== 'object' || (body as { status?: unknown }).status !== true) {
        throw new Error('Better Auth did not accept the signup request');
      }
      const pending = (body as { pending?: unknown }).pending;
      if (pending !== undefined && typeof pending !== 'boolean') {
        throw new Error('Better Auth returned an invalid signup response');
      }
      return { pending: pending === true };
    },

    async getSession(): Promise<BetterAuthSessionResponse | null> {
      const response = await fetchImpl(endpoint('get-session'), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      const body = await readJson(response);
      if (!response.ok) throw responseError(response.status, body);
      if (body === null) return null;
      if (!isSessionResponse(body)) throw new Error('Better Auth returned an invalid session response');
      return body;
    },

    async signInWithEmail(email: string, password: string): Promise<BetterAuthSignInResponse> {
      const body = await postAuth('sign-in/email', { email, password });
      if (isTwoFactorRedirect(body)) return body;
      if (!isSessionResponse(body)) throw new Error('Better Auth returned an invalid sign-in response');
      return body;
    },

    async signInWithSocial(
      provider: 'google' | 'github' | 'discord' | 'apple',
      callbackURL: string,
    ): Promise<string> {
      const body = await postAuth('sign-in/social', {
        provider,
        callbackURL,
        newUserCallbackURL: callbackURL,
        errorCallbackURL: callbackURL,
      });
      if (
        !body || typeof body !== 'object' ||
        typeof (body as { url?: unknown }).url !== 'string' ||
        (body as { redirect?: unknown }).redirect !== true
      ) throw new Error('Better Auth returned an invalid social sign-in response');
      const destination = new URL((body as { url: string }).url);
      if (destination.protocol !== 'https:' || destination.username || destination.password) {
        throw new Error('Better Auth returned an unsafe social sign-in URL');
      }
      return destination.href;
    },

    async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
      const body = await postAuth('request-password-reset', { email, redirectTo });
      if (!body || typeof body !== 'object' || (body as { status?: unknown }).status !== true) {
        throw new Error('Better Auth did not accept the password reset request');
      }
    },

    async sendVerificationEmail(email: string, callbackURL: string): Promise<void> {
      const body = await postAuth('send-verification-email', { email, callbackURL });
      if (!body || typeof body !== 'object' || (body as { status?: unknown }).status !== true) {
        throw new Error('Better Auth did not accept the verification email request');
      }
    },

    async resetPassword(token: string, newPassword: string): Promise<void> {
      const body = await postAuth('reset-password', { token, newPassword });
      if (!body || typeof body !== 'object' || (body as { status?: unknown }).status !== true) {
        throw new Error('Better Auth did not reset the password');
      }
    },

    async enableTotp(password: string): Promise<BetterAuthTotpEnrollment> {
      const body = await postAuth('two-factor/enable', { method: 'totp', password });
      if (
        !body ||
        typeof body !== 'object' ||
        (body as { method?: unknown }).method !== 'totp' ||
        typeof (body as { totpURI?: unknown }).totpURI !== 'string' ||
        !Array.isArray((body as { backupCodes?: unknown }).backupCodes) ||
        !(body as { backupCodes: unknown[] }).backupCodes.every((code) => typeof code === 'string')
      ) {
        throw new Error('Better Auth returned an invalid TOTP enrollment response');
      }
      return body as BetterAuthTotpEnrollment;
    },

    async verifyTotp(code: string): Promise<BetterAuthTotpVerification> {
      const body = await postAuth('two-factor/verify-totp', { code });
      if (body && typeof body === 'object' && (body as { status?: unknown }).status === true) {
        return { status: true };
      }
      if (
        body &&
        typeof body === 'object' &&
        typeof (body as { token?: unknown }).token === 'string' &&
        isSessionResponse(body)
      ) {
        const response = body as unknown as { token: string; user: BetterAuthUser };
        return {
          token: response.token,
          user: response.user,
        };
      }
      else {
        throw new Error('Better Auth returned an invalid TOTP verification response');
      }
    },

    async getAdminSession(): Promise<AdminSessionResult> {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/u, '')}/api/admin/session`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      const body = await readJson(response);
      if (response.ok && isAdminSessionResult(body) && body.authorized) return body;
      if (!response.ok && isAdminSessionResult(body) && !body.authorized) {
        return {
          authorized: false,
          reason: String((body as { error?: unknown }).error) as AdminSessionFailureReason,
        };
      }
      throw responseError(response.status, body);
    },

    async signOut(): Promise<void> {
      const response = await fetchImpl(endpoint('sign-out'), {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw responseError(response.status, await readJson(response));
    },
  };
};
