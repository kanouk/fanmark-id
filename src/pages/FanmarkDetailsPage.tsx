import { useParams, Navigate } from 'react-router-dom';
import { useFanmarkDetails } from '@/hooks/useFanmarkDetails';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, Calendar, User, Clock, ExternalLink, History } from 'lucide-react';
import { format } from 'date-fns';
import { ja, enUS } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';
import { encodeEmojiForUrl } from '@/utils/emojiUrl';

export default function FanmarkDetailsPage() {
  const { shortId } = useParams<{ shortId: string }>();
  const { details, loading, error, toggleFavorite } = useFanmarkDetails(shortId);
  const { user } = useAuth();
  const { t, language } = useTranslation();

  if (!shortId) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="space-y-6">
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Card className="text-center">
          <CardContent className="pt-6">
            <h1 className="text-2xl font-bold mb-4">
              {error || t('fanmarkDetails.notFound')}
            </h1>
            <p className="text-muted-foreground mb-4">
              {t('fanmarkDetails.notFoundDescription')}
            </p>
            <Button onClick={() => window.history.back()}>
              {t('common.goBack')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'PPP', {
      locale: language === 'ja' ? ja : enUS,
    });
  };

  const formatDateTime = (dateString: string) => {
    return format(new Date(dateString), 'PPP p', {
      locale: language === 'ja' ? ja : enUS,
    });
  };

  const highlightCards = [
    {
      label: t('fanmarkDetails.currentStatus'),
      value: details.is_currently_active ? t('fanmarkDetails.active') : t('fanmarkDetails.available'),
      helper: details.is_currently_active
        ? (details.current_license_end
            ? `${t('fanmarkDetails.licenseEnds')}: ${formatDate(details.current_license_end)}`
            : t('fanmarkDetails.notScheduled'))
        : undefined,
      icon: Clock,
      tone: details.is_currently_active
        ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600'
        : 'border-muted-foreground/20 bg-muted/40 text-muted-foreground',
    },
    {
      label: t('fanmarkDetails.currentHolder'),
      value: details.current_owner_display_name
        ? details.current_owner_display_name
        : details.current_owner_username
          ? `@${details.current_owner_username}`
          : t('fanmarkDetails.available'),
      helper: details.current_owner_display_name && details.current_owner_username
        ? `@${details.current_owner_username}`
        : undefined,
      icon: User,
      tone: (details.current_owner_display_name || details.current_owner_username)
        ? 'border-primary/30 bg-primary/10 text-primary'
        : 'border-muted-foreground/20 bg-muted/40 text-muted-foreground',
    },
    {
      label: t('fanmarkDetails.licenseEnds'),
      value: details.current_license_end ? formatDate(details.current_license_end) : t('fanmarkDetails.notScheduled'),
      helper: details.current_license_start ? `${t('fanmarkDetails.started')}: ${formatDate(details.current_license_start)}` : undefined,
      icon: Calendar,
      tone: 'border-purple-500/20 bg-purple-500/10 text-purple-600',
    },
    {
      label: t('fanmarkDetails.firstAcquisition'),
      value: details.first_acquired_date ? formatDate(details.first_acquired_date) : t('fanmarkDetails.neverAcquiredShort'),
      helper: details.first_owner_display_name ? `${t('fanmarkDetails.firstOwner')}: ${details.first_owner_display_name}` : undefined,
      icon: History,
      tone: 'border-amber-500/20 bg-amber-500/10 text-amber-600',
    },
  ];

  const licenseStatusMeta = (status: string) => {
    const normalized = status?.toLowerCase?.() ?? '';
    switch (normalized) {
      case 'active':
        return {
          label: t('fanmarkDetails.active'),
          className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600',
        };
      case 'grace':
      case 'grace_period':
        return {
          label: t('fanmarkDetails.statusGrace'),
          className: 'border-amber-500/25 bg-amber-500/10 text-amber-600',
        };
      case 'expired':
        return {
          label: t('fanmarkDetails.statusExpired'),
          className: 'border-rose-500/25 bg-rose-500/10 text-rose-600',
        };
      case 'upcoming':
      case 'scheduled':
        return {
          label: t('fanmarkDetails.statusUpcoming'),
          className: 'border-sky-500/25 bg-sky-500/10 text-sky-600',
        };
      case 'inactive':
        return {
          label: t('fanmarkDetails.statusInactive'),
          className: 'border-muted-foreground/25 bg-muted/30 text-muted-foreground',
        };
      default:
        return {
          label: t('fanmarkDetails.statusUnknown', { status }),
          className: 'border-muted-foreground/20 bg-muted/40 text-muted-foreground',
        };
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-[32px] border border-primary/10 bg-card/80 p-8 text-center shadow-xl ring-1 ring-primary/5 sm:p-12">
          <div className="flex flex-col items-center gap-6">
            <div className="flex h-28 w-28 items-center justify-center rounded-[2.75rem] border border-primary/20 bg-primary/10 text-6xl shadow-inner md:h-32 md:w-32 md:text-7xl">
              {details.emoji_combination}
            </div>
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.32em] text-primary/70">
                {t('fanmarkDetails.shortId')}
                <span className="text-xs tracking-normal text-foreground">{details.short_id}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('fanmarkDetails.createdAt', { date: formatDate(details.fanmark_created_at) })}
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
              {user && (
                <Button
                  variant={details.is_favorited ? 'default' : 'outline'}
                  onClick={toggleFavorite}
                  className={`gap-2 sm:w-auto ${details.is_favorited ? 'bg-primary text-primary-foreground' : ''}`}
                >
                  <Heart className={`h-4 w-4 ${details.is_favorited ? 'fill-current' : ''}`} />
                  {details.is_favorited ? t('fanmarkDetails.unfavorite') : t('fanmarkDetails.favorite')}
                </Button>
              )}
              <Button
                variant="secondary"
                asChild
                className="gap-2 sm:w-auto"
              >
                <a href={`/${encodeEmojiForUrl(details.emoji_combination)}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  {t('fanmarkDetails.visitPage')}
                </a>
              </Button>
              <Button variant="outline" onClick={() => window.history.back()} className="sm:w-auto">
                {t('common.goBack')}
              </Button>
            </div>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {highlightCards.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="rounded-2xl border border-primary/10 bg-background/80 p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-primary/70">
                      {item.label}
                    </span>
                    <span className={`flex h-10 w-10 items-center justify-center rounded-full border ${item.tone}`}>
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                  </div>
                  <p className="mt-3 text-lg font-semibold text-foreground">{item.value}</p>
                  {item.helper && (
                    <p className="mt-1 text-xs text-muted-foreground">{item.helper}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card className="border border-primary/10 bg-card/80 shadow-sm">
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Clock className="h-5 w-5" />
                {t('fanmarkDetails.currentStatus')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Badge
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${details.is_currently_active ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-muted-foreground/30 bg-muted/40 text-muted-foreground'}`}
              >
                {details.is_currently_active ? t('fanmarkDetails.active') : t('fanmarkDetails.available')}
              </Badge>

              <dl className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">{t('fanmarkDetails.owner')}</dt>
                  <dd className="text-right text-foreground">
                    {details.current_owner_display_name ? (
                      <div className="space-y-1">
                        <span className="font-medium text-foreground">{details.current_owner_display_name}</span>
                        {details.current_owner_username && (
                          <span className="block text-xs text-muted-foreground">@{details.current_owner_username}</span>
                        )}
                      </div>
                    ) : details.current_owner_username ? (
                      <span className="font-medium text-foreground">@{details.current_owner_username}</span>
                    ) : (
                      <span className="text-muted-foreground">{t('fanmarkDetails.available')}</span>
                    )}
                  </dd>
                </div>

                {details.current_license_start && (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">{t('fanmarkDetails.started')}</dt>
                    <dd className="text-right text-foreground">{formatDateTime(details.current_license_start)}</dd>
                  </div>
                )}

                {details.current_license_end && (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">{t('fanmarkDetails.expiresOn')}</dt>
                    <dd className="text-right text-foreground">{formatDateTime(details.current_license_end)}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card className="border border-primary/10 bg-card/80 shadow-sm">
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Calendar className="h-5 w-5" />
                {t('fanmarkDetails.firstAcquisition')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {details.first_acquired_date ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">{t('fanmarkDetails.date')}</span>
                    <span className="text-right font-medium text-foreground">{formatDate(details.first_acquired_date)}</span>
                  </div>
                  {details.first_owner_display_name && (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-muted-foreground">{t('fanmarkDetails.firstOwner')}</span>
                      <span className="text-right font-medium text-foreground">{details.first_owner_display_name}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-primary/20 bg-muted/40 p-5 text-sm text-muted-foreground">
                  {t('fanmarkDetails.neverAcquired')}
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="mt-8">
          <Card className="border border-primary/10 bg-card/80 shadow-sm">
            <CardHeader className="space-y-1">
              <CardTitle className="text-lg font-semibold text-foreground">
                {t('fanmarkDetails.licenseHistory')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {details.license_history && details.license_history.length > 0 ? (
                <ul className="space-y-4">
                  {details.license_history.map((item, index) => {
                    const meta = licenseStatusMeta(item.status);
                    return (
                      <li
                        key={`${item.license_start}-${index}`}
                        className="rounded-2xl border border-primary/10 bg-background/70 p-5 shadow-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${meta.className}`}>
                              {meta.label}
                            </span>
                            {item.is_initial_license && (
                              <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                                {t('fanmarkDetails.initial')}
                              </span>
                            )}
                          </div>
                          {(item.display_name || item.username) && (
                            <span className="text-sm font-medium text-foreground">
                              {item.display_name || `@${item.username}`}
                            </span>
                          )}
                        </div>

                        <dl className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                          <div>
                            <dt>{t('fanmarkDetails.started')}</dt>
                            <dd className="font-medium text-foreground">{formatDateTime(item.license_start)}</dd>
                          </div>
                          <div>
                            <dt>{t('fanmarkDetails.expires')}</dt>
                            <dd className="font-medium text-foreground">{formatDateTime(item.license_end)}</dd>
                          </div>
                        </dl>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-2xl border border-dashed border-primary/20 bg-muted/40 p-6 text-sm text-muted-foreground">
                  {t('fanmarkDetails.noHistory')}
                </p>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
