import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { usePasswordValidation } from '@/hooks/usePasswordValidation';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthLayout } from '@/components/AuthLayout';
import { PasswordRequirement } from '@/components/PasswordRequirement';
import { SimpleHeader } from '@/components/layout/SimpleHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Check, Lock, ShieldCheck, Sparkles, X } from 'lucide-react';

const PASSWORD_SETUP_PATH = '/password-setup';

const InputStatusIcon = ({ status }: { status: boolean | null }) => {
  if (status === null) return null;
  return (
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
      {status ? (
        <Check className="h-4 w-4 text-emerald-500" />
      ) : (
        <X className="h-4 w-4 text-destructive" />
      )}
    </span>
  );
};

export const PasswordSetup = () => {
  const { user, requiresPasswordSetup, setRequiresPasswordSetup, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { toast } = useToast();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { requirements, isValid } = usePasswordValidation(password);

  const redirectTarget = useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from;
  }, [location.state]);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      navigate('/auth', { replace: true });
      return;
    }

    if (!requiresPasswordSetup && location.pathname === PASSWORD_SETUP_PATH) {
      navigate(redirectTarget || '/dashboard', { replace: true });
    }
  }, [loading, user?.id, requiresPasswordSetup, navigate, redirectTarget, location.pathname]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      toast({
        title: t('common.error'),
        description: t('auth.passwordMismatch'),
        variant: 'destructive',
      });
      return;
    }

    if (!user) {
      toast({
        title: t('common.error'),
        description: t('common.tryAgain'),
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      const { error: flagError } = await supabase
        .from('user_settings')
        .update({ requires_password_setup: false })
        .eq('user_id', user.id);

      if (flagError) throw flagError;

      setRequiresPasswordSetup(false);
      toast({
        title: t('common.passwordUpdated'),
        description: t('common.passwordUpdatedDesc'),
      });

      navigate(redirectTarget || '/dashboard', { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      toast({
        title: t('common.error'),
        description: message || t('common.tryAgain'),
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const passwordStatus = password ? isValid : null;
  const confirmStatus = confirmPassword
    ? confirmPassword === password && confirmPassword.length > 0
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <SimpleHeader className="sticky top-0 z-50 border-border/40 bg-background/80 backdrop-blur" />
      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-3xl space-y-10">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t('auth.passwordSetupTitle')}
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              {t('auth.passwordSetupDescription')}
            </p>
          </div>

          <AuthLayout title="" description="" showBackButton={false}>
            {loading ? (
              <div className="flex flex-col items-center gap-4 py-6 text-muted-foreground">
                <Sparkles className="h-10 w-10 text-primary" />
                <p className="text-sm">{t('common.loading')}</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="password-setup-new" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Lock className="h-4 w-4" />
                    {t('auth.newPassword')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="password-setup-new"
                      type="password"
                      placeholder={t('password.requirements.length')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none pr-10 focus-visible:ring-2 focus-visible:ring-primary/40"
                    />
                    <InputStatusIcon status={passwordStatus} />
                  </div>
                  {password && (
                    <div className="rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
                      <h4 className="mb-2 font-semibold text-primary">{t('password.requirements.title')}</h4>
                      <div className="space-y-1.5">
                        {requirements.map((req, index) => (
                          <PasswordRequirement key={index} met={req.met} text={req.text} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password-setup-confirm" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <ShieldCheck className="h-4 w-4" />
                    {t('auth.confirmNewPassword')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="password-setup-confirm"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none pr-10 focus-visible:ring-2 focus-visible:ring-primary/40"
                    />
                    <InputStatusIcon status={confirmStatus} />
                  </div>
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-xs text-destructive">{t('auth.passwordMismatch')}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={submitting || !isValid || password !== confirmPassword}
                  className="w-full gap-2 rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:shadow-xl"
                >
                  {submitting ? t('common.loading') : t('auth.savePassword')}
                </Button>
              </form>
            )}
          </AuthLayout>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
};

export default PasswordSetup;
