import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles } from 'lucide-react';
import { FiInfo, FiAlertTriangle } from 'react-icons/fi';
import FanmarkSearch from '@/components/FanmarkSearch';
import { useTranslation } from '@/hooks/useTranslation';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FanmarkSearchResult } from '@/hooks/useFanmarkSearch';
import { FanmarkStatusBadge } from '@/components/FanmarkStatusBadge';
import { supabase } from '@/integrations/supabase/client';

interface FanmarkAcquisitionProps {
  prefilledEmoji?: string;
  fanmarkLimit?: number;
  currentCount?: number;
  onObtain?: (fanmark: { id: string; emoji_combination?: string }) => void;
  onRequireAuth?: (emoji: string) => void;
}

export const FanmarkAcquisition = ({
  prefilledEmoji,
  fanmarkLimit = 0,
  currentCount = 0,
  onObtain,
  onRequireAuth,
}: FanmarkAcquisitionProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [searchResult, setSearchResult] = useState<FanmarkSearchResult | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const remainingCapacity = useMemo(() => {
    return Math.max(fanmarkLimit - currentCount, 0);
  }, [fanmarkLimit, currentCount]);

  const isResultAcquirable = useMemo(() => {
    if (!searchResult) return false;
    return searchResult.status === 'available' || searchResult.status === 'payment_required';
  }, [searchResult]);

  const getSearchAreaBackgroundClass = useMemo(() => {
    if (!searchResult || !searchResult.emoji_combination || searchResult.error) {
      return 'bg-background/90';
    }

    if (searchResult.status === 'available' || searchResult.status === 'payment_required') {
      return 'bg-emerald-50/30';
    } else if (searchResult.status === 'taken' || searchResult.status === 'premium') {
      return user ? 'bg-sky-50/30' : 'bg-rose-50/30';
    } else {
      return 'bg-rose-50/30';
    }
  }, [searchResult, user]);

  const handleAcquireRequest = () => {
    if (!searchResult || !isResultAcquirable) return;

    if (!user) {
      onRequireAuth?.(searchResult.emoji_combination);
      return;
    }

    if (remainingCapacity <= 0) {
      toast({
        title: t('dashboard.acquireLimitReachedTitle'),
        description: t('dashboard.acquireLimitReachedDescription'),
        variant: 'destructive',
      });
      return;
    }

    setIsConfirmOpen(true);
  };

  const handleConfirmAcquire = useCallback(async () => {
    if (!searchResult) return;
    setIsRegistering(true);

    try {
      const response = await supabase.functions.invoke<{ success: boolean; fanmark?: { id: string; emoji_combination?: string }; error?: string }>('register-fanmark', {
        body: { input_emoji_combination: searchResult.emoji_combination },
      });

      if (response.error || !response.data?.success || !response.data.fanmark) {
        throw new Error(response.error?.message || response.data?.error || 'Failed to register fanmark');
      }

      const fanmark = response.data.fanmark;

      toast({
        title: t('dashboard.acquireSuccessTitle'),
        description: t('dashboard.acquireSuccessDescription'),
      });

      onObtain?.(fanmark);
      navigate(`/fanmarks/${fanmark.id}/settings`, { state: { isNew: true } });
    } catch (error) {
      console.error('Fanmark registration failed:', error);
      
      toast({
        title: t('dashboard.acquireFailedTitle'),
        description: error instanceof Error ? error.message : t('dashboard.acquireFailedDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsRegistering(false);
      setIsConfirmOpen(false);
    }
  }, [navigate, onObtain, searchResult, t, toast]);

  return (
    <div className="space-y-6">
      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent className="rounded-3xl border border-primary/20 bg-background/95 shadow-[0_25px_60px_rgba(101,195,200,0.2)]">
          <AlertDialogHeader className="space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <AlertDialogTitle className="text-xl font-semibold text-foreground">
              {t('dashboard.acquireConfirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              {t('dashboard.acquireConfirmDescription', {
                remaining: Math.max(remainingCapacity - 1, 0),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <AlertDialogCancel
              className="h-11 rounded-full border border-border bg-transparent px-6 text-sm font-semibold text-muted-foreground hover:bg-primary/10 hover:text-foreground"
              disabled={isRegistering}
            >
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-lg hover:bg-primary/90"
              onClick={handleConfirmAcquire}
              disabled={isRegistering}
            >
              {isRegistering ? t('common.processing') : t('dashboard.acquireConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className={`rounded-3xl border border-primary/15 ${getSearchAreaBackgroundClass} shadow-[0_15px_35px_rgba(101,195,200,0.12)] backdrop-blur transition-colors duration-300`}>
        <CardHeader className="space-y-2 px-6 pt-6 pb-2">
          <CardTitle className="flex items-center justify-between text-lg font-semibold">
            <span className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              {t('dashboard.searchFanma')}
            </span>
            {searchResult && searchResult.emoji_combination && !searchResult.error && (
              <div className="flex-shrink-0">
                <FanmarkStatusBadge status={searchResult.status === 'available' || searchResult.status === 'payment_required' ? 'available' : searchResult.status === 'taken' || searchResult.status === 'premium' ? (user ? 'taken' : 'unavailable') : 'unavailable'} />
              </div>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('dashboard.searchSubtitle')}
          </p>
        </CardHeader>
        <CardContent className="space-y-5 px-6 pb-6">
          <FanmarkSearch
            onSignupPrompt={() => onRequireAuth?.('')}
            statusVariant={user ? 'authenticated' : 'public'}
            showRecent={false}
            onResultChange={setSearchResult}
            initialQuery={prefilledEmoji}
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {searchResult && (searchResult.status === 'available' || searchResult.status === 'payment_required') ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                <span>{t('dashboard.acquireReadyMessage')}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FiAlertTriangle className="h-4 w-4 text-muted-foreground/60" />
                <span>{t('dashboard.acquireHint')}</span>
              </div>
            )}

            <Button
              size="lg"
              className="rounded-full px-6"
              onClick={handleAcquireRequest}
              disabled={!searchResult || !isResultAcquirable || remainingCapacity <= 0}
            >
              {user ? t('dashboard.acquireButton') : t('dashboard.acquireLoginButton')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border border-primary/10 bg-background/80 shadow-[0_10px_25px_rgba(101,195,200,0.08)]">
        <CardContent className="pt-6">
          <div className="rounded-2xl bg-gradient-to-r from-primary/10 to-accent/10 p-4">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
              <FiInfo className="h-4 w-4" /> {t('dashboard.tips')}
            </h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• {t('dashboard.tip1')}</li>
              <li>• {t('dashboard.tip2')}</li>
              <li>• {t('dashboard.tip3')}</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
