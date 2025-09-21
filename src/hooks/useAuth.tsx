import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  emailConfirmed: boolean;
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

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        const user = session?.user ?? null;
        const confirmed = user?.email_confirmed_at ? true : false;
        setUser(user);
        setEmailConfirmed(confirmed);
        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      const user = session?.user ?? null;
      const confirmed = user?.email_confirmed_at ? true : false;
      setUser(user);
      setEmailConfirmed(confirmed);
      setLoading(false);
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
    signOut,
    signingOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};