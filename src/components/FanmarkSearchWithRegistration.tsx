import FanmarkSearch from '@/components/FanmarkSearch';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface FanmarkSearchWithRegistrationProps {
  onSignupPrompt?: () => void;
}

export const FanmarkSearchWithRegistration = ({ onSignupPrompt }: FanmarkSearchWithRegistrationProps) => {
  const { t } = useTranslation();

  return (
    <div className="relative mx-auto max-w-5xl">
      <div className="absolute inset-x-10 -top-10 -z-10 h-32 rounded-full bg-primary/20 blur-3xl" aria-hidden />
      <Card className="overflow-hidden border border-primary/20 bg-card/95 shadow-[0_20px_60px_rgba(101,195,200,0.15)]">
        <CardHeader className="space-y-3 text-center px-3 py-3 sm:px-5 sm:py-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-2xl">
            🔍
          </div>
          <CardTitle className="text-3xl sm:text-4xl font-bold tracking-tight">
            {t('search.searchFanmarks')}
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            {t('search.foundPerfect')}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-8 pt-4 sm:px-8">
          <FanmarkSearch onSignupPrompt={onSignupPrompt} />
        </CardContent>
      </Card>
    </div>
  );
};
