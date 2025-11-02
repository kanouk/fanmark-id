import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getPendingInvitationCode, clearPendingInvitationCode } from '@/lib/oauth-invitation-helpers';

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
        
        // Handle pending invitation code for OAuth sign-ups
        if (event === 'SIGNED_IN' && session?.user) {
          const pendingInvitationCode = getPendingInvitationCode();
          if (pendingInvitationCode) {
            // Use setTimeout to defer Supabase calls and prevent deadlock
            setTimeout(async () => {
              try {
                // Check if this is a new user (no user_settings yet or no invited_by_code)
                const { data: existingSettings, error: checkError } = await supabase
                  .from('user_settings')
                  .select('id, invited_by_code')
                  .eq('user_id', session.user.id)
                  .maybeSingle();
                
                if (checkError) {
                  console.error('Error checking user settings:', checkError);
                } else if (existingSettings && !existingSettings.invited_by_code) {
                  // New user without invitation code - consume it
                  const { error: consumeError } = await supabase.rpc('use_invitation_code', {
                    code_to_use: pendingInvitationCode
                  });
                  
                  if (consumeError) {
                    console.error('Error consuming invitation code:', consumeError);
                  } else {
                    // Update user_settings with invitation code
                    const { error: updateError } = await supabase
                      .from('user_settings')
                      .update({ invited_by_code: pendingInvitationCode })
                      .eq('user_id', session.user.id);
                    
                    if (updateError) {
                      console.error('Error updating user settings with invitation code:', updateError);
                    }
                  }
                }
              } catch (error) {
                console.error('Error processing pending invitation code:', error);
              } finally {
                // Always clear the pending code
                clearPendingInvitationCode();
              }
            }, 0);
          } else {
            // Check if user_settings exists (for OAuth without invitation code)
            setTimeout(async () => {
              try {
                const { data: userSettings, error: checkError } = await supabase
                  .from('user_settings')
                  .select('id')
                  .eq('user_id', session.user.id)
                  .maybeSingle();
                
                if (checkError) {
                  console.error('Error checking user settings after OAuth:', checkError);
                } else if (!userSettings) {
                  // No user_settings found - signup was blocked by database trigger
                  console.error('OAuth signup blocked: Invitation code was required');
                  
                  // Sign out the partially created auth.users record
                  await supabase.auth.signOut();
                  
                  // Clear local state
                  setUser(null);
                  setSession(null);
                  setEmailConfirmed(false);
                }
              } catch (error) {
                console.error('Error during post-OAuth validation:', error);
              }
            }, 0);
          }
        }
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