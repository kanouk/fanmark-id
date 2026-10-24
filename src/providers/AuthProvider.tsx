import { AuthContext, type AuthUser, type AuthSession } from "@/hooks/auth-context";
import { useQueryClient } from '@tanstack/react-query';
import { ownerQueryKey } from '@/lib/owner-query';
import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { betterAuthClient } from '@/lib/auth-backend';
import { loadOwnProfile } from '@/lib/profile-api';

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const queryClient = useQueryClient();
  const generation = useRef(0);
  const identity = useRef<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [requiresPasswordSetup, setRequiresPasswordSetup] = useState(false);
  const [profileGateError, setProfileGateError] = useState(false);

  const applyBetterAuthSession = useCallback(async (nextSession: Awaited<ReturnType<typeof betterAuthClient.getSession>>, request: number) => {
    if (request !== generation.current) return false;
    setProfileGateError(false);
    const betterAuthUser = nextSession?.user;
    const nextUser: AuthUser | null = betterAuthUser ? {
      id: betterAuthUser.id,
      email: betterAuthUser.email,
    } : null;
    if (identity.current !== (nextUser?.id ?? null)) {
      queryClient.clear();
      identity.current = nextUser?.id ?? null;
    }
    setSession(nextUser ? { user: nextUser } : null);
    setUser(nextUser);
    setEmailConfirmed(Boolean(betterAuthUser?.emailVerified));
    if (!nextUser) {
      setRequiresPasswordSetup(false);
      setLoading(false);
      return false;
    }

    // The Cloudflare profile row is authoritative for the OAuth first-password
    // gate. Keep protected routes closed if the profile read cannot be proved.
    setLoading(true);
    setRequiresPasswordSetup(true);
    try {
      const profile = await queryClient.fetchQuery({
        queryKey: ownerQueryKey('profile', nextUser.id),
        queryFn: () => loadOwnProfile({ expectedUserId: nextUser.id }),
        staleTime: 0,
        retry: false,
      });
      if (request !== generation.current) return false;
      if (profile.user_id !== nextUser.id) throw new Error('Profile identity did not match the Better Auth session');
      queryClient.setQueryData(ownerQueryKey('profile', nextUser.id), profile);
      setRequiresPasswordSetup(profile.requires_password_setup);
      return true;
    } catch (error) {
      if (request !== generation.current) return false;
      console.error('Error loading Better Auth profile gate:', error);
      setRequiresPasswordSetup(true);
      setProfileGateError(true);
      return false;
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [queryClient]);

  const refreshSession = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const nextSession = await betterAuthClient.getSession();
      return await applyBetterAuthSession(nextSession, request);
    } catch (error) {
      if (request !== generation.current) return false;
      console.error('Error loading Better Auth session:', error);
      // A failed verification is not an authoritative anonymous session. Keep
      // the URL and identity intact behind the readiness gate until retry.
      setProfileGateError(true);
      setLoading(false);
      return false;
    }
  }, [applyBetterAuthSession]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    if (signingOut) return; // Prevent double clicks

    try {
      setSigningOut(true);
      // Keep the authenticated UI until the server confirms revocation.
      await betterAuthClient.signOut();
      generation.current++;
      identity.current = null;
      queryClient.clear();
      setLoading(false);

      // Clear local state after Better Auth revocation succeeds.
      setUser(null);
      setSession(null);
      setEmailConfirmed(false);
      setRequiresPasswordSetup(false);
      setProfileGateError(false);

      // Clear localStorage
      try {
        localStorage.clear();
      } catch (e) {
        console.warn('Failed to clear localStorage:', e);
      }

    } catch (error) {
      console.error('Error during logout:', error);
      throw error;
    } finally {
      setSigningOut(false);
    }
  };

  const value = {
    user,
    session,
    loading,
    emailConfirmed,
    requiresPasswordSetup,
    profileGateError,
    setRequiresPasswordSetup,
    refreshSession,
    signOut,
    signingOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
