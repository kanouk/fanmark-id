import { useEffect } from 'react';
import { useFanmarkSearch, FanmarkSearchResult } from '@/hooks/useFanmarkSearch';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmojiInput } from '@/components/EmojiInput';
import { Loader2, Search } from 'lucide-react';
import { FiAlertTriangle, FiInfo } from 'react-icons/fi';
import { FanmarkStatusBadge, FanmarkStatus } from '@/components/FanmarkStatusBadge';

interface FanmarkAcquisitionProps {
  prefilledEmoji?: string;
}

export const FanmarkAcquisition = ({ prefilledEmoji }: FanmarkAcquisitionProps) => {
  const { t } = useTranslation();
  const { 
    searchQuery, 
    setSearchQuery, 
    result, 
    loading
  } = useFanmarkSearch();

  // Set prefilled emoji if provided
  useEffect(() => {
    if (prefilledEmoji) {
      setSearchQuery(prefilledEmoji);
    }
  }, [prefilledEmoji, setSearchQuery]);

  const normalizeStatus = (status: FanmarkSearchResult['status']): FanmarkStatus => {
    if (status === 'available' || status === 'payment_required') {
      return 'available';
    }
    if (status === 'taken' || status === 'premium') {
      return 'taken';
    }
    return 'unavailable';
  };

  return (
    <div className="space-y-6">
      {/* Search Section */}
      <Card className="rounded-3xl border border-primary/15 bg-background/90 shadow-[0_15px_35px_rgba(101,195,200,0.12)] backdrop-blur">
        <CardHeader className="space-y-2 px-6 pt-6 pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <Search className="h-5 w-5" />
            {t('dashboard.searchFanma')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('dashboard.searchSubtitle')}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-6">
          <div className="relative">
            <EmojiInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('search.searchPlaceholder')}
              className="h-16 text-center text-2xl"
              disabled={loading}
              maxLength={5}
            />
            {loading && (
              <div className="absolute right-14 top-1/2 transform -translate-y-1/2">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>

          {result && (
            <div className={`rounded-2xl border p-5 ${result.status === 'invalid' ? 'border-rose-200 bg-rose-50' : 'border-primary/10 bg-muted/40'}`}>
              <div className="flex w-full items-center gap-4">
                <span className="text-3xl tracking-[0.3em]">{result.emoji_combination}</span>
                <FanmarkStatusBadge status={normalizeStatus(result.status)} />
              </div>
              {result.status === 'invalid' && result.error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <div className="mb-1 flex items-center gap-2 font-medium">
                    <FiAlertTriangle className="h-4 w-4" />
                    {t('dashboard.inputError')}
                  </div>
                  <div>{result.error}</div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-rose-600">
                    <FiInfo className="h-3 w-3" />
                    {t('dashboard.inputHint')}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tips */}
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
