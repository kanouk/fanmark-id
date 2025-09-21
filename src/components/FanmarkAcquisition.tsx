import { useState, useEffect } from 'react';
import { useFanmarkSearch, FanmarkSearchResult } from '@/hooks/useFanmarkSearch';
import { FanmarkQuickRegistration } from '@/components/FanmarkQuickRegistration';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmojiInput } from '@/components/EmojiInput';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, CheckCircle, Eye, Clock, Lock } from 'lucide-react';
import { FiTrendingUp, FiAlertTriangle, FiInfo, FiStar } from 'react-icons/fi';

interface FanmarkAcquisitionProps {
  prefilledEmoji?: string;
  onSuccess?: () => void;
}

export const FanmarkAcquisition = ({ prefilledEmoji, onSuccess }: FanmarkAcquisitionProps) => {
  const { t } = useTranslation();
  const { 
    searchQuery, 
    setSearchQuery, 
    result, 
    loading, 
    recentFanmarks, 
    checkAvailability, 
    registerFanmark,
    refetchRecent 
  } = useFanmarkSearch();
  
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState('');

  // Set prefilled emoji if provided
  useEffect(() => {
    if (prefilledEmoji) {
      setSearchQuery(prefilledEmoji);
    }
  }, [prefilledEmoji, setSearchQuery]);

  const handleEmojiClick = (emoji: string) => {
    setSearchQuery(emoji);
  };

  const handleRegisterClick = (emoji: string) => {
    setSelectedEmoji(emoji);
    setShowRegistrationForm(true);
  };

  const handleRegistrationSuccess = () => {
    setShowRegistrationForm(false);
    setSelectedEmoji('');
    refetchRecent();
    onSuccess?.();
  };

  type NormalizedStatus = 'available' | 'taken' | 'unavailable';

  const normalizeStatus = (status: FanmarkSearchResult['status']): NormalizedStatus => {
    if (status === 'available' || status === 'payment_required') {
      return 'available';
    }
    if (status === 'taken' || status === 'premium') {
      return 'taken';
    }
    return 'unavailable';
  };

  const getResultIcon = () => {
    if (!result) return null;
    const normalized = normalizeStatus(result.status);

    switch (normalized) {
      case 'available':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'taken':
        return <Eye className="h-5 w-5 text-blue-500" />;
      case 'unavailable':
        return <Lock className="h-5 w-5 text-rose-500" />;
      default:
        return <Clock className="h-5 w-5 text-gray-500" />;
    }
  };

  const getResultBadge = () => {
    if (!result) return null;

    const normalized = normalizeStatus(result.status);
    const badgeConfig = {
      available: { text: t('search.available'), className: 'bg-green-100 text-green-800' },
      taken: { text: t('search.taken'), className: 'bg-blue-100 text-blue-800' },
      unavailable: { text: t('search.unavailable'), className: 'bg-rose-100 text-rose-800' },
    } as const;

    const config = badgeConfig[normalized];

    return (
      <Badge className={`${config.className} flex items-center gap-1`}>
        {getResultIcon()}
        <span>{config.text}</span>
      </Badge>
    );
  };

  if (showRegistrationForm) {
    return (
      <div className="space-y-6">
        <div className="mb-4 flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowRegistrationForm(false)}
          >
            ← {t('common.back')}
          </Button>
          <h3 className="text-lg font-semibold">{t('dashboard.getFanmaTitle')}</h3>
        </div>
        <FanmarkQuickRegistration
          prefilledEmoji={selectedEmoji}
          onSuccess={handleRegistrationSuccess}
          onCancel={() => setShowRegistrationForm(false)}
        />
      </div>
    );
  }

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
            <div className={`rounded-2xl border p-4 ${result.status === 'invalid' ? 'border-rose-200 bg-rose-50' : 'border-primary/10 bg-muted/40'}`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{result.emoji_combination}</span>
                  {getResultBadge()}
                </div>
                {result.status === 'available' && (
                  <Button
                    onClick={() => handleRegisterClick(result.emoji_combination)}
                    className="flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow hover:bg-primary/90"
                  >
                    <FiStar className="h-4 w-4" />
                    {t('search.register')}
                  </Button>
                )}
                {result.status === 'payment_required' && (
                  <div className="text-right">
                    <div className="mb-1 text-sm text-muted-foreground">
                      {t('search.price')}: ${result.price_usd}
                    </div>
                    <Button
                      onClick={() => handleRegisterClick(result.emoji_combination)}
                      variant="outline"
                      className="flex items-center gap-2 rounded-full border-orange-300 text-orange-700 hover:bg-orange-50"
                    >
                      <FiStar className="h-4 w-4" />
                      {t('search.registerPremium')}
                    </Button>
                  </div>
                )}
              </div>

              {result.status === 'taken' && result.owner && (
                <p className="text-sm text-gray-600">
                  {t('search.ownedBy')}: {result.owner.display_name || result.owner.username}
                </p>
              )}

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

      {/* Recent fanma */}
      <Card className="rounded-3xl border border-primary/10 bg-background/80 shadow-[0_15px_30px_rgba(101,195,200,0.1)]">
        <CardHeader className="space-y-2 px-6 pt-6 pb-2">
          <CardTitle className="flex items-center gap-2">
            <FiTrendingUp className="h-5 w-5 text-primary" />
            {t('dashboard.recentFanmaTitle')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('dashboard.recentFanmaSubtitle')}
          </p>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {recentFanmarks.map((fanmark) => (
              <button
                key={fanmark.id}
                onClick={() => handleEmojiClick(fanmark.emoji_combination)}
                className="group rounded-2xl border border-primary/10 bg-background/70 p-3 text-center transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                <div className="mb-1 text-2xl transition-transform group-hover:scale-110">
                  {fanmark.emoji_combination}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {fanmark.owner?.display_name || fanmark.owner?.username || t('search.anonymous')}
                </div>
              </button>
            ))}
          </div>
          {recentFanmarks.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              <FiStar className="mx-auto mb-2 h-8 w-8" />
              <p>{t('search.noRecentFanmaYet')}</p>
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
