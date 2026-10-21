import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

import { betterAuthClient } from '@/lib/auth-backend';

export const usePasswordReset = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const betterAuthEnabled = true;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      {
        const token = searchParams.get('token');
        if (token) {
          setResetToken(token);
          setIsValidSession(true);
          return;
        }
        navigate('/forgot-password');
        return;
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
      {
        if (!resetToken) throw new Error('パスワード再設定リンクが無効です');
        await betterAuthClient.resetPassword(resetToken, password);
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
