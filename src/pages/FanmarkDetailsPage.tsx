import { useParams, Navigate } from 'react-router-dom';
import { useFanmarkDetails } from '@/hooks/useFanmarkDetails';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Heart, Calendar, User, Clock, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { ja, enUS } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';

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

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <Card className="mb-6 bg-gradient-to-r from-primary/10 to-accent/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="text-6xl">{details.emoji_combination}</div>
              <div>
                <CardTitle className="text-3xl">
                  {details.emoji_combination}
                </CardTitle>
                <p className="text-muted-foreground">
                  ID: {details.short_id}
                </p>
              </div>
            </div>
            {user && (
              <Button
                variant="outline"
                size="sm"
                onClick={toggleFavorite}
                className={`gap-2 ${details.is_favorited ? 'text-red-500 border-red-500' : ''}`}
              >
                <Heart 
                  className={`w-4 h-4 ${details.is_favorited ? 'fill-current' : ''}`}
                />
                {details.is_favorited ? t('fanmarkDetails.unfavorite') : t('fanmarkDetails.favorite')}
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 md:grid-cols-2 mb-6">
        {/* Current Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              {t('fanmarkDetails.currentStatus')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={details.is_currently_active ? 'default' : 'secondary'}>
                {details.is_currently_active ? t('fanmarkDetails.active') : t('fanmarkDetails.available')}
              </Badge>
            </div>
            
            {details.is_currently_active && details.current_owner_display_name && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <User className="w-4 h-4" />
                  <span className="font-medium">{t('fanmarkDetails.owner')}:</span>
                  <span>{details.current_owner_display_name}</span>
                </div>
                {details.current_license_end && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="w-4 h-4" />
                    <span className="font-medium">{t('fanmarkDetails.expiresOn')}:</span>
                    <span>{formatDate(details.current_license_end)}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* First Acquisition */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              {t('fanmarkDetails.firstAcquisition')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {details.first_acquired_date ? (
              <>
                <div className="text-sm">
                  <span className="font-medium">{t('fanmarkDetails.date')}:</span>
                  <span className="ml-2">{formatDate(details.first_acquired_date)}</span>
                </div>
                {details.first_owner_display_name && (
                  <div className="text-sm">
                    <span className="font-medium">{t('fanmarkDetails.firstOwner')}:</span>
                    <span className="ml-2">{details.first_owner_display_name}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t('fanmarkDetails.neverAcquired')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* License History */}
      <Card>
        <CardHeader>
          <CardTitle>{t('fanmarkDetails.licenseHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          {details.license_history && details.license_history.length > 0 ? (
            <div className="space-y-4">
              {details.license_history.map((item, index) => (
                <div 
                  key={index}
                  className="border rounded-lg p-4 bg-muted/30"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={item.status === 'active' ? 'default' : 'secondary'}>
                        {item.status}
                      </Badge>
                      {item.is_initial_license && (
                        <Badge variant="outline">
                          {t('fanmarkDetails.initial')}
                        </Badge>
                      )}
                    </div>
                    {item.display_name && (
                      <span className="font-medium">{item.display_name}</span>
                    )}
                  </div>
                  
                  <div className="grid gap-2 text-sm text-muted-foreground">
                    <div>
                      <span className="font-medium">{t('fanmarkDetails.started')}:</span>
                      <span className="ml-2">{formatDateTime(item.license_start)}</span>
                    </div>
                    <div>
                      <span className="font-medium">{t('fanmarkDetails.expires')}:</span>
                      <span className="ml-2">{formatDateTime(item.license_end)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">
              {t('fanmarkDetails.noHistory')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="mt-6 flex gap-4">
        <Button variant="outline" onClick={() => window.history.back()}>
          {t('common.goBack')}
        </Button>
        
        <Button asChild>
          <a href={`/${details.short_id}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 mr-2" />
            {t('fanmarkDetails.visitPage')}
          </a>
        </Button>
      </div>
    </div>
  );
}