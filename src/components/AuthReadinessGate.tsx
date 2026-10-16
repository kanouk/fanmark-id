import { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';

export const AuthReadinessGate = ({ children }: { children: ReactNode }) => {
  const { loading, profileGateError, refreshSession } = useAuth();
  const { t } = useTranslation();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (profileGateError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div role="alert" className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">{t('auth.profileCheckFailed')}</h1>
          <p className="text-muted-foreground">{t('auth.profileCheckRetry')}</p>
          <Button onClick={() => { void refreshSession(); }}>{t('common.tryAgain')}</Button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
};
