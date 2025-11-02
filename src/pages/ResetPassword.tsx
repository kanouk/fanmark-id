import { usePasswordReset } from "@/hooks/usePasswordReset";
import { usePasswordValidation } from "@/hooks/usePasswordValidation";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/AuthLayout";
import { PasswordRequirement } from "@/components/PasswordRequirement";
import { Sparkles, Lock, ShieldCheck, Check, X } from "lucide-react";
import { SimpleHeader } from '@/components/layout/SimpleHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';

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
const ResetPassword = () => {
  const {
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    isLoading,
    isValidSession,
    resetPassword,
  } = usePasswordReset();

  const { requirements, isValid } = usePasswordValidation(password);
  const { t } = useTranslation();

  const passwordStatus = password ? isValid : null;
  const confirmStatus = confirmPassword
    ? confirmPassword === password && confirmPassword.length > 0
    : null;

  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        resetPassword();
      }}
      className="space-y-6"
    >
      <div className="space-y-2">
        <Label htmlFor="reset-password" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Lock className="h-4 w-4" />
          {t('auth.newPassword')}
        </Label>
        <div className="relative">
          <Input
            id="reset-password"
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
        <Label htmlFor="reset-confirm" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          {t('auth.confirmNewPassword')}
        </Label>
        <div className="relative">
          <Input
            id="reset-confirm"
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
        disabled={isLoading || !isValid || password !== confirmPassword}
        className="w-full gap-2 rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:shadow-xl"
      >
        {isLoading ? t('common.loading') : t('auth.resetPassword')}
      </Button>
    </form>
  );

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <SimpleHeader className="sticky top-0 z-50 border-border/40 bg-background/80 backdrop-blur" />

      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-3xl space-y-10">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t('auth.passwordResetTitle')}
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              {t('auth.passwordResetDescription')}
            </p>
          </div>

          <AuthLayout
            title=""
            description=""
            showBackButton
            backTo="/auth"
            backLabel={t('auth.backToLogin')}
          >
            {isValidSession ? (
              form
            ) : (
              <div className="flex flex-col items-center gap-4 py-6 text-muted-foreground">
                <Sparkles className="h-10 w-10 text-primary" />
                <p className="text-sm">{t('common.loading')}</p>
              </div>
            )}
          </AuthLayout>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
};

export default ResetPassword;
