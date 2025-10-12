import { useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
            className="text-center"
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
                    <span className="text-3xl tracking-[0.15em] leading-none">{(fanmark.fanmark || fanmark.user_input_fanmark) || '❓'}</span>
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
