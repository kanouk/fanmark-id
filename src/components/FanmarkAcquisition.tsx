import { useState, useEffect } from 'react';
import { useFanmarkSearch } from '@/hooks/useFanmarkSearch';
import { FanmarkQuickRegistration } from '@/components/FanmarkQuickRegistration';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmojiInput } from '@/components/EmojiInput';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, CheckCircle, XCircle, Clock, CreditCard } from 'lucide-react';

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

  const getResultIcon = () => {
    if (!result) return null;
    
    switch (result.status) {
      case 'available':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'taken':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'premium':
        return <CreditCard className="h-5 w-5 text-yellow-500" />;
      case 'payment_required':
        return <CreditCard className="h-5 w-5 text-orange-500" />;
      case 'invalid':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <Clock className="h-5 w-5 text-gray-500" />;
    }
  };

  const getResultBadge = () => {
    if (!result) return null;

    const badgeConfig = {
      available: { text: t('search.available'), className: 'bg-green-100 text-green-800' },
      taken: { text: t('search.taken'), className: 'bg-red-100 text-red-800' },
      premium: { text: t('search.premium'), className: 'bg-yellow-100 text-yellow-800' },
      payment_required: { text: t('search.paymentRequired'), className: 'bg-orange-100 text-orange-800' },
      invalid: { text: t('search.invalid'), className: 'bg-gray-100 text-gray-800' },
    };

    const config = badgeConfig[result.status as keyof typeof badgeConfig];
    if (!config) return null;

    return (
      <Badge className={config.className}>
        {getResultIcon()}
        <span className="ml-1">{config.text}</span>
      </Badge>
    );
  };

  if (showRegistrationForm) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setShowRegistrationForm(false)}
          >
            ← {t('common.back')}
          </Button>
          <h3 className="text-lg font-semibold">ファンマークを取得</h3>
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            {t('dashboard.searchFanmarks')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <EmojiInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={t('search.placeholder')}
              className="text-2xl h-16 text-center"
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
            <div className={`border rounded-lg p-4 ${result.status === 'invalid' ? 'bg-red-50 border-red-200' : 'bg-gray-50'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{result.emoji_combination}</span>
                  {getResultBadge()}
                </div>
                {result.status === 'available' && (
                  <Button
                    onClick={() => handleRegisterClick(result.emoji_combination)}
                    className="bg-gradient-to-r from-pink-400 to-purple-400 hover:from-pink-500 hover:to-purple-500"
                  >
                    {t('search.register')} ✨
                  </Button>
                )}
                {result.status === 'payment_required' && (
                  <div className="text-right">
                    <div className="text-sm text-gray-600 mb-1">
                      {t('search.price')}: ${result.price_usd}
                    </div>
                    <Button
                      onClick={() => handleRegisterClick(result.emoji_combination)}
                      variant="outline"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50"
                    >
                      {t('search.registerPremium')} 💎
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
                <div className="text-sm text-red-600 bg-red-100 p-3 rounded-md">
                  <div className="font-medium mb-1">⚠️ 入力エラー</div>
                  <div>{result.error}</div>
                  <div className="mt-2 text-xs">
                    💡 絵文字のみを1-5個まで入力してください
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Fanmarks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-xl">🔥</span>
            {t('search.recentlyRegistered')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {recentFanmarks.map((fanmark) => (
              <button
                key={fanmark.id}
                onClick={() => handleEmojiClick(fanmark.emoji_combination)}
                className="p-3 border rounded-lg hover:bg-gray-50 transition-colors text-center group"
              >
                <div className="text-2xl mb-1 group-hover:scale-110 transition-transform">
                  {fanmark.emoji_combination}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {fanmark.owner?.display_name || fanmark.owner?.username || t('search.anonymous')}
                </div>
              </button>
            ))}
          </div>
          {recentFanmarks.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">🌟</div>
              <p>{t('search.noRecentFanmarksYet')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tips */}
      <Card>
        <CardContent className="pt-6">
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
              <span>💡</span> {t('dashboard.tips')}
            </h4>
            <ul className="text-sm text-gray-600 space-y-1">
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