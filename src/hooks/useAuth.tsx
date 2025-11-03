import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  emailConfirmed: boolean;
  requiresPasswordSetup: boolean;
  setRequiresPasswordSetup: (value: boolean) => void;
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
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [requiresPasswordSetup, setRequiresPasswordSetup] = useState(false);

  const loadUserSettings = async (userId: string) => {
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
  };

  const applySession = (nextSession: Session | null) => {
    setSession(nextSession);
    const nextUser = nextSession?.user ?? null;
    const confirmed = nextUser?.email_confirmed_at ? true : false;
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
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        applySession(session);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

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
        localStorage.removeItem('sb-ppqgtbjykitqtiaisyji-auth-token');
        localStorage.clear();
      } catch (e) {
        console.warn('Failed to clear localStorage:', e);
      }
      
      // Attempt Supabase logout (may fail if session is already invalid)
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn('Supabase logout error (expected if session was invalid):', error);
        // Don't throw - local logout is sufficient
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
    signOut,
    signingOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
