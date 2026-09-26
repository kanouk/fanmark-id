import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { betterAuthClient, isBetterAuthEnabled } from '@/lib/auth-backend';

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
  setRequiresPasswordSetup: (value: boolean) => void;
  refreshSession: () => Promise<void>;
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
  const betterAuthEnabled = isBetterAuthEnabled();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [requiresPasswordSetup, setRequiresPasswordSetup] = useState(false);

  const loadUserSettings = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('requires_password_setup')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error loading user settings for auth context:', error);
        setRequiresPasswordSetup(false);
        return;
      }

      setRequiresPasswordSetup(Boolean(data?.requires_password_setup));
    } catch (error) {
      console.error('Unexpected error loading user settings:', error);
      setRequiresPasswordSetup(false);
    }
  }, []);

  const applySession = useCallback((nextSession: Session | null) => {
    const nextUser: AuthUser | null = nextSession?.user ? {
      id: nextSession.user.id,
      email: nextSession.user.email,
    } : null;
    setSession(nextUser ? { user: nextUser } : null);
    const confirmed = Boolean(nextSession?.user.email_confirmed_at);
    setUser(nextUser);
    setEmailConfirmed(confirmed);
    setLoading(false);

    if (nextUser) {
      setTimeout(() => {
        loadUserSettings(nextUser.id);
      }, 0);
    } else {
      setRequiresPasswordSetup(false);
    }
  }, [loadUserSettings]);

  const applyBetterAuthSession = useCallback((nextSession: Awaited<ReturnType<typeof betterAuthClient.getSession>>) => {
    const betterAuthUser = nextSession?.user;
    const nextUser: AuthUser | null = betterAuthUser ? {
      id: betterAuthUser.id,
      email: betterAuthUser.email,
    } : null;
    setSession(nextUser ? { user: nextUser } : null);
    setUser(nextUser);
    setEmailConfirmed(Boolean(betterAuthUser?.emailVerified));
    setRequiresPasswordSetup(false);
    setLoading(false);
  }, []);

  const refreshSession = useCallback(async () => {
    if (betterAuthEnabled) {
      try {
        applyBetterAuthSession(await betterAuthClient.getSession());
      } catch (error) {
        console.error('Error loading Better Auth session:', error);
        applyBetterAuthSession(null);
      }
      return;
    }

    try {
      const { data: { session: nextSession } } = await supabase.auth.getSession();
      applySession(nextSession);
    } catch (error) {
      console.error('Error loading Supabase session:', error);
      applySession(null);
    }
  }, [applyBetterAuthSession, applySession, betterAuthEnabled]);

  useEffect(() => {
    if (betterAuthEnabled) {
      void refreshSession();
      return;
    }

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        applySession(session);
      }
    );

    // THEN check for existing session
    void refreshSession();

    return () => subscription.unsubscribe();
  }, [applySession, betterAuthEnabled, refreshSession]);

  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    if (signingOut) return; // Prevent double clicks
    
    try {
      setSigningOut(true);
      
      // Clear local state first
      setUser(null);
      setSession(null);
      setEmailConfirmed(false);
      setRequiresPasswordSetup(false);
      
      // Clear localStorage
      try {
        localStorage.clear();
      } catch (e) {
        console.warn('Failed to clear localStorage:', e);
      }
      
      if (betterAuthEnabled) {
        await betterAuthClient.signOut();
      } else {
        // Attempt Supabase logout (may fail if session is already invalid)
        const { error } = await supabase.auth.signOut();
        if (error) {
          console.warn('Supabase logout error (expected if session was invalid):', error);
          // Don't throw - local logout is sufficient
        }
      }
    } catch (error) {
      console.error('Error during logout:', error);
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
    setRequiresPasswordSetup,
    refreshSession,
    signOut,
    signingOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
