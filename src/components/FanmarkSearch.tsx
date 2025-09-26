import { useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EmojiInput } from "@/components/EmojiInput";
import { Loader2 } from 'lucide-react';
import { useTranslation } from "@/hooks/useTranslation";
import { useFanmarkSearch, FanmarkSearchResult } from "@/hooks/useFanmarkSearch";
import { FanmarkStatusBadge, FanmarkStatus } from "@/components/FanmarkStatusBadge";
import { FiAlertTriangle, FiInfo } from 'react-icons/fi';

interface FanmarkSearchProps {
  onSignupPrompt?: () => void;
  onSearchPerformed?: (searchQuery: string) => void;
  onResultChange?: (result: FanmarkSearchResult | null) => void;
  statusVariant?: 'authenticated' | 'public';
  showRecent?: boolean;
  initialQuery?: string;
  onUtilitiesRef?: (utilities: { setQuery: (query: string) => void; clearQuery: () => void }) => void;
}

const FanmarkSearch: React.FC<FanmarkSearchProps> = ({
  onSignupPrompt,
  onSearchPerformed,
  onResultChange,
  statusVariant = 'authenticated',
  showRecent = true,
  initialQuery,
  onUtilitiesRef,
}) => {
  const { t } = useTranslation();
  const { 
    searchQuery, 
    setSearchQuery, 
    result, 
    loading, 
    recentFanmarks, 
    getNormalizationInfo
  } = useFanmarkSearch();

  useEffect(() => {
    onResultChange?.(result);
  }, [result, onResultChange]);

  useEffect(() => {
    if (initialQuery === undefined) return;
    if (initialQuery !== searchQuery) {
      setSearchQuery(initialQuery);
    }
  }, [initialQuery, searchQuery, setSearchQuery]);

  // Expose utilities to parent component
  useEffect(() => {
    if (onUtilitiesRef) {
      onUtilitiesRef({
        setQuery: setSearchQuery,
        clearQuery: () => setSearchQuery(''),
      });
    }
  }, [onUtilitiesRef, setSearchQuery]);

  // Get normalization info for current search query
  const normalizationInfo = searchQuery.trim() && getNormalizationInfo ? getNormalizationInfo(searchQuery.trim()) : null;

  const normalizeStatus = (status: FanmarkSearchResult['status']): FanmarkStatus => {
    if (status === 'available') {
      return 'available';
    }
    if (status === 'taken') {
      return 'taken';
    }
    if (status === 'not_available') {
      return statusVariant === 'public' ? 'unavailable' : 'taken';
    }
    return 'unavailable'; // invalid はここに流れる
  }; 


  const getStatusBadge = (result: FanmarkSearchResult) => (
          <FanmarkStatusBadge status={normalizeStatus(result.status)} />
  );

  return (
    <div className="overflow-visible space-y-4">
      {/* Search Input */}
      <div className="relative overflow-visible">
        <div>
          <EmojiInput
            value={searchQuery}
            onChange={setSearchQuery}
            onSearchPerformed={onSearchPerformed}
            placeholder={t('search.searchPlaceholder')}
            className="h-16 text-center text-2xl"
            maxLength={5}
            disabled={loading}
            showUtilities={false}
          />
          {loading && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 transform">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </div>

      {/* Skin Tone Normalization Info */}
      {normalizationInfo?.isNormalized && (
        <TooltipProvider>
          <Alert className="rounded-2xl border border-primary/15 bg-primary/5">
            <AlertDescription className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-primary">
                  {t('search.skinTone.normalizationInfo')}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge 
                      variant="outline" 
                      className="bg-primary/10 border-primary/30 text-primary cursor-help"
                    >
                      {normalizationInfo?.normalized} {t('search.skinTone.allVariationsIncluded')}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-sm">{t('search.skinTone.tooltip')}</p>
                    <p className="text-xs mt-1 opacity-75">{t('search.skinTone.example')}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </AlertDescription>
          </Alert>
        </TooltipProvider>
      )}

      {/* Error Display for invalid inputs */}
      {result && searchQuery.trim() && !loading && result.status === 'invalid' && result.error && (
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
      {showRecent && !searchQuery && recentFanmarks.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-base-content/70">
            {t('search.recentlyAcquired')}
          </h3>
          <div className="grid gap-2">
            {recentFanmarks.map((fanmark, index) => (
              <Card key={`recent-${fanmark.id}-${index}`} className="hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex w-full items-center gap-3">
                    <span className="text-3xl tracking-[0.15em] leading-none">{fanmark.emoji_combination || '❓'}</span>
                    {getStatusBadge(fanmark)}
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
