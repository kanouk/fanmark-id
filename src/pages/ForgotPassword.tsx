import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";
import { AuthLayout } from "@/components/AuthLayout";
import { LanguageToggle } from "@/components/LanguageToggle";
import { BrandWordmark } from '@/components/BrandWordmark';
import { Mail, Sparkles, RefreshCw, Check, X } from "lucide-react";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();

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

  const descriptionText = isSubmitted ? t('auth.resetEmailSent') : t('auth.forgotPasswordDescription');
  const emailStatus = email ? EMAIL_REGEX.test(email) : null;

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
            <BrandWordmark className="text-2xl" />
          </button>
          <LanguageToggle />
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-3xl space-y-10">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t('auth.forgotPasswordTitle')}
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">{descriptionText}</p>
          </div>

          <AuthLayout
            title=""
            description=""
            showBackButton
            backTo="/auth"
            backLabel={t('auth.backToLogin')}
          >
            {isSubmitted ? (
              <div className="space-y-6 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Mail className="h-6 w-6" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{t('auth.resetEmailSent')}</h3>
                <p className="text-sm text-muted-foreground">{t('auth.resetEmailDescription')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsSubmitted(false)}
                    className="gap-2 rounded-full"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t('auth.tryAnotherEmail')}
                  </Button>
                  <Button variant="ghost" asChild className="rounded-full text-sm">
                    <Link to="/auth">{t('auth.backToLogin')}</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="reset-email" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    {t('auth.email')}
                  </Label>
                  <div className="relative">
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder={t('invitation.emailPlaceholder')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      className="h-11 rounded-2xl border border-primary/15 bg-background/80 text-base shadow-none pr-10 focus-visible:ring-2 focus-visible:ring-primary/40"
                    />
                    <InputStatusIcon status={emailStatus} />
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full gap-2 rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:shadow-xl"
                >
                  {isLoading ? (
                    <>
                      <Sparkles className="h-4 w-4 animate-spin" />
                      {t('common.loading')}
                    </>
                  ) : (
                    <>
                      <Mail className="h-4 w-4" />
                      {t('auth.sendResetEmail')}
                    </>
                  )}
                </Button>
              </form>
            )}
          </AuthLayout>
        </div>
      </div>

      <footer className="border-t border-border/40 bg-background/80 backdrop-blur">
        <div className="container mx-auto px-4 py-10 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
            <span className="text-3xl">✨</span> <BrandWordmark />
          </div>
          <p className="text-sm text-muted-foreground">{t('sections.footer')}</p>
        </div>
      </footer>
    </div>
  );
};

export default ForgotPassword;
