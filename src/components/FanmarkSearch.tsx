import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Sparkles, Eye, Crown } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useFanmarkSearch, FanmarkSearchResult } from "@/hooks/useFanmarkSearch";

interface FanmarkSearchProps {
  onSignupPrompt?: () => void;
}

const FanmarkSearch: React.FC<FanmarkSearchProps> = ({ onSignupPrompt }) => {
  const { t } = useTranslation();
  const { 
    searchQuery, 
    setSearchQuery, 
    result, 
    loading, 
    recentFanmarks, 
    checkAvailability, 
    registerFanmark, 
    refetchRecent,
    getNormalizationInfo
  } = useFanmarkSearch();

  // Get normalization info for current search query
  const normalizationInfo = searchQuery.trim() && getNormalizationInfo ? getNormalizationInfo(searchQuery.trim()) : null;

  const getStatusBadge = (result: FanmarkSearchResult) => {
    switch (result.status) {
      case 'available':
        return (
          <Badge className="bg-success text-success-content border-success/20">
            <Sparkles className="w-3 h-3 mr-1" />
            ✅ {t('search.available')}
          </Badge>
        );
      case 'taken':
        return (
          <Badge variant="destructive">
            <Eye className="w-3 h-3 mr-1" />
            ❌ {t('search.taken')}
          </Badge>
        );
      case 'premium':
        return (
          <Badge className="bg-warning text-warning-content border-warning/20">
            <Crown className="w-3 h-3 mr-1" />
            💎 {t('search.premium')}
          </Badge>
        );
      case 'payment_required':
        return (
          <Badge className="bg-info text-info-content border-info/20">
            💳 {t('search.paymentRequired')}
          </Badge>
        );
      default:
        return null;
    }
  };

  const handleRegister = async (emoji: string) => {
    const response = await registerFanmark(emoji);
    if (response.success) {
      // Refresh search to show updated status
      setSearchQuery(searchQuery);
    } else {
      console.error('Registration failed:', response.error);
      // For now, prompt signup - later we'll handle authentication
      onSignupPrompt?.();
    }
  };

  const handleSignupPrompt = () => {
    onSignupPrompt?.();
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-base-content/70 w-4 h-4" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('search.searchPlaceholder')}
          className="input input-bordered input-primary pl-10 pr-4 py-3 text-lg rounded-full"
        />
      </div>

      {/* Skin Tone Normalization Info */}
      {normalizationInfo?.isNormalized && (
        <TooltipProvider>
          <Alert className="border-primary/20 bg-gradient-to-r from-primary/5 to-secondary/5">
            <AlertDescription className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-primary">
                  {t('search.skinTone.normalizationInfo')}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge 
                      variant="outline" 
                      className="bg-gradient-to-r from-violet-100 to-pink-100 border-primary/30 text-primary cursor-help"
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

      {/* Status Display */}
      {loading && searchQuery.trim() && (
        <div className="flex items-center justify-center py-4">
          <div className="inline-flex items-center space-x-2">
            <span className="loading loading-spinner loading-md text-primary"></span>
            <span className="text-base-content/70">{t('common.loading')}</span>
          </div>
        </div>
      )}

      {result && searchQuery.trim() && !loading && (
        <div className="space-y-2">
          {/* Error Display */}
          {(result as any).error && (
            <div className="flex items-center justify-center p-3 rounded-lg border border-destructive/20 bg-destructive/5">
              <span className="text-destructive text-sm font-medium">{(result as any).error}</span>
            </div>
          )}
          
          {/* Result Display */}
          {!(result as any).error && (
            <div className="flex items-center justify-between p-4 rounded-lg border bg-base-100 border-base-300">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{result.emoji_combination}</span>
                {result.short_id && (
                  <div className="text-sm text-base-content/70">
                    fanmark.id/e/{result.short_id}
                  </div>
                )}
                {result.emoji_count && (
                  <div className="text-xs text-base-content/70 bg-base-200 px-2 py-1 rounded">
                    {result.emoji_count}{t('search.emojiCountLabel')}
                  </div>
                )}
              </div>
              <div className="flex items-center space-x-3">
                {getStatusBadge(result)}
                {result.status === 'available' && (
                  <Button 
                    onClick={() => handleRegister(result.emoji_combination)} 
                    size="sm" 
                    className="bg-success text-success-content hover:bg-success/80 rounded-full"
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    Register ✨
                  </Button>
                )}
                {result.status === 'payment_required' && (
                  <div className="flex flex-col items-end gap-1">
                    <Button 
                      onClick={handleSignupPrompt}
                      size="sm" 
                      className="bg-info text-info-content hover:bg-info/80 rounded-full"
                    >
                      Pay ${result.price_usd?.toLocaleString()} 💳
                    </Button>
                    <span className="text-xs text-base-content/70">
                      {result.emoji_count === 1 ? t('search.pricingLabels.premiumEmoji') : 
                       result.emoji_count === 2 ? t('search.pricingLabels.paidEmoji') : t('search.pricingLabels.reservedEmoji')}
                    </span>
                  </div>
                )}
                {(result.status === 'taken' || result.status === 'premium') && (
                  <Button variant="ghost" size="sm">
                    {t('search.viewProfile')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recently Acquired Fanmarks */}
      {!searchQuery && recentFanmarks.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-base-content/70">
            {t('search.recentlyAcquired')}
          </h3>
          <div className="grid gap-2">
            {recentFanmarks.map((fanmark, index) => (
              <Card key={`recent-${fanmark.id}-${index}`} className="hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-xl">{fanmark.emoji_combination}</span>
                      <div className="flex flex-col">
                        <div className="text-sm text-base-content/70">
                          fanmark.id/e/{fanmark.short_id}
                        </div>
                        {fanmark.owner && (
                          <div className="text-xs text-base-content/70">
                            by @{fanmark.owner.username}
                          </div>
                        )}
                      </div>
                    </div>
                    {getStatusBadge(fanmark)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="text-center text-sm text-base-content/70">
        {t('search.joinThousands')}
      </div>
    </div>
  );
};

export default FanmarkSearch;