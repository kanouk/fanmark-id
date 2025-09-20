import { useState } from 'react';
import { Search, Sparkles, Eye, Crown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslation } from '@/hooks/useTranslation';
import { useFanmarkSearch, FanmarkSearchResult } from '@/hooks/useFanmarkSearch';

interface FanmarkSearchProps {
  onSignupPrompt?: () => void;
}

export function FanmarkSearch({ onSignupPrompt }: FanmarkSearchProps) {
  const { t } = useTranslation();
  const { searchQuery, setSearchQuery, result, loading, recentFanmarks } = useFanmarkSearch();

  const getStatusBadge = (result: FanmarkSearchResult) => {
    switch (result.status) {
      case 'available':
        return (
          <Badge className="bg-green-100 text-green-800 border-green-200 hover:bg-green-200">
            <Sparkles className="w-3 h-3 mr-1" />
            {t('search.available')}
          </Badge>
        );
      case 'taken':
        return (
          <Badge variant="destructive">
            <Eye className="w-3 h-3 mr-1" />
            {t('search.taken')}
          </Badge>
        );
      case 'premium':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-200">
            <Crown className="w-3 h-3 mr-1" />
            {t('search.premium')}
          </Badge>
        );
      default:
        return null;
    }
  };


  const handleSignupPrompt = () => {
    onSignupPrompt?.();
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('hero.searchPlaceholder')}
          className="pl-10 pr-4 py-3 text-lg rounded-full border-2 border-primary/20 focus:border-primary focus:ring-primary"
        />
      </div>


      {/* Status Display */}
      {loading && searchQuery.trim() && (
        <div className="flex items-center justify-center py-4">
          <div className="inline-flex items-center space-x-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
            <span className="text-muted-foreground">{t('common.loading')}</span>
          </div>
        </div>
      )}

      {result && searchQuery.trim() && !loading && (
        <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">{result.emoji_combination}</span>
            {result.short_id && (
              <div className="text-sm text-muted-foreground">
                fanmark.id/e/{result.short_id}
              </div>
            )}
          </div>
          <div className="flex items-center space-x-3">
            {getStatusBadge(result)}
            {result.status === 'available' && (
              <Button onClick={handleSignupPrompt} size="sm" className="rounded-full">
                <Sparkles className="w-3 h-3 mr-1" />
                {t('hero.tryButton')}
              </Button>
            )}
            {result.status === 'taken' && (
              <Button variant="ghost" size="sm">
                {t('search.viewProfile')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Recently Acquired Fanmarks */}
      {!searchQuery && recentFanmarks.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">
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
                        <div className="text-sm text-muted-foreground">
                          fanmark.id/e/{fanmark.short_id}
                        </div>
                        {fanmark.owner && (
                          <div className="text-xs text-muted-foreground">
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
      <div className="text-center text-sm text-muted-foreground">
        {t('search.joinThousands')}
      </div>
    </div>
  );
}