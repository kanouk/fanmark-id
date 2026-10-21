import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

import { betterAuthClient } from '@/lib/auth-backend';
import { BetterAuthClientError } from '@/lib/better-auth-client';
import { useAuth } from '@/hooks/useAuth';
import { AuthFormData, AuthState } from '@/types/auth';
import { isActiveLanguage, type ActiveLanguageCode } from '@/lib/language';

const RESEND_COOLDOWN_SECONDS = 60;

interface CheckEmailExistsResponse {
  exists: boolean;
}

interface SignUpOptions {
  invitationCode?: string | null;
  invitationRequired?: boolean;
}

const detectBrowserLanguage = (): ActiveLanguageCode => {
  const browserLang = navigator.language.toLowerCase().split('-')[0];
  return isActiveLanguage(browserLang) ? browserLang : 'ja';
};

export const useAuthForm = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { refreshSession } = useAuth();

  const [formData, setFormData] = useState<AuthFormData>({
    email: '',
    password: '',
    confirmPassword: ''
  });

  const [authState, setAuthState] = useState<AuthState>({
    loading: false,
    error: '',
    awaitingConfirmation: false
  });

  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');

  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownTimerRef = useRef<number | null>(null);
  const signupCommandIdRef = useRef<string | null>(null);
  const signupTermsRef = useRef<string | null>(null);

  const cooldownActive = resendCooldown > 0;

  useEffect(() => {
    if (cooldownActive) {
      cooldownTimerRef.current = window.setInterval(() => {
        setResendCooldown(prev => {
          if (prev <= 1) {
            if (cooldownTimerRef.current) {
              clearInterval(cooldownTimerRef.current);
              cooldownTimerRef.current = null;
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
      }
    };
  }, [cooldownActive]);

  const updateFormData = (field: keyof AuthFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (authState.error) {
      setAuthState(prev => ({ ...prev, error: '' }));
    }
  };

  const setLoading = (loading: boolean) => {
    setAuthState(prev => ({ ...prev, loading }));
  };

  const setError = (error: string) => {
    setAuthState(prev => ({ ...prev, error }));
  };

  const setAwaitingConfirmation = (awaiting: boolean) => {
    setAuthState(prev => ({ ...prev, awaitingConfirmation: awaiting }));
  };

  const signUp = async (options?: SignUpOptions) => {
    if (formData.password !== formData.confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }

    const invitationRequired = Boolean(options?.invitationRequired);
    const invitationCodeRaw = options?.invitationCode ?? null;
    const normalizedInvitationCode = invitationCodeRaw ? invitationCodeRaw.trim().toUpperCase() : null;

    if (invitationRequired && !normalizedInvitationCode) {
      setError(t('invitation.codeRequired'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      {
        const preferredLanguage = detectBrowserLanguage();
        const terms = JSON.stringify([
          formData.email.trim().toLowerCase(),
          normalizedInvitationCode,
          preferredLanguage,
        ]);
        if (signupTermsRef.current !== terms) {
          signupTermsRef.current = terms;
          signupCommandIdRef.current = crypto.randomUUID();
        }
        await betterAuthClient.signUpWithEmail({
          email: formData.email,
          password: formData.password,
          commandId: signupCommandIdRef.current ?? crypto.randomUUID(),
          invitationCode: normalizedInvitationCode,
          preferredLanguage,
        });
        signupCommandIdRef.current = null;
        signupTermsRef.current = null;
      }

      setAwaitingConfirmation(true);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      toast({
        title: t('common.confirmationEmailSent'),
        description: t('common.confirmationEmailDesc'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      if (message === 'signup_command_expired' || message === 'signup_command_conflict') {
        signupCommandIdRef.current = null;
        signupTermsRef.current = null;
      }
      const signupError = message === 'invitation_required'
        ? t('invitation.codeRequired')
        : message === 'invitation_invalid_or_full'
          ? t('invitation.invalidCode')
          : message === 'signup_command_expired'
            ? '登録手続きの有効時間が過ぎました。もう一度お試しください。'
            : message === 'signup_command_conflict'
              ? '入力内容が変わりました。招待コードを確認してもう一度お試しください。'
              : message === 'verification_email_unavailable'
                ? '確認メールを送信できませんでした。しばらくしてからもう一度お試しください。'
                : message === 'signup_email_or_invitation_unavailable'
                  ? '招待コードを利用できません。残り回数を確認してください。'
                  : 'サインアップに失敗しました。しばらくしてからもう一度お試しください。';
      setError(signupError);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async () => {
    setLoading(true);
    setError('');

    try {
      {
        const result = await betterAuthClient.signInWithEmail(formData.email, formData.password);
        if ('twoFactorRedirect' in result && result.twoFactorRedirect) {
          setTwoFactorRequired(true);
          setVerificationCode('');
          setFormData(prev => ({ ...prev, password: '', confirmPassword: '' }));
          return;
        }
        if (!await refreshSession()) throw new Error(t('mfa.verificationFailed'));
        // Auth navigates only after the refreshed context has a valid session.
        return;
      }

    } catch (error) {
      if (error instanceof BetterAuthClientError && error.status === 401) {
        setError('メールアドレスまたはパスワードが正しくありません');
      } else if (error instanceof BetterAuthClientError && error.status === 403) {
        setError('メールアドレスの確認が完了していません。確認メールをご確認ください。');
      } else {
        const message = error instanceof Error ? error.message : undefined;
        setError(message || 'ログインに失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  const verifyTwoFactor = async () => {
    if (!twoFactorRequired || authState.loading) return;
    if (!/^\d{6}$/u.test(verificationCode)) {
      setError(t('mfa.invalidCode'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      await betterAuthClient.verifyTotp(verificationCode);
      if (!await refreshSession()) throw new Error('session_not_available');
      setTwoFactorRequired(false);
    } catch {
      setError(t('mfa.verificationFailed'));
    } finally {
      setVerificationCode('');
      setLoading(false);
    }
  };

  const cancelTwoFactor = () => {
    if (authState.loading) return;
    setTwoFactorRequired(false);
    setVerificationCode('');
    setError('');
    setFormData(prev => ({ ...prev, password: '', confirmPassword: '' }));
  };

  const forgotPassword = async () => {
    if (!formData.email) {
      setError('メールアドレスを入力してください');
      return;
    }

    setLoading(true);
    try {
      {
        await betterAuthClient.requestPasswordReset(
          formData.email,
          `${window.location.origin}/reset-password`,
        );
      }

      toast({
        title: t('common.resetEmailSent'),
        description: t('common.resetEmailDesc'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setError(message || 'パスワードリセットに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    if (!formData.email) {
      setError('メールアドレスを入力してください');
      return;
    }

    if (resendCooldown > 0) {
      return;
    }

    setLoading(true);
    try {
      {
        await betterAuthClient.sendVerificationEmail(
          formData.email,
          `${window.location.origin}/auth`,
        );
      }

      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      toast({
        title: t('common.confirmationResent'),
        description: t('common.confirmationEmailDesc'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setError(message || '確認メールの再送信に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setLoading(true);
    setError('');

    try {
      {
        window.location.assign(await betterAuthClient.signInWithSocial(
          'google',
          `${window.location.origin}/auth`,
        ));
        return;
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setError(message || 'Googleログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const signInWithGithub = async () => {
    setLoading(true);
    setError('');

    try {
      {
        window.location.assign(await betterAuthClient.signInWithSocial(
          'github',
          `${window.location.origin}/auth`,
        ));
        return;
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setError(message || 'GitHubログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const signInWithDiscord = async () => {
    setLoading(true);
    setError('');

    try {
      {
        window.location.assign(await betterAuthClient.signInWithSocial(
          'discord',
          `${window.location.origin}/auth`,
        ));
        return;
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setError(message || 'Discordログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const signInWithApple = async () => {
    setLoading(true);
    setError('');

    try {
      {
        window.location.assign(await betterAuthClient.signInWithSocial(
          'apple',
          `${window.location.origin}/auth`,
        ));
        return;
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setError(message || 'Appleログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const exitAwaitingConfirmation = () => {
    setAuthState(prev => ({
      ...prev,
      awaitingConfirmation: false,
      error: '',
    }));
  };

  return {
    formData,
    authState,
    updateFormData,
    signUp,
    signIn,
    twoFactorRequired,
    verificationCode,
    setVerificationCode,
    verifyTwoFactor,
    cancelTwoFactor,
    signInWithGoogle,
    signInWithGithub,
    signInWithDiscord,
    signInWithApple,
    forgotPassword,
    resendConfirmation,
    resendCooldown,
    exitAwaitingConfirmation
  };
};
