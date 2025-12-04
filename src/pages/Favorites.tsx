import { Navigate, useNavigate } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { ja, enUS } from 'date-fns/locale';
import { AppHeader } from '@/components/layout/AppHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ExternalLink, Sparkles } from 'lucide-react';
import { useFavoriteFanmarks } from '@/hooks/useFavoriteFanmarks';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { segmentEmojiSequence } from '@/lib/emojiConversion';
import { FiHeart } from 'react-icons/fi';

const ACCESS_TYPE_LABEL_KEY: Record<string, string> = {
  profile: 'dashboard.accessTypes.profile',
  redirect: 'dashboard.accessTypes.redirect',
  text: 'dashboard.accessTypes.text',
  inactive: 'dashboard.accessTypes.inactive',
};

const FavoriteSkeleton = () => (
  <Card className="rounded-3xl border border-primary/10 bg-background/80 shadow-[0_20px_45px_rgba(101,195,200,0.14)]">
    <CardHeader className="px-6 pt-6 pb-2">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </CardHeader>
    <CardContent className="space-y-4 px-6 pb-6">
      <Skeleton className="h-12 w-full rounded-2xl" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-48" />
    </CardContent>
  </Card>
);

export default function Favorites() {
  const { user, loading: authLoading } = useAuth();
  const { t, language } = useTranslation();
  const { favorites, isLoading, isError, refetch } = useFavoriteFanmarks({
    enabled: !authLoading && Boolean(user),
  });
  const navigate = useNavigate();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const formatDate = (isoString: string) => {
    try {
      return formatInTimeZone(isoString, 'Asia/Tokyo', 'PPP', {
        locale: language === 'ja' ? ja : enUS,
      });
    } catch {
      return '—';
    }
  };

const getAccessTypeLabel = (t: (key: string, ...args: any[]) => string, accessType: string | null, isRegistered: boolean) => {
  if (!isRegistered || !accessType) {
    return t('favorites.unclaimedBadge');
  }
  const key = ACCESS_TYPE_LABEL_KEY[accessType] ?? ACCESS_TYPE_LABEL_KEY.inactive;
  return t(key);
};

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="space-y-3 text-center">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              {t('favorites.title')}
            </h1>
            <p className="mx-auto max-w-2xl text-sm sm:text-base text-muted-foreground">
              {t('favorites.subtitle')}
            </p>
          </div>

          {isError && (
            <div className="mt-8 rounded-3xl border border-destructive/20 bg-destructive/10 p-6 text-center text-sm text-destructive">
              <p>{t('favorites.loadError')}</p>
              <Button variant="outline" size="sm" className="mt-4 rounded-full" onClick={() => refetch()}>
                {t('common.tryAgain')}
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <FavoriteSkeleton key={`favorite-skeleton-${index}`} />
              ))}
            </div>
          ) : favorites.length === 0 ? (
            <div className="mt-12">
              <Card className="rounded-3xl border border-primary/15 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur">
                <CardContent className="px-6 py-12 text-center space-y-6">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FiHeart className="h-6 w-6" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold text-foreground">
                      {t('favorites.title')}
                    </h2>
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('favorites.emptyTitle')}
                  </p>
                  <Button
                    onClick={() => (window.location.href = '/')}
                    className="mx-auto rounded-full bg-primary text-primary-foreground shadow-md hover:shadow-lg px-5"
                    size="default"
                  >
                    {t('favorites.exploreFanmarks')}
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {favorites.map((favorite) => {
                const statusInfo = (() => {
                  const currentStatus = favorite.currentLicenseStatus?.toLowerCase() ?? null;
                  const availability = favorite.availabilityStatus?.toLowerCase() ?? null;

                  if (!favorite.fanmarkId || availability === 'unclaimed' || currentStatus === 'expired') {
                    return {
                      type: 'available' as const,
                      className: 'border-emerald-200 bg-emerald-50 text-emerald-600',
                      label: t('favorites.statusAvailable', { defaultValue: language === 'ja' ? '取得可能' : 'Available' }),
                    };
                  }

                  if (currentStatus === 'grace' || currentStatus === 'grace-return') {
                    return {
                      type: 'processing' as const,
                      className: 'border-amber-200 bg-amber-50 text-amber-600',
                      label: t('favorites.statusReturnProcessing', { defaultValue: language === 'ja' ? '返却処理中（まもなく取得のチャンス！）' : 'Being returned (opportunity coming soon)' }),
                    };
                  }

                  return {
                    type: 'unavailable' as const,
                      className: 'border-muted-foreground/20 bg-muted/40 text-muted-foreground',
                    label: t('favorites.statusUnavailable', { defaultValue: language === 'ja' ? '取得不可' : 'Unavailable' }),
                  };
                })();

                const emojiSegments = segmentEmojiSequence(favorite.fanmark);
                const currentStatus = favorite.currentLicenseStatus?.toLowerCase?.() ?? null;
                const availability = favorite.availabilityStatus?.toLowerCase?.() ?? null;
                const isRegistered = Boolean(favorite.fanmarkId);
                const isReturnedOrUnclaimed =
                  !isRegistered ||
                  statusInfo.type === 'available' ||
                  availability === 'unclaimed' ||
                  currentStatus === 'expired' ||
                  currentStatus === 'returned';

                const ownerLabel = isReturnedOrUnclaimed
                  ? t('favorites.ownerNotAssigned')
                  : favorite.currentOwnerDisplayName ||
                    (favorite.currentOwnerUsername ? `@${favorite.currentOwnerUsername}` : t('favorites.ownerUnknown'));

                const accessLabel = getAccessTypeLabel(t, favorite.accessType, isRegistered);
                const isAcquirable = statusInfo.type === 'available';
                const detailDisabled = !favorite.shortId || !favorite.fanmarkId;

                return (
                  <Card
                    key={favorite.favoriteId}
                    className="flex h-full flex-col rounded-3xl border border-primary/10 bg-background/80 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur card-pop"
                  >
                    <CardHeader className="flex items-center justify-end px-6 pt-6 pb-0">
                      <Badge className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${statusInfo.className}`}>
                        {statusInfo.label}
                      </Badge>
                    </CardHeader>

                    <CardContent className="flex flex-1 flex-col gap-4 px-6 pb-6 pt-4 text-sm text-muted-foreground">
                      <div className="flex flex-wrap items-center justify-start gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-3 text-3xl">
                        {emojiSegments.map((segment, index) => (
                          <span key={`${segment}-${index}`} className="select-none">
                            {segment}
                          </span>
                        ))}
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">{t('favorites.favoritedAt')}</span>
                          <span className="font-medium text-foreground">{formatDate(favorite.favoritedAt)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">{t('favorites.owner')}</span>
                          <span className="font-medium text-foreground">{ownerLabel}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2">
                        <Button
                          className="rounded-full px-5"
                          disabled={!isAcquirable}
                          onClick={() => {
                            try {
                              localStorage.setItem('fanmark.prefill', favorite.fanmark);
                            } catch (error) {
                              console.warn('Failed to persist fanmark prefill:', error);
                            }
                            navigate('/', { state: { prefillFanmark: favorite.fanmark, scrollToSearch: true } });
                          }}
                        >
                          {t('favorites.acquireButton')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 rounded-full border border-primary/15 bg-background/80 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                          onClick={() => {
                            if (detailDisabled || !favorite.shortId) return;
                            navigate(`/f/${favorite.shortId}`);
                          }}
                          disabled={detailDisabled}
                          aria-label={t('favorites.viewDetails')}
                        >
                          <Sparkles className="h-5 w-5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-10 rounded-full border border-primary/15 bg-background/80 text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                          onClick={() => {
                            if (!favorite.shortId) return;
                            navigate(`/a/${favorite.shortId}`);
                          }}
                          disabled={!favorite.shortId}
                          aria-label={t('dashboard.visitFanmarkButton')}
                        >
                          <ExternalLink className="h-5 w-5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
