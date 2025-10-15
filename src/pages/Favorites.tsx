import { Navigate } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { ja, enUS } from 'date-fns/locale';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useFavoriteFanmarks } from '@/hooks/useFavoriteFanmarks';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { encodeEmojiForUrl } from '@/utils/emojiUrl';
import { segmentEmojiSequence } from '@/lib/emojiConversion';

const ACCESS_TYPE_LABEL_KEY: Record<string, string> = {
  profile: 'dashboard.accessTypes.profile',
  redirect: 'dashboard.accessTypes.redirect',
  text: 'dashboard.accessTypes.text',
  inactive: 'dashboard.accessTypes.inactive',
};

const LicenseStatusBadge = ({
  status,
  isActive,
  label,
}: {
  status: string | null;
  isActive: boolean;
  label: string;
}) => {
  const base =
    status === 'active' && isActive
      ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
      : status === 'grace' || status === 'grace-return'
      ? 'border-amber-200 bg-amber-50 text-amber-600'
      : status === 'expired'
      ? 'border-rose-200 bg-rose-50 text-rose-600'
      : 'border-muted-foreground/20 bg-muted/40 text-muted-foreground';

  return (
    <Badge className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${base}`}>
      {label}
    </Badge>
  );
};

const FavoriteSkeleton = () => (
  <Card className="rounded-3xl border border-primary/10 bg-background/80 shadow-[0_20px_45px_rgba(101,195,200,0.14)]">
    <CardHeader className="px-6 pt-6 pb-2">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </CardHeader>
    <CardContent className="space-y-4 px-6 pb-2">
      <Skeleton className="h-12 w-24 rounded-full" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-48" />
    </CardContent>
    <CardFooter className="flex gap-4 px-6 pb-6">
      <Skeleton className="h-10 w-28 rounded-full" />
      <Skeleton className="h-10 w-28 rounded-full" />
    </CardFooter>
  </Card>
);

export default function Favorites() {
  const { user, loading: authLoading } = useAuth();
  const { t, language } = useTranslation();
  const { favorites, isLoading, isError, refetch } = useFavoriteFanmarks({
    enabled: !authLoading && Boolean(user),
  });

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

  const formatStatusLabel = (status: string | null) => {
    if (!status) return t('favorites.statusUnknown');
    const normalized = status.toLowerCase();
    switch (normalized) {
      case 'active':
        return t('fanmarkDetails.active');
      case 'grace':
        return t('fanmarkDetails.statusGrace');
      case 'grace-return':
        return t('fanmarkDetails.statusReturnProcessing');
      case 'expired':
        return t('fanmarkDetails.statusExpired');
      default:
        return t('fanmarkDetails.statusUnknown', { status });
    }
  };

const getAccessTypeLabel = (t: (key: string, ...args: any[]) => string, accessType: string | null, isRegistered: boolean) => {
  if (!isRegistered || !accessType) {
    return t('favorites.unclaimedBadge');
  }
  const key = ACCESS_TYPE_LABEL_KEY[accessType] ?? ACCESS_TYPE_LABEL_KEY.inactive;
  return t(key);
};

const formatAvailabilityLabel = (t: (key: string, ...args: any[]) => string, availability: string) => {
  switch (availability) {
    case 'unclaimed':
      return t('favorites.statusUnclaimed');
    case 'claimed_external':
      return t('favorites.statusClaimedExternal');
    case 'owned_by_user':
      return t('favorites.statusOwnedByUser');
    default:
      return t('favorites.statusUnknown');
  }
};

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <Navigation />
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
              <Card className="rounded-3xl border border-primary/20 bg-background/80 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur">
                <CardContent className="space-y-4 px-6 py-12 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary text-3xl">
                    ✨
                  </div>
                  <h2 className="text-2xl font-semibold text-foreground">
                    {t('favorites.emptyTitle')}
                  </h2>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    {t('favorites.emptyDescription')}
                  </p>
                  <Button
                    onClick={() => (window.location.href = '/')}
                    className="mt-4 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl"
                  >
                    {t('favorites.exploreFanmarks')}
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {favorites.map((favorite) => {
                const emojiSegments = segmentEmojiSequence(favorite.fanmark);
                const ownerLabel = favorite.fanmarkId
                  ? favorite.currentOwnerDisplayName ||
                    (favorite.currentOwnerUsername ? `@${favorite.currentOwnerUsername}` : t('favorites.ownerUnknown'))
                  : t('favorites.ownerNotAssigned');
                const isRegistered = Boolean(favorite.fanmarkId);
                const accessLabel = getAccessTypeLabel(t, favorite.accessType, isRegistered);
                const statusLabel = isRegistered
                  ? formatStatusLabel(favorite.currentLicenseStatus)
                  : formatAvailabilityLabel(t, favorite.availabilityStatus);

                return (
                  <Card
                    key={favorite.favoriteId}
                    className="flex h-full flex-col justify-between rounded-3xl border border-primary/15 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur transition-transform duration-200 hover:-translate-y-1"
                  >
                    <CardHeader className="px-6 pt-6 pb-2">
                      <CardTitle className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-muted-foreground">
                            {favorite.fanmarkName || favorite.fanmark || t('favorites.untitledFanmark')}
                          </p>
                          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="rounded-full border border-border/50 bg-muted/60 px-2 py-0.5 tracking-wide">
                              {favorite.shortId ?? (favorite.fanmarkId ? favorite.fanmarkId.slice(0, 8) : t('favorites.notRegisteredShort'))}
                            </span>
                            <span>{formatDate(favorite.favoritedAt)}</span>
                          </span>
                        </div>
                        <Badge className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
                          {accessLabel}
                        </Badge>
                      </CardTitle>
                    </CardHeader>

                    <CardContent className="flex flex-1 flex-col gap-4 px-6 pb-4">
                      <div className="flex flex-wrap items-center justify-start gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-3 text-3xl">
                        {emojiSegments.map((segment, index) => (
                          <span key={`${segment}-${index}`} className="px-1">
                            {segment}
                          </span>
                        ))}
                      </div>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <div>
                          <span className="font-medium text-foreground">{t('favorites.ownerLabel')}:</span>{' '}
                          <span>{ownerLabel}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{t('favorites.statusLabel')}:</span>
                          {isRegistered ? (
                            <LicenseStatusBadge
                              status={favorite.currentLicenseStatus}
                              isActive={favorite.currentLicenseStatus === 'active'}
                              label={statusLabel}
                            />
                          ) : (
                            <Badge className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium border-primary/30 bg-primary/10 text-primary">
                              {statusLabel}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>

                    <CardFooter className="flex flex-col gap-3 px-6 pb-6 sm:flex-row sm:items-center sm:justify-between">
                      <Button
                        variant="secondary"
                        className="w-full rounded-full sm:w-auto"
                        disabled={!favorite.shortId}
                        onClick={() => {
                          if (favorite.shortId) {
                            window.location.href = `/f/${favorite.shortId}`;
                          }
                        }}
                      >
                        {t('favorites.viewDetails')}
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full rounded-full sm:w-auto"
                        disabled={!favorite.fanmark}
                        onClick={() => {
                          if (favorite.fanmark) {
                            window.open(`/${encodeEmojiForUrl(favorite.fanmark)}`, '_blank', 'noopener,noreferrer');
                          }
                        }}
                      >
                        {t('favorites.openFanmark')}
                      </Button>
                    </CardFooter>
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
