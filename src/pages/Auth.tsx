import { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthForm } from '@/hooks/useAuthForm';
import { usePasswordValidation } from '@/hooks/usePasswordValidation';
import { useTranslation } from '@/hooks/useTranslation';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/components/AuthLayout';
import { PasswordRequirement } from '@/components/PasswordRequirement';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Heart, Sparkles, Users, Mail, Sparkle, ArrowLeft, CheckCircle2, Lock, Tag } from 'lucide-react';
import { AuthFormData, AuthState } from '@/types/auth';
import { PasswordRequirement as PasswordRequirementType } from '@/lib/password-validation';

const Auth = () => {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { formData, authState, updateFormData, signUp, signIn, resendConfirmation } = useAuthForm();
  const { requirements, isValid } = usePasswordValidation(formData.password);

  const [username, setUsername] = useState('');

  useEffect(() => {
    if (user && session) {
      navigate('/dashboard');
    }
  }, [user, session, navigate]);

  useEffect(() => {
    const state = location.state as { prefillFanmark?: string } | null;
    if (state?.prefillFanmark) {
      try {
        localStorage.setItem('fanmark.prefill', state.prefillFanmark);
      } catch (error) {
        console.warn('Failed to persist fanmark prefill on auth page:', error);
      }
      navigate(location.pathname, { replace: true });
    }
  }, [location, navigate]);


  if (authState.awaitingConfirmation) {
    return (
      <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <div className="flex flex-1 items-center justify-center px-4 py-16">
          <AuthLayout
            title={t('auth.awaitingConfirmation')}
            description={t('auth.checkEmail')}
          >
            <div className="space-y-6 rounded-3xl border border-primary/20 bg-background/90 p-6 text-center shadow-[0_20px_45px_rgba(101,195,200,0.14)]">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Mail className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground">
                  {t('auth.confirmationSent')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('auth.checkEmail')}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  onClick={resendConfirmation}
                  disabled={authState.loading}
                  className="rounded-full"
                >
                  {authState.loading ? (
                    <>
                      <Users className="mr-2 h-4 w-4 animate-spin" />
                      {t('common.loading')}
                    </>
                  ) : (
                    <>
                      <Sparkle className="mr-2 h-4 w-4" />
                      {t('auth.resendConfirmation')}
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => updateFormData('email', '')}
                  className="rounded-full"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('common.back')}
                </Button>
              </div>
            </div>
          </AuthLayout>
        </div>
        <footer className="border-t border-border/40 bg-background/80 backdrop-blur">
          <div className="container mx-auto px-4 py-10 text-center space-y-3">
            <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
              <span className="text-3xl">✨</span> <span className="text-gradient">fanmark.id</span>
            </div>
            <p className="text-sm text-muted-foreground">{t('sections.footer')}</p>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-4 md:px-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="group flex items-center gap-2 text-lg font-semibold text-foreground transition-transform hover:translate-y-[-1px]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all group-hover:scale-105">
              ✨
            </span>
            <span className="text-gradient text-2xl">fanmark.id</span>
          </button>
          <LanguageToggle />
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-2">
          <div className="hidden flex-col justify-center space-y-6 rounded-3xl border border-primary/20 bg-background/70 p-10 text-center shadow-[0_26px_60px_rgba(101,195,200,0.18)] backdrop-blur lg:flex">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="space-y-3">
              <h1 className="text-3xl font-bold text-foreground">
                {t('auth.welcome')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('auth.description')}
              </p>
            </div>
            <div className="grid gap-4 text-left text-sm text-muted-foreground">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" />
                <span>{t('registration.quickRegisterSubtitle')}</span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" />
                <span>{t('search.joinThousands')}</span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" />
                <span>{t('registration.detailsNote')}</span>
              </div>
            </div>
          </div>
          <AuthLayout title={t('auth.title')} description={t('auth.description')}>
            <div className="space-y-6">
              <Tabs defaultValue="login" className="space-y-6">
                <TabsList className="grid w-full grid-cols-2 gap-3 rounded-full border border-primary/20 bg-background/80 p-3 backdrop-blur">
                  <TabsTrigger
                    value="login"
                    className="flex items-center justify-center gap-2 rounded-full py-4 text-base font-semibold tracking-wide data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
                  >
                    <Users className="h-4 w-4" />
                    {t('auth.login')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="signup"
                    className="flex items-center justify-center gap-2 rounded-full py-4 text-base font-semibold tracking-wide data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
                  >
                    <Heart className="h-4 w-4" />
                    {t('auth.signUp')}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="rounded-3xl border border-primary/15 bg-background/90 p-8 shadow-[0_20px_45px_rgba(101,195,200,0.14)]">
                  <LoginForm
                    formData={formData}
                    authState={authState}
                    updateFormData={updateFormData}
                    signIn={signIn}
                    t={t}
                  />
                </TabsContent>

                <TabsContent value="signup" className="rounded-3xl border border-primary/15 bg-background/90 p-8 shadow-[0_20px_45px_rgba(101,195,200,0.14)]">
                  <SignUpForm
                    formData={formData}
                    authState={authState}
                    updateFormData={updateFormData}
                    signUp={signUp}
                    requirements={requirements}
                    isValid={isValid}
                    username={username}
                    setUsername={setUsername}
                    t={t}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </AuthLayout>
        </div>
      </div>
      <footer className="border-t border-border/40 bg-background/80 backdrop-blur">
        <div className="container mx-auto px-4 py-10 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
            <span className="text-3xl">✨</span> <span className="text-gradient">fanmark.id</span>
          </div>
          <p className="text-sm text-muted-foreground">{t('sections.footer')}</p>
        </div>
      </footer>
    </div>
  );
};

// Login Form Component
interface LoginFormProps {
  formData: AuthFormData;
  authState: AuthState;
  updateFormData: (field: keyof AuthFormData, value: string) => void;
  signIn: () => void;
  t: (key: string) => string;
}

const LoginForm = ({ formData, authState, updateFormData, signIn, t }: LoginFormProps) => (
  <form
    onSubmit={(e) => {
      e.preventDefault();
      signIn();
    }}
    className="space-y-5"
  >
    <div className="space-y-2">
      <Label htmlFor="auth-email" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Mail className="h-4 w-4" />
        {t('auth.email')}
      </Label>
      <Input
        id="auth-email"
        type="email"
        value={formData.email}
        onChange={(e) => updateFormData('email', e.target.value)}
        placeholder="you@example.com"
        required
        autoComplete="email"
        className="h-12 rounded-full border border-primary/15 bg-background/80 text-base shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="auth-password" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Lock className="h-4 w-4" />
        {t('auth.password')}
      </Label>
      <Input
        id="auth-password"
        type="password"
        value={formData.password}
        onChange={(e) => updateFormData('password', e.target.value)}
        required
        autoComplete="current-password"
        className="h-12 rounded-full border border-primary/15 bg-background/80 text-base shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      />
    </div>

    {authState.error && (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {authState.error}
      </div>
    )}

    <Button
      type="submit"
      disabled={authState.loading}
      className="w-full gap-2 rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:shadow-xl"
    >
      {authState.loading ? (
        <>
          <Users className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </>
      ) : (
        <>
          <Users className="h-4 w-4" />
          {t('auth.login')}
        </>
      )}
    </Button>

    <div className="text-center text-sm">
      <Link to="/forgot-password" className="text-primary underline-offset-2 transition hover:underline">
        {t('auth.forgotPassword')}
      </Link>
    </div>
  </form>
);

// Sign Up Form Component  
interface SignUpFormProps {
  formData: AuthFormData;
  authState: AuthState;
  updateFormData: (field: keyof AuthFormData, value: string) => void;
  signUp: () => void;
  requirements: PasswordRequirementType[];
  isValid: boolean;
  username: string;
  setUsername: (value: string) => void;
  t: (key: string) => string;
}

const SignUpForm = ({
  formData,
  authState,
  updateFormData,
  signUp,
  requirements,
  isValid,
  username,
  setUsername,
  t,
}: SignUpFormProps) => (
  <form
    onSubmit={(e) => {
      e.preventDefault();
      signUp();
    }}
    className="space-y-5"
  >
    <div className="space-y-2">
      <Label htmlFor="signup-username" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Tag className="h-4 w-4" />
        {t('auth.username')}
      </Label>
      <div className="flex items-center overflow-hidden rounded-full border border-primary/15 bg-background/80">
        <span className="px-4 text-sm text-muted-foreground">@</span>
        <Input
          id="signup-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          placeholder="yourname"
          maxLength={20}
          autoComplete="off"
          className="h-12 flex-1 border-0 bg-transparent text-base text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>
    </div>

    <div className="space-y-2">
      <Label htmlFor="signup-email" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Mail className="h-4 w-4" />
        {t('auth.email')}
      </Label>
      <Input
        id="signup-email"
        type="email"
        value={formData.email}
        onChange={(e) => updateFormData('email', e.target.value)}
        placeholder="you@example.com"
        required
        autoComplete="email"
        className="h-12 rounded-full border border-primary/15 bg-background/80 text-base shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="signup-password" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Lock className="h-4 w-4" />
        {t('auth.password')}
      </Label>
      <Input
        id="signup-password"
        type="password"
        value={formData.password}
        onChange={(e) => updateFormData('password', e.target.value)}
        required
        autoComplete="new-password"
        className="h-12 rounded-full border border-primary/15 bg-background/80 text-base shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      />
      {formData.password && (
        <div className="rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
          <h4 className="mb-2 font-semibold text-primary">
            {t('password.requirements.title')}
          </h4>
          <div className="space-y-1.5">
            {requirements.map((req, index) => (
              <PasswordRequirement key={index} met={req.met} text={req.text} />
            ))}
          </div>
        </div>
      )}
    </div>

    <div className="space-y-2">
      <Label htmlFor="signup-confirm" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Lock className="h-4 w-4" />
        {t('auth.confirmPassword')}
      </Label>
      <Input
        id="signup-confirm"
        type="password"
        value={formData.confirmPassword || ''}
        onChange={(e) => updateFormData('confirmPassword', e.target.value)}
        required
        autoComplete="new-password"
        className="h-12 rounded-full border border-primary/15 bg-background/80 text-base shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      />
    </div>

    {authState.error && (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {authState.error}
      </div>
    )}

    <Button
      type="submit"
      disabled={authState.loading || !isValid || !username.trim()}
      className="w-full gap-2 rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:shadow-xl"
    >
      {authState.loading ? (
        <>
          <Heart className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </>
      ) : (
        <>
          <Heart className="h-4 w-4" />
          {t('auth.signUp')}
        </>
      )}
    </Button>
  </form>
);

export default Auth;
