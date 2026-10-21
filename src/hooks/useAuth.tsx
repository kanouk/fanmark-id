import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { betterAuthClient } from '@/lib/auth-backend';
import { loadOwnProfile } from '@/lib/profile-api';

interface AuthUser {
  id: string;
  email?: string;
}

interface AuthSession {
  user: AuthUser;
}

interface AuthContextType {
  user: AuthUser | null;
  session: AuthSession | null;
  loading: boolean;
  emailConfirmed: boolean;
  requiresPasswordSetup: boolean;
  profileGateError: boolean;
  setRequiresPasswordSetup: (value: boolean) => void;
  refreshSession: () => Promise<boolean>;
  signOut: () => Promise<void>;
  signingOut: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [requiresPasswordSetup, setRequiresPasswordSetup] = useState(false);
  const [profileGateError, setProfileGateError] = useState(false);

  const applyBetterAuthSession = useCallback(async (nextSession: Awaited<ReturnType<typeof betterAuthClient.getSession>>) => {
    setProfileGateError(false);
    const betterAuthUser = nextSession?.user;
    const nextUser: AuthUser | null = betterAuthUser ? {
      id: betterAuthUser.id,
      email: betterAuthUser.email,
    } : null;
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
      const profile = await loadOwnProfile();
      if (profile.user_id !== nextUser.id) throw new Error('Profile identity did not match the Better Auth session');
      setRequiresPasswordSetup(profile.requires_password_setup);
      return true;
    } catch (error) {
      console.error('Error loading Better Auth profile gate:', error);
      setRequiresPasswordSetup(true);
      setProfileGateError(true);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const nextSession = await betterAuthClient.getSession();
      return await applyBetterAuthSession(nextSession);
    } catch (error) {
      console.error('Error loading Better Auth session:', error);
      await applyBetterAuthSession(null);
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
