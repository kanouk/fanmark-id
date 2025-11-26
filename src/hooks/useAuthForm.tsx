import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { AuthFormData, AuthState } from '@/types/auth';
import { isActiveLanguage, type ActiveLanguageCode } from '@/lib/language';

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

  const checkEmailExists = async (email: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke<CheckEmailExistsResponse>('check-email-exists', {
        body: { email }
      });
      
      if (error) throw error;
      return data?.exists || false;
    } catch (error) {
      console.error('Error checking email:', error);
      return false;
    }
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
      const emailExists = await checkEmailExists(formData.email);
      if (emailExists) {
        setError('このメールアドレスは既に登録されています');
        return;
      }

      if (invitationRequired && normalizedInvitationCode) {
        const { data, error } = await supabase.rpc('validate_invitation_code', {
          code_to_check: normalizedInvitationCode
        });

        if (error) {
          console.error('Error validating invitation code before signup:', error);
          setError(t('invitation.errorValidating'));
          return;
        }

        const result = data?.[0];
        if (!result?.is_valid) {
          setError(t('invitation.invalidCode'));
          return;
        }

        if ((result.remaining_uses ?? 0) <= 0) {
          setError(t('invitation.codeFullyUsed'));
          return;
        }
      }

      const signUpOptions = {
        emailRedirectTo: `${window.location.origin}/`,
        data: {
          preferred_language: detectBrowserLanguage(),
          ...(normalizedInvitationCode && { invitation_code: normalizedInvitationCode })
        }
      };

      const { data: signUpData, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: signUpOptions
      });

      if (error) throw error;

      if (normalizedInvitationCode && !invitationRequired) {
        const { error: consumeError } = await supabase.rpc('use_invitation_code', {
          code_to_use: normalizedInvitationCode
        });

        if (consumeError) {
          console.error('Error consuming invitation code:', consumeError);
          toast({
            title: t('common.error'),
            description: t('invitation.errorValidating'),
            variant: 'destructive',
          });
        } else if (signUpData?.user?.id) {
          const { error: settingsError } = await supabase
            .from('user_settings')
            .update({ invited_by_code: normalizedInvitationCode })
            .eq('user_id', signUpData.user.id);

          if (settingsError) {
            console.error('Error updating user settings with invitation code:', settingsError);
          }
        }
      }

      setAwaitingConfirmation(true);
      toast({
        title: t('common.confirmationEmailSent'),
        description: t('common.confirmationEmailDesc'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setError(message || 'サインアップに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const signIn = async () => {
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setError('メールアドレスまたはパスワードが正しくありません');
        } else if (error.message.includes('Email not confirmed')) {
          setError('メールアドレスの確認が完了していません。確認メールをご確認ください。');
        } else {
          setError(error.message);
        }
        return;
      }

      toast({
        title: t('common.loginSuccess'),
        description: t('common.loginSuccessDesc'),
      });
      navigate('/dashboard');
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setError(message || 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const forgotPassword = async () => {
    if (!formData.email) {
      setError('メールアドレスを入力してください');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(formData.email, {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (error) throw error;

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

    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: formData.email,
        options: {
          emailRedirectTo: `${window.location.origin}/`
        }
      });

      if (error) throw error;

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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth`
        }
      });

      if (error) throw error;
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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: `${window.location.origin}/`
        }
      });

      if (error) throw error;
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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: {
          redirectTo: `${window.location.origin}/auth`
        }
      });

      if (error) throw error;
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
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: `${window.location.origin}/auth`
        }
      });

      if (error) throw error;
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setError(message || 'Appleログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return {
    formData,
    authState,
    updateFormData,
    signUp,
    signIn,
    signInWithGoogle,
    signInWithGithub,
    signInWithDiscord,
    signInWithApple,
    forgotPassword,
    resendConfirmation
  };
};
