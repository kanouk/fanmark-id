import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { AuthFormData, AuthState } from '@/types/auth';

interface CheckEmailExistsResponse {
  exists: boolean;
}

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

  const signUp = async () => {
    if (formData.password !== formData.confirmPassword) {
      setError('パスワードが一致しません');
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

      const { error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: `${window.location.origin}/`
        }
      });

      if (error) throw error;

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

  return {
    formData,
    authState,
    updateFormData,
    signUp,
    signIn,
    forgotPassword,
    resendConfirmation
  };
};
