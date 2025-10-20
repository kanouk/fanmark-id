import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { Navigation } from '@/components/Navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Bell, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface Notification {
  id: string;
  payload: any;
  read_at: string | null;
  triggered_at: string;
  priority: number;
  channel: string;
}

export default function Notifications() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchNotifications = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('triggered_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching notifications:', error);
        toast.error('通知の取得に失敗しました');
      } else {
        setNotifications(data || []);
      }
      setLoading(false);
    };

    fetchNotifications();

    // Realtime subscription
    const channel = supabase
      .channel('notifications-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const markAsRead = async (notificationId: string) => {
    const { error } = await supabase.rpc('mark_notification_read', {
      notification_id_param: notificationId,
      read_via_param: 'app'
    });

    if (error) {
      console.error('Error marking notification as read:', error);
      toast.error('既読にできませんでした');
    } else {
      toast.success('既読にしました');
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <Navigation />
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="flex items-center gap-3">
            <Bell className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">通知</h1>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : notifications.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                通知はありません
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {notifications.map((notification) => (
                <Card 
                  key={notification.id}
                  className={notification.read_at ? 'opacity-60' : 'border-primary/20'}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <CardTitle className="text-lg">
                          {notification.payload.title || '通知'}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {formatDistanceToNow(new Date(notification.triggered_at), {
                            addSuffix: true,
                            locale: ja,
                          })}
                        </CardDescription>
                      </div>
                      {!notification.read_at && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markAsRead(notification.id)}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{notification.payload.body}</p>
                    {notification.payload.summary && (
                      <p className="text-xs text-muted-foreground mt-2">
                        {notification.payload.summary}
                      </p>
                    )}
                    <div className="flex gap-2 mt-4">
                      <Badge variant="outline" className="text-xs">
                        {notification.channel}
                      </Badge>
                      {!notification.read_at && (
                        <Badge variant="default" className="text-xs">
                          未読
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
