import { useSubscription } from '@/hooks/useSubscription';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export const SubscriptionStatus = () => {
  const { subscribed, product_id, subscription_end, loading, error, refetch } = useSubscription();

  if (loading && !subscribed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>サブスクリプション状態</CardTitle>
          <CardDescription>読み込み中...</CardDescription>
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
            <CardTitle>サブスクリプション状態</CardTitle>
            <CardDescription>現在のプラン情報</CardDescription>
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
            <span className="text-sm text-muted-foreground">ステータス</span>
            <Badge variant={subscribed ? "default" : "secondary"}>
              {subscribed ? '有効' : '無効'}
            </Badge>
          </div>

          {product_id && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">プロダクトID</span>
              <span className="text-sm font-mono">{product_id}</span>
            </div>
          )}

          {subscription_end && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">次回更新日</span>
              <span className="text-sm">
                {new Date(subscription_end).toLocaleDateString('ja-JP', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
          )}

          {!subscribed && (
            <p className="text-sm text-muted-foreground">
              現在、有効なサブスクリプションはありません
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
