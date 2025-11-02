import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthForm } from '@/hooks/useAuthForm';
import { usePasswordValidation } from '@/hooks/usePasswordValidation';
import { useTranslation } from '@/hooks/useTranslation';
import { InvitationSystem } from '@/components/InvitationSystem';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/components/AuthLayout';
import { PasswordRequirement } from '@/components/PasswordRequirement';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Heart, Users, Mail, Sparkle, ArrowLeft, Lock, Check, X } from 'lucide-react';
import { FaGoogle, FaApple, FaDiscord, FaGithub } from 'react-icons/fa';
import { AuthFormData, AuthState } from '@/types/auth';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { PasswordRequirement as PasswordRequirementType } from '@/lib/password-validation';
import { SimpleHeader } from '@/components/layout/SimpleHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';

const Auth = () => {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { formData, authState, updateFormData, signUp, signIn, signInWithGoogle, resendConfirmation } = useAuthForm();
  const { requirements, isValid } = usePasswordValidation(formData.password);
  const { settings, loading: settingsLoading } = useSystemSettings();
  const invitationGateActive = !settingsLoading && settings.invitation_mode;
  const [invitationValidated, setInvitationValidated] = useState(false);
  const [validatedInvitationCode, setValidatedInvitationCode] = useState<string | null>(null);

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

  useEffect(() => {
    if (!invitationGateActive) {
      setInvitationValidated(false);
      setValidatedInvitationCode(null);
    }
  }, [invitationGateActive]);


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
      <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
    <SimpleHeader />
      <div className="flex flex-1 items-start justify-center px-4 py-14 md:py-20">
        <div className="w-full max-w-4xl space-y-10">
          <div className="space-y-4 text-center">
            <h1 className="text-3xl font-bold text-foreground sm:text-4xl">
              {t('auth.pageTitle')}
            </h1>
            <p className="mx-auto max-w-2xl text-sm text-muted-foreground md:text-base">
              {t('auth.pageDescription')}
            </p>
          </div>

          <div className="rounded-3xl border border-primary/20 bg-background/90 p-6 shadow-[0_22px_55px_rgba(101,195,200,0.16)] backdrop-blur md:p-10">
            <div className="space-y-8">
              <Tabs defaultValue="login" className="space-y-6">
                <TabsList className="grid w-full grid-cols-2 gap-2 rounded-full border border-primary/20 bg-background/80 p-2 backdrop-blur">
                  <TabsTrigger
                    value="login"
                    className="flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold tracking-wide transition-colors data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
                  >
                    <Users className="h-4 w-4" />
                    {t('auth.login')}
                  </TabsTrigger>
                  <TabsTrigger
                    value="signup"
                    className="flex items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold tracking-wide transition-colors data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
                  >
                    <Heart className="h-4 w-4" />
                    {t('auth.signUp')}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="rounded-2xl border border-primary/15 bg-background/95 p-6 shadow-[0_18px_40px_rgba(101,195,200,0.12)] md:p-8">
                  <LoginForm
                    formData={formData}
                    authState={authState}
                    updateFormData={updateFormData}
                    signIn={signIn}
                    signInWithGoogle={signInWithGoogle}
                    t={t}
                  />
                </TabsContent>

                <TabsContent value="signup" className="rounded-2xl border border-primary/15 bg-background/95 p-6 shadow-[0_18px_40px_rgba(101,195,200,0.12)] md:p-8">
                  <div className="space-y-6">
                    {settingsLoading && (
                      <div className="rounded-2xl border border-primary/15 bg-background/95 p-6 text-center">
                        <div className="mx-auto h-3 w-24 animate-pulse rounded-full bg-primary/20" />
                        <div className="mx-auto mt-3 h-3 w-32 animate-pulse rounded-full bg-primary/10" />
                      </div>
                    )}
                    {invitationGateActive && !invitationValidated && (
                      <InvitationSystem
                        onValidCode={(code) => {
                          setInvitationValidated(true);
                          setValidatedInvitationCode(code);
                        }}
                        onReset={() => {
                          setInvitationValidated(false);
                          setValidatedInvitationCode(null);
                        }}
                      />
                    )}
                    {(!invitationGateActive || invitationValidated) && (
                      <SignUpForm
                        formData={formData}
                        authState={authState}
                        updateFormData={updateFormData}
                        signUp={signUp}
                        signInWithGoogle={signInWithGoogle}
                        requirements={requirements}
                        isValid={isValid}
                        t={t}
                        invitationRequired={invitationGateActive}
                        invitationValidated={invitationValidated}
                        validatedInvitationCode={validatedInvitationCode}
                      />
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
    </div>
    <SiteFooter />
    </div>
  );
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const InputStatusIcon = ({ status, className }: { status: boolean | null; className?: string }) => {
  if (status === null) return null;
  const base = 'pointer-events-none absolute right-3 top-1/2 -translate-y-1/2';
  const classes = className ? `${base} ${className}` : base;
  return (
    <span className={classes}>
      {status ? (
        <Check className="h-4 w-4 text-emerald-500" />
      ) : (
        <X className="h-4 w-4 text-destructive" />
      )}
    </span>
  );
};

// Login Form Component
interface LoginFormProps {
  formData: AuthFormData;
  authState: AuthState;
  updateFormData: (field: keyof AuthFormData, value: string) => void;
  signIn: () => void;
  signInWithGoogle: () => void;
  t: (key: string) => string;
}

const LoginForm = ({ formData, authState, updateFormData, signIn, signInWithGoogle, t }: LoginFormProps) => {
  const emailStatus = formData.email ? EMAIL_REGEX.test(formData.email) : null;
  const passwordStatus = formData.password ? formData.password.length > 0 : null;
  const socialButtons = [
    {
      key: 'google',
      label: t('auth.signInWithGoogle'),
      Icon: FaGoogle,
      onClick: signInWithGoogle,
      disabled: authState.loading,
    },
    {
      key: 'apple',
      label: t('auth.signInWithApple'),
      Icon: FaApple,
      onClick: () => {},
      disabled: authState.loading,
    },
    {
      key: 'discord',
      label: t('auth.signInWithDiscord'),
      Icon: FaDiscord,
      onClick: () => {},
      disabled: authState.loading,
    },
    {
      key: 'github',
      label: t('auth.signInWithGithub'),
      Icon: FaGithub,
      onClick: () => {},
      disabled: authState.loading,
    },
  ] as const;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        signIn();
      }}
      className="space-y-6"
    >
      <div className="space-y-2">
        <Label htmlFor="auth-email" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Mail className="h-4 w-4" />
          {t('auth.email')}
        </Label>
        <div className="relative">
          <Input
            id="auth-email"
            type="email"
            value={formData.email}
            onChange={(e) => updateFormData('email', e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none pr-10 focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <InputStatusIcon status={emailStatus} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="auth-password" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Lock className="h-4 w-4" />
          {t('auth.password')}
        </Label>
        <div className="relative">
          <Input
            id="auth-password"
            type="password"
            value={formData.password}
            onChange={(e) => updateFormData('password', e.target.value)}
            required
            autoComplete="current-password"
            className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none pr-10 focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <InputStatusIcon status={passwordStatus} />
        </div>
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

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-primary/15" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background/95 px-2 text-muted-foreground">{t('auth.or')}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {socialButtons.map(({ key, label, Icon, onClick, disabled }) => (
          <Button
            key={key}
            type="button"
            onClick={onClick}
            disabled={disabled}
            variant="outline"
            className="w-full gap-2 rounded-full border-primary/20 bg-background/80 shadow-sm transition-all duration-300 hover:shadow-md"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        ))}
      </div>
    </form>
  );
};

// Sign Up Form Component  
interface SignUpFormProps {
  formData: AuthFormData;
  authState: AuthState;
  updateFormData: (field: keyof AuthFormData, value: string) => void;
  signUp: (options?: { invitationCode?: string | null; invitationRequired?: boolean }) => void;
  signInWithGoogle: () => void;
  requirements: PasswordRequirementType[];
  isValid: boolean;
  t: (key: string) => string;
  invitationRequired?: boolean;
  invitationValidated?: boolean;
  validatedInvitationCode?: string | null;
}

const SignUpForm = ({
  formData,
  authState,
  updateFormData,
  signUp,
  signInWithGoogle,
  requirements,
  isValid,
  t,
  invitationRequired = false,
  invitationValidated = false,
  validatedInvitationCode,
}: SignUpFormProps) => {
  const [passwordPopoverOpen, setPasswordPopoverOpen] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const blurTimeoutRef = useRef<number | null>(null);

  const emailStatus = formData.email ? EMAIL_REGEX.test(formData.email) : null;
  const passwordStatus = formData.password ? (isValid ? true : false) : null;
  const confirmStatus = formData.confirmPassword
    ? formData.confirmPassword === formData.password && formData.confirmPassword.length > 0
    : null;
  const invitationDisabled = invitationRequired && !invitationValidated;
  const InvitationStatusIcon = invitationValidated ? Check : Sparkle;
  const socialButtons = [
    {
      key: 'google',
      label: t('auth.signInWithGoogle'),
      Icon: FaGoogle,
      onClick: signInWithGoogle,
      disabled: authState.loading || invitationDisabled,
    },
    {
      key: 'apple',
      label: t('auth.signInWithApple'),
      Icon: FaApple,
      onClick: () => {},
      disabled: authState.loading || invitationDisabled,
    },
    {
      key: 'discord',
      label: t('auth.signInWithDiscord'),
      Icon: FaDiscord,
      onClick: () => {},
      disabled: authState.loading || invitationDisabled,
    },
    {
      key: 'github',
      label: t('auth.signInWithGithub'),
      Icon: FaGithub,
      onClick: () => {},
      disabled: authState.loading || invitationDisabled,
    },
  ] as const;

  const handlePasswordFocus = () => {
    if (blurTimeoutRef.current) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setPasswordFocused(true);
    setPasswordPopoverOpen(!isValid);
  };

  const handlePasswordBlur = () => {
    setPasswordFocused(false);
    blurTimeoutRef.current = window.setTimeout(() => {
      setPasswordPopoverOpen(false);
    }, 150);
  };

  useEffect(() => {
    if (passwordFocused && !isValid) {
      setPasswordPopoverOpen(true);
    }
    if (isValid) {
      setPasswordPopoverOpen(false);
    }
  }, [isValid, passwordFocused]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        signUp({
          invitationCode: invitationValidated ? validatedInvitationCode : undefined,
          invitationRequired,
        });
      }}
      className="space-y-6"
    >
      {invitationRequired && (
        <div
          className={`flex items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-sm ${
            invitationValidated
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-primary/20 bg-primary/5 text-muted-foreground'
          }`}
        >
          <InvitationStatusIcon className="h-4 w-4" />
          {invitationValidated ? t('invitation.codeApplied') : t('invitation.codeRequired')}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="signup-email" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Mail className="h-4 w-4" />
          {t('auth.email')}
        </Label>
        <div className="relative">
          <Input
            id="signup-email"
            type="email"
            value={formData.email}
            onChange={(e) => updateFormData('email', e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none pr-10 focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <InputStatusIcon status={emailStatus} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-password" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Lock className="h-4 w-4" />
          {t('auth.password')}
        </Label>
        <div className="relative">
          <Input
            id="signup-password"
            type="password"
            value={formData.password}
            onChange={(e) => updateFormData('password', e.target.value)}
            onFocus={handlePasswordFocus}
            onBlur={handlePasswordBlur}
            required
            autoComplete="new-password"
            className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none pr-16 focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <InputStatusIcon status={passwordStatus} className="right-3" />
          {passwordPopoverOpen && !isValid && (
            <div className="pointer-events-none absolute left-0 top-[calc(100%+0.75rem)] z-10">
              <div className="relative min-w-[14rem] max-w-[16rem] rounded-2xl border border-primary/20 bg-background/95 p-4 shadow-xl backdrop-blur">
                <div className="absolute left-8 -top-2 h-4 w-4 rotate-45 border-l border-t border-primary/20 bg-background/95" />
                <h4 className="mb-2 text-sm font-semibold text-primary">
                  {t('password.requirements.title')}
                </h4>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  {requirements.map((req, index) => (
                    <PasswordRequirement key={index} met={req.met} text={req.text} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-confirm" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Lock className="h-4 w-4" />
          {t('auth.confirmPassword')}
        </Label>
        <div className="relative">
          <Input
            id="signup-confirm"
            type="password"
            value={formData.confirmPassword || ''}
            onChange={(e) => updateFormData('confirmPassword', e.target.value)}
            required
            autoComplete="new-password"
            className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none pr-10 focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <InputStatusIcon status={confirmStatus} />
        </div>
      </div>

    {authState.error && (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {authState.error}
      </div>
    )}

    <Button
      type="submit"
      disabled={authState.loading || !isValid || invitationDisabled}
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

    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-primary/15" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-background/95 px-2 text-muted-foreground">{t('auth.or')}</span>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2">
      {socialButtons.map(({ key, label, Icon, onClick, disabled }) => (
        <Button
          key={key}
          type="button"
          onClick={onClick}
          disabled={disabled}
          variant="outline"
          className="w-full gap-2 rounded-full border-primary/20 bg-background/80 shadow-sm transition-all duration-300 hover:shadow-md"
        >
          <Icon className="h-4 w-4" />
          {label}
        </Button>
      ))}
    </div>
  </form>
  );
};

export default Auth;
