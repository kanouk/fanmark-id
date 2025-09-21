import FanmarkSearch from '@/components/FanmarkSearch';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';

interface FanmarkSearchWithRegistrationProps {
  onSignupPrompt?: () => void;
  showRecent?: boolean;
}

export const FanmarkSearchWithRegistration = ({ onSignupPrompt, showRecent = true }: FanmarkSearchWithRegistrationProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const statusVariant = user ? 'authenticated' : 'public';

  return (
    <section className="relative mx-auto max-w-5xl space-y-6">
      <div className="text-center space-y-3">
        <h2 className="flex items-center justify-center gap-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-5xl">
          <span className="text-4xl">🔍</span>
          <span>{t('search.searchFanmas')}</span>
        </h2>
        <p className="text-base text-muted-foreground sm:text-lg">
          {t('search.foundPerfect')}
        </p>
      </div>
      <div className="relative overflow-visible">
        <div className="absolute inset-x-10 -top-10 -z-10 h-32 rounded-full bg-primary/20 blur-3xl" aria-hidden />
        <Card className="rounded-3xl border border-primary/15 bg-background/95 shadow-[0_20px_45px_rgba(101,195,200,0.16)]">
          <CardContent className="space-y-4 px-6 pb-6 pt-6 overflow-visible">
            <FanmarkSearch onSignupPrompt={onSignupPrompt} statusVariant={statusVariant} showRecent={showRecent} />
          </CardContent>
        </Card>
      </div>
    </section>
  );
};
