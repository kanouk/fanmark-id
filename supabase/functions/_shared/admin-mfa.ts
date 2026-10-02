export interface AuthenticatorAssuranceReader {
  getAuthenticatorAssuranceLevel(jwt: string): Promise<{
    data: { currentLevel: string | null } | null;
    error: unknown | null;
  }>;
}

/** Fail closed unless Supabase confirms this exact access token is at AAL2. */
export async function hasCurrentAal2(
  auth: AuthenticatorAssuranceReader,
  accessToken: string,
): Promise<boolean> {
  if (!accessToken) return false;

  try {
    const { data, error } = await auth.getAuthenticatorAssuranceLevel(
      accessToken,
    );
    return !error && data?.currentLevel === "aal2";
  } catch {
    return false;
  }
}
