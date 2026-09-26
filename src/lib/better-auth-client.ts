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
