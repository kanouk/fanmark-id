import { useEffect, useMemo } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmojiInput } from "@/components/EmojiInput";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from 'lucide-react';
import { useTranslation } from "@/hooks/useTranslation";
import { useFanmarkSearch, FanmarkSearchResult } from "@/hooks/useFanmarkSearch";
import { useLotteryEntry } from "@/hooks/useLotteryEntry";
import { FanmarkStatusBadge, FanmarkStatus } from "@/components/FanmarkStatusBadge";
import { FiAlertTriangle, FiInfo } from 'react-icons/fi';
import { canonicalizeEmojiString, segmentEmojiSequence } from '@/lib/emojiConversion';

interface FanmarkSearchProps {
  onSignupPrompt?: () => void;
  onSearchPerformed?: (searchQuery: string) => void;
  onResultChange?: (result: FanmarkSearchResult | null) => void;
  onQueryChange: (query: string) => void;
  statusVariant?: 'authenticated' | 'public';
  showRecent?: boolean;
  query: string;
  onUtilitiesRef?: (utilities: { setQuery: (query: string) => void; clearQuery: () => void; getQuery: () => string }) => void;
  fixedSize?: boolean; // モバイル固定サイズモード
}

const FanmarkSearch: React.FC<FanmarkSearchProps> = ({
  onSignupPrompt,
  onSearchPerformed,
  onResultChange,
  onQueryChange,
  statusVariant = 'authenticated',
  showRecent = true,
  query,
  onUtilitiesRef,
  fixedSize = false,
}) => {
  const { t } = useTranslation();
  const { applyToLottery, cancelLotteryEntry, loading: lotteryLoading } = useLotteryEntry();

  const normalizedInputQuery = useMemo(() => {
    if (!query) return '';
    const canonical = canonicalizeEmojiString(query);
    return segmentEmojiSequence(canonical).slice(0, 5).join('');
  }, [query]);

  const {
    result,
    loading,
    recentFanmarks,
    getNormalizationInfo,
  } = useFanmarkSearch({
    searchQuery: query,
  });

  useEffect(() => {
    onResultChange?.(result);
  }, [result, onResultChange]);

  useEffect(() => {
    if (onUtilitiesRef) {
      onUtilitiesRef({
        setQuery: onQueryChange,
        clearQuery: () => onQueryChange(''),
        getQuery: () => query,
      });
    }
  }, [onUtilitiesRef, onQueryChange, query]);

  const normalizationInfo = normalizedInputQuery && getNormalizationInfo
    ? getNormalizationInfo(normalizedInputQuery)
    : null;

  const normalizeStatus = (result: FanmarkSearchResult): FanmarkStatus => {
    if (result.status === 'available') {
      return 'available';
    }
    if (result.status === 'taken') {
      return 'taken';
    }
    if (result.status === 'not_available') {
      if (result.blocking_status === 'grace') {
        return 'unavailable';
      }
      return statusVariant === 'public' ? 'unavailable' : 'taken';
    }
    return 'unavailable'; // invalid はここに流れる
  };

  const getStatusBadge = (result: FanmarkSearchResult) => (
          <FanmarkStatusBadge status={normalizeStatus(result)} />
  );

  return (
    <div className="overflow-visible space-y-4">
      {/* Search Input */}
      <div className="relative overflow-visible">
        <div>
          <EmojiInput
            value={query}
            onChange={(value) => {
              onQueryChange(value);
            }}
            onSearchPerformed={onSearchPerformed}
            placeholder={t('search.searchPlaceholder')}
            className="text-center"
            maxLength={5}
            disabled={loading}
            showUtilities={false}
            fixedSize={fixedSize}
          />
          {loading && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 transform">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </div>


      {/* Error Display for invalid inputs */}
      {result && normalizedInputQuery && !loading && result.status === 'invalid' && result.error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
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

      {/* Recently Acquired Fanmarks */}
      {showRecent && !normalizedInputQuery && recentFanmarks.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-base-content/70">
            {t('search.recentlyAcquired')}
          </h3>
          <div className="grid gap-2">
            {recentFanmarks.map((fanmark, index) => (
              <Card key={`recent-${fanmark.id}-${index}`} className="hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex w-full flex-col gap-2">
                    <span className="text-3xl tracking-[0.15em] leading-none">{fanmark.fanmark || '❓'}</span>
                    {getStatusBadge(fanmark)}
                    
                    {/* Lottery info for grace/returning status */}
                    {fanmark.blocking_status === 'grace' && (fanmark.lottery_entry_count ?? 0) > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('lottery.entryCount', { count: fanmark.lottery_entry_count })}
                      </p>
                    )}
                    
                    <div className="flex gap-2 mt-2">
                      <Button variant="outline" size="sm" asChild>
                        <a href={`/f/${fanmark.short_id}`}>ファンマページを開く</a>
                      </Button>
                      
                      {fanmark.blocking_status === 'grace' && !fanmark.has_user_lottery_entry && (
                        <Button
                          size="sm"
                          onClick={async () => {
                            if (fanmark.id) {
                              try {
                                await applyToLottery(fanmark.id, { emoji: fanmark.fanmark });
                              } catch (error) {
                                console.error('Failed to apply to lottery from recent fanmarks:', error);
                              }
                            }
                          }}
                          disabled={lotteryLoading}
                        >
                          {t('lottery.applyButton')}
                        </Button>
                      )}
                      
                      {fanmark.has_user_lottery_entry && (
                        <Badge className="bg-primary/10 text-primary border-primary/30">
                          {t('lottery.appliedBadge')}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};

export default FanmarkSearch;
