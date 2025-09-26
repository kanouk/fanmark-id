import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';

export const usePasswordReset = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        setIsValidSession(true);
        return;
      }

      const accessToken = searchParams.get('access_token');
      const refreshToken = searchParams.get('refresh_token');
      const type = searchParams.get('type');

      if (accessToken && refreshToken && type === 'recovery') {
        try {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });

          if (error) throw error;
          setIsValidSession(true);
        } catch (error) {
          console.error('Error setting session:', error);
          navigate('/forgot-password');
        }
      } else {
        navigate('/forgot-password');
      }
    };

    checkSession();
  }, [navigate, searchParams]);

  const resetPassword = async () => {
    if (password !== confirmPassword) {
      toast({
        title: t('common.error'),
        description: t('common.passwordMismatch'),
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) throw error;

      toast({
        title: t('common.passwordUpdated'),
        description: t('common.passwordUpdatedDesc'),
      });

      navigate('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      toast({
        title: t('common.error'),
        description: message || t('common.error'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    isLoading,
    isValidSession,
    resetPassword
  };
};
