import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthForm } from '@/hooks/useAuthForm';
import { usePasswordValidation } from '@/hooks/usePasswordValidation';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AuthLayout } from '@/components/AuthLayout';
import { PasswordRequirement } from '@/components/PasswordRequirement';

const Auth = () => {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
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
        title={t('auth.awaitingConfirmation')} 
        description={t('auth.checkEmail')}
        showBackButton
        backLabel={t('auth.homeButton')}
      >
        <div className="text-center space-y-4">
          <div className="text-6xl">📧</div>
          <p className="text-muted-foreground">
            {t('auth.confirmationSent')}
          </p>
          <div className="space-y-2">
            <Button 
              onClick={resendConfirmation} 
              variant="outline" 
              className="w-full"
              disabled={authState.loading}
            >
              {authState.loading ? t('common.loading') : t('auth.resendConfirmation')}
            </Button>
            <Button 
              onClick={() => updateFormData('email', '')} 
              variant="ghost" 
              className="w-full"
            >
              {t('invitation.back')}
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout 
      title={t('auth.login')} 
      description={t('auth.loginDescription')}
      showBackButton
      backLabel={t('auth.homeButton')}
    >
      <Tabs defaultValue="signin" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="signin">{t('auth.login')}</TabsTrigger>
          <TabsTrigger value="signup">{t('auth.signUp')}</TabsTrigger>
        </TabsList>
        
        <TabsContent value="signin" className="space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); signIn(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => updateFormData('email', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
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
              {authState.loading ? t('common.loading') : t('auth.login')}
            </Button>
            
            <div className="text-center">
              <Link 
                to="/forgot-password" 
                className="text-sm text-muted-foreground hover:text-primary"
              >
                {t('auth.forgotPassword')}
              </Link>
            </div>
          </form>
        </TabsContent>
        
        <TabsContent value="signup" className="space-y-4">
          <form onSubmit={(e) => { e.preventDefault(); signUp(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-register">{t('auth.email')}</Label>
              <Input
                id="email-register"
                type="email"
                value={formData.email}
                onChange={(e) => updateFormData('email', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password-register">{t('auth.password')}</Label>
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
                <p className="text-sm text-muted-foreground">{t('password.requirements.length')}:</p>
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
              {authState.loading ? t('common.loading') : t('auth.signUp')}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </AuthLayout>
  );
};

export default Auth;