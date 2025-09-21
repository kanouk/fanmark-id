import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { AuthFormData, AuthState } from '@/types/auth';

export const useAuthForm = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
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
      const { data, error } = await supabase.functions.invoke('check-email-exists', {
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
        title: "確認メールを送信しました",
        description: "メール内のリンクをクリックしてアカウントを有効化してください。",
      });
    } catch (error: any) {
      setError(error.message || 'サインアップに失敗しました');
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
        title: "ログインしました",
        description: "アプリケーションへようこそ！",
      });
      navigate('/dashboard');
    } catch (error: any) {
      setError(error.message || 'ログインに失敗しました');
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
        title: "パスワードリセットメールを送信しました",
        description: "メール内のリンクをクリックしてパスワードをリセットしてください。",
      });
    } catch (error: any) {
      setError(error.message || 'パスワードリセットに失敗しました');
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
        title: "確認メールを再送信しました",
        description: "メール内のリンクをクリックしてアカウントを有効化してください。",
      });
    } catch (error: any) {
      setError(error.message || '確認メールの再送信に失敗しました');
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
