import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthForm } from '@/hooks/useAuthForm';
import { usePasswordValidation } from '@/hooks/usePasswordValidation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AuthLayout } from '@/components/AuthLayout';
import { PasswordRequirement } from '@/components/PasswordRequirement';

const Auth = () => {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { formData, authState, updateFormData, signUp, signIn, resendConfirmation } = useAuthForm();
  const { requirements, isValid } = usePasswordValidation(formData.password);

  useEffect(() => {
    if (user && session) {
      navigate('/');
    }
  }, [user, session, navigate]);

  if (authState.awaitingConfirmation) {
    return (
      <AuthLayout 
        title="メール確認待ち" 
        description="確認メールを送信しました"
        showBackButton
      >
        <div className="text-center space-y-4">
          <div className="text-6xl">📧</div>
          <p className="text-muted-foreground">
            {formData.email} に確認メールを送信しました。メール内のリンクをクリックしてアカウントを有効化してください。
          </p>
          <div className="space-y-2">
            <Button 
              onClick={resendConfirmation} 
              variant="outline" 
              className="w-full"
              disabled={authState.loading}
            >
              {authState.loading ? '送信中...' : '確認メールを再送信'}
            </Button>
            <Button 
              onClick={() => updateFormData('email', '')} 
              variant="ghost" 
              className="w-full"
            >
              戻る
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout 
      title="アカウント" 
      description="ログインまたは新規登録"
      showBackButton
    >
      <Tabs defaultValue="signin" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="signin">ログイン</TabsTrigger>
          <TabsTrigger value="signup">新規登録</TabsTrigger>
        </TabsList>
        
        <TabsContent value="signin" className="space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); signIn(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => updateFormData('email', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => updateFormData('password', e.target.value)}
                required
              />
            </div>
            
            {authState.error && (
              <div className="text-red-500 text-sm">{authState.error}</div>
            )}
            
            <Button type="submit" className="w-full" disabled={authState.loading}>
              {authState.loading ? 'ログイン中...' : 'ログイン'}
            </Button>
            
            <div className="text-center">
              <Link 
                to="/forgot-password" 
                className="text-sm text-muted-foreground hover:text-primary"
              >
                パスワードを忘れた場合
              </Link>
            </div>
          </form>
        </TabsContent>
        
        <TabsContent value="signup" className="space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); signUp(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-register">メールアドレス</Label>
              <Input
                id="email-register"
                type="email"
                value={formData.email}
                onChange={(e) => updateFormData('email', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password-register">パスワード</Label>
              <Input
                id="password-register"
                type="password"
                value={formData.password}
                onChange={(e) => updateFormData('password', e.target.value)}
                required
              />
            </div>
            
            {formData.password && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">パスワード要件:</p>
                <div className="space-y-1">
                  {requirements.map((req, index) => (
                    <PasswordRequirement key={index} met={req.met} text={req.text} />
                  ))}
                </div>
              </div>
            )}
            
            {authState.error && (
              <div className="text-red-500 text-sm">{authState.error}</div>
            )}
            
            <Button 
              type="submit" 
              className="w-full" 
              disabled={authState.loading || !isValid}
            >
              {authState.loading ? '登録中...' : '新規登録'}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </AuthLayout>
  );
};

export default Auth;