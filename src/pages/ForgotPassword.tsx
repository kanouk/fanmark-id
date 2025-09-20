import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { AuthLayout } from "@/components/AuthLayout";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });

      if (error) {
        toast({
          title: t('common.error'),
          description: error.message,
          variant: "destructive",
        });
      } else {
        setIsSubmitted(true);
        toast({
          title: t('auth.resetEmailSent'),
          description: t('auth.resetEmailDescription'),
        });
      }
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('common.tryAgain'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout 
      title={t('auth.forgotPasswordTitle')} 
      description={isSubmitted ? t('auth.resetEmailSent') : t('auth.forgotPasswordDescription')}
      showBackButton
      backTo="/auth"
      backLabel={t('auth.backToLogin')}
    >
      {isSubmitted ? (
        <div className="text-center space-y-4">
          <div className="text-6xl">📧</div>
          <h3 className="text-lg font-semibold">{t('auth.resetEmailSent')}</h3>
          <p className="text-sm text-base-content/70">
            {t('auth.resetEmailDescription')}
          </p>
          <div className="space-y-2">
            <Button 
              variant="outline" 
              onClick={() => setIsSubmitted(false)}
              className="w-full"
            >
              {t('auth.tryAnotherEmail')}
            </Button>
            <Button 
              variant="ghost" 
              asChild
              className="w-full text-sm"
            >
              <Link to="/auth">← {t('auth.backToLogin')}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input
              id="email"
              type="email"
              placeholder={t('invitation.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <Button 
            type="submit" 
            className="w-full" 
            disabled={isLoading}
          >
            {isLoading ? t('common.loading') : t('auth.sendResetEmail')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};

export default ForgotPassword;