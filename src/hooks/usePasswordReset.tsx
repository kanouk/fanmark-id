import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { betterAuthClient, isBetterAuthEnabled } from '@/lib/auth-backend';

export const usePasswordReset = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const betterAuthEnabled = isBetterAuthEnabled();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      if (betterAuthEnabled) {
        const token = searchParams.get('token');
        if (token) {
          setResetToken(token);
          setIsValidSession(true);
          return;
        }
        navigate('/forgot-password');
        return;
      }

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
  }, [betterAuthEnabled, navigate, searchParams]);

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
      if (betterAuthEnabled) {
        if (!resetToken) throw new Error('パスワード再設定リンクが無効です');
        await betterAuthClient.resetPassword(resetToken, password);
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
      }

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
