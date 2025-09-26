import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sparkles, ExternalLink, Plus } from 'lucide-react';
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

  const isResultAcquirable = useMemo(() => searchResult?.status === 'available', [searchResult]);

  const isOwnedByMe = useMemo(() => {
    return !!(searchResult?.owner?.user_id && user?.id && searchResult.owner.user_id === user.id);
  }, [searchResult?.owner?.user_id, user?.id]);

  const isTaken = useMemo(() => searchResult?.status === 'taken' || searchResult?.status === 'not_available', [searchResult?.status]);

  const getSearchAreaBackgroundClass = useMemo(() => {
    if (!searchResult || !searchResult.emoji_combination || searchResult.error) {
      return 'bg-background/90';
    }
    if (searchResult.status === 'available') return 'bg-emerald-50/30';
    // not_available
    return isOwnedByMe ? 'bg-sky-50/30' : 'bg-rose-50/30';
  }, [searchResult, isOwnedByMe]);

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

  const handleVisitFanmark = useCallback(() => {
    if (!searchResult?.emoji_combination) return;

    const fanmarkUrl = `/${searchResult.emoji_combination}`;
    window.open(fanmarkUrl, '_blank', 'noopener,noreferrer');
  }, [searchResult?.emoji_combination]);

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
            <span className="flex items-center gap-2 text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              <Search className="h-6 w-6 text-primary" />
              {t('dashboard.searchFanma')}
            </span>
            {searchResult && searchResult.emoji_combination && !searchResult.error && (
              <div className="flex-shrink-0">
                <FanmarkStatusBadge
                  status={
                    searchResult.status === 'available'
                      ? 'available'
                      : (isOwnedByMe ? 'taken' : 'unavailable')
                  }
                />
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

          <div className="flex flex-col gap-3 items-center">
            {/* Show acquisition button for available fanmarks */}
            {isResultAcquirable && (
              <Button
                size="lg"
                className="rounded-full px-6 gap-2"
                onClick={handleAcquireRequest}
                disabled={!searchResult || remainingCapacity <= 0}
              >
                <Plus className="h-4 w-4" />
                {user ? t('dashboard.acquireButton') : t('dashboard.acquireLoginButton')}
              </Button>
            )}

            {/* Show visit button for taken fanmarks */}
            {isTaken && searchResult?.emoji_combination && (
              <Button
                size="lg"
                variant="outline"
                className="rounded-full px-6 gap-2"
                onClick={handleVisitFanmark}
              >
                <ExternalLink className="h-4 w-4" />
                {t('dashboard.visitFanmarkButton')}
              </Button>
            )}

            <div className="min-h-[2.5rem] flex items-center justify-center">
              {searchResult?.status === 'available' && user && remainingCapacity <= 0 && (
                <div className="text-red-500 text-sm text-center">
                  {t('dashboard.acquireLimitReachedDescription')}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
};
