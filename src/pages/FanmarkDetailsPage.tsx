import { useParams, Navigate } from 'react-router-dom';
import { useFanmarkDetails } from '@/hooks/useFanmarkDetails';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Navigation } from '@/components/Navigation';
import { Heart, Calendar, User, Clock, ExternalLink, History } from 'lucide-react';
import { ja, enUS } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import { parseDateString } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { encodeEmojiForUrl, splitEmojiGraphemes } from '@/utils/emojiUrl';

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

  const formatDate = (dateString?: string | null): string => {
    if (!dateString) return '—';
    const parsed = parseDateString(dateString);
    if (!parsed) return '—';
    return formatInTimeZone(parsed, 'Asia/Tokyo', 'PPP', {
      locale: language === 'ja' ? ja : enUS,
    });
  };

  const licenseStatusMeta = (status: string, isReturned?: boolean) => {
    const normalized = status?.toLowerCase?.() ?? '';
    switch (normalized) {
      case 'active':
        return {
          label: t('fanmarkDetails.active'),
          className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600',
        };
      case 'grace':
      case 'grace_period':
        {
          const isReturnProcessing = Boolean(isReturned);
          return {
            label: isReturnProcessing
              ? t('fanmarkDetails.statusReturnProcessing')
              : t('fanmarkDetails.statusGrace'),
            className: 'border-amber-500/25 bg-amber-500/10 text-amber-600',
          };
        }
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

  const formatDateTime = (dateString?: string | null): string => {
    if (!dateString) return '—';
    const parsed = parseDateString(dateString);
    if (!parsed) return '—';
    return formatInTimeZone(parsed, 'Asia/Tokyo', 'PPP p', {
      locale: language === 'ja' ? ja : enUS,
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-background to-muted/40">
      <Navigation />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
          <section className="p-6 text-center sm:p-10">
          <div className="flex flex-col items-center gap-6">
            <div className="flex flex-wrap items-center justify-center gap-3 rounded-[2.75rem] border border-primary/20 bg-primary/10 px-8 py-6 text-5xl shadow-inner md:px-10 md:py-7 md:text-6xl">
              {splitEmojiGraphemes(details.emoji_combination).map((segment, index) => (
                <span key={`${segment}-${index}`} className="inline-flex min-w-[2.4rem] justify-center">
                  {segment}
                </span>
              ))}
            </div>
            <Badge className="rounded-full border border-border/50 bg-muted/60 px-3 py-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground">
              {details.short_id}
            </Badge>
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
              <Button variant="secondary" asChild className="gap-2 sm:w-auto">
                <a href={`/${encodeEmojiForUrl(details.emoji_combination)}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  {t('fanmarkDetails.visitPage')}
                </a>
              </Button>
            </div>
          </div>
          </section>
          <section className="mt-10">
          <Card className="border border-primary/10 bg-muted/40 backdrop-blur rounded-3xl">
            <CardHeader className="px-6 pt-6 pb-2">
              <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                <Calendar className="h-5 w-5" />
                {t('fanmarkDetails.ownershipHistory')}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto px-6 pb-6">
              {details.license_history && details.license_history.length > 0 ? (
                <table className="mt-3 min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">
                        {t('fanmarkDetails.started')}
                      </th>
                      <th className="px-4 py-3 text-left font-semibold">
                        {t('fanmarkDetails.expires')}
                      </th>
                      <th className="px-4 py-3 text-left font-semibold">
                        {t('fanmarkDetails.statusColumn')}
                      </th>
                      <th className="px-4 py-3 text-left font-semibold">
                        {t('fanmarkDetails.owner')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {details.license_history.map((item, index) => {
                      const holder = item.display_name || (item.username ? `@${item.username}` : '—');
                      const statusMeta = licenseStatusMeta(item.status, item.is_returned);
                      return (
                        <tr key={`${item.license_start}-${index}`} className="bg-background">
                          <td className="px-4 py-3 text-foreground">{formatDateTime(item.license_start)}</td>
                          <td className="px-4 py-3 text-foreground">
                            {formatDateTime(item.license_end)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${statusMeta.className}`}>
                              <span>{statusMeta.label}</span>
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-foreground">{holder}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="rounded-2xl border border-dashed border-primary/20 bg-muted/40 p-6 text-sm text-muted-foreground">
                  {t('fanmarkDetails.noHistory')}
                </p>
              )}
            </CardContent>
          </Card>
          </section>
        </div>
      </main>
      <footer className="border-t border-border/40 bg-background/80 backdrop-blur">
        <div className="container mx-auto px-4 py-10 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
            <span className="text-3xl">✨</span> <span className="text-gradient">fanmark.id</span>
          </div>
          <p className="text-sm text-muted-foreground">{t('sections.footer')}</p>
        </div>
      </footer>
    </div>
  );
}
