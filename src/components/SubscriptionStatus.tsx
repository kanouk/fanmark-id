import { useSubscription } from '@/hooks/useSubscription';
import { useTranslation } from '@/hooks/useTranslation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export const SubscriptionStatus = () => {
  const { subscribed, product_id, subscription_end, loading, error, refetch } = useSubscription();
  const { t } = useTranslation();

  if (loading && !subscribed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('subscription.title')}</CardTitle>
          <CardDescription>{t('subscription.loading')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('subscription.title')}</CardTitle>
            <CardDescription>{t('subscription.description')}</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refetch}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t('subscriptionStatusLabel')}</span>
            <Badge variant={subscribed ? "default" : "secondary"}>
              {subscribed ? t('subscription.active') : t('subscription.inactive')}
            </Badge>
          </div>

          {product_id && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('subscription.productId')}</span>
              <span className="text-sm font-mono">{product_id}</span>
            </div>
          )}

          {subscription_end && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t('subscription.nextUpdate')}</span>
              <span className="text-sm">
                {new Date(subscription_end).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
          )}

          {!subscribed && (
            <p className="text-sm text-muted-foreground">
              {t('subscription.noActive')}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
