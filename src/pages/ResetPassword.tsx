import { usePasswordReset } from "@/hooks/usePasswordReset";
import { usePasswordValidation } from "@/hooks/usePasswordValidation";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/AuthLayout";
import { PasswordRequirement } from "@/components/PasswordRequirement";

const ResetPassword = () => {
  const {
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    isLoading,
    isValidSession,
    resetPassword
  } = usePasswordReset();
  
  const { requirements, isValid } = usePasswordValidation(password);
  const { t } = useTranslation();

  if (!isValidSession) {
    return (
      <AuthLayout 
        title={t('common.loading')} 
        description={t('auth.passwordResetDescription')}
      >
        <div className="text-center space-y-4">
          <div className="text-6xl">🔒</div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout 
      title={t('auth.passwordResetTitle')} 
      description={t('auth.passwordResetDescription')}
      showBackButton
      backTo="/auth"
      backLabel={t('auth.backToLogin')}
    >
      <form onSubmit={(e) => { e.preventDefault(); resetPassword(); }} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{t('auth.newPassword')}</Label>
          <Input
            id="password"
            type="password"
            placeholder={t('password.requirements.length')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          {password && (
            <div className="space-y-1 p-3 bg-muted/50 rounded-md">
              <p className="text-sm font-medium text-muted-foreground mb-2">{t('password.requirements.length')}:</p>
              {requirements.map((req, index) => (
                <PasswordRequirement key={index} met={req.met} text={req.text} />
              ))}
            </div>
          )}
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">{t('auth.confirmNewPassword')}</Label>
          <Input
            id="confirmPassword"
            type="password"
            placeholder={t('auth.confirmNewPassword')}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          {confirmPassword && password !== confirmPassword && (
            <p className="text-sm text-destructive">{t('auth.passwordMismatch')}</p>
          )}
        </div>
        
        <Button 
          type="submit" 
          className="w-full" 
          disabled={isLoading || !isValid || password !== confirmPassword}
        >
          {isLoading ? t('common.loading') : t('auth.resetPassword')}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default ResetPassword;