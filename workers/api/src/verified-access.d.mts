interface VerifiedAccessEnv {
  ACCESS_DB?: D1Database;
  MASTER_DB?: D1Database;
  D1_TOPOLOGY?: string;
  VERIFIED_ACCESS_ORIGIN?: string;
  VERIFIED_ACCESS_ORIGINS?: string;
  VERIFIED_ACCESS_SECRET?: string;
  VERIFIED_ACCESS_TEST?: string;
}

export function isVerifiedAccessPath(pathname: string): boolean;
export function handleVerifiedAccessRequest(
  request: Request,
  env: VerifiedAccessEnv,
): Promise<Response>;
export function setVerificationTestHooks(hooks?: Record<string, unknown>): void;

declare const verifiedAccess: {
  fetch(request: Request, env: VerifiedAccessEnv): Promise<Response>;
};

export default verifiedAccess;
