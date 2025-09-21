import { usePasswordReset } from "@/hooks/usePasswordReset";
import { usePasswordValidation } from "@/hooks/usePasswordValidation";
import { useTranslation } from "@/hooks/useTranslation";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/AuthLayout";
import { PasswordRequirement } from "@/components/PasswordRequirement";
import { Sparkles, Lock, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

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
  const navigate = useNavigate();

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
        <Input
          id="reset-password"
          type="password"
          placeholder={t('password.requirements.length')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="h-12 rounded-full border border-primary/15 bg-background/80 text-base shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        />
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
        <Input
          id="reset-confirm"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          className="h-12 rounded-full border border-primary/15 bg-background/80 text-base shadow-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        />
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

export default ResetPassword;
