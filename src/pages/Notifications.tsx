import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { supabase } from '@/integrations/supabase/client';
import { AppHeader } from '@/components/layout/AppHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Bell, Check, Link2 } from 'lucide-react';
import { useNotificationFormatter } from '@/hooks/useNotificationFormatter';

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
  const { formatNotificationContent } = useNotificationFormatter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

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
        toast.error(t('notifications.toastFetchError'));
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
      toast.error(t('notifications.toastMarkReadError'));
    } else {
      toast.success(t('notifications.toastMarkReadSuccess'));
      setNotifications((prev) =>
        prev.map((notification) =>
          notification.id === notificationId
            ? { ...notification, read_at: new Date().toISOString() }
            : notification
        )
      );
      queryClient.invalidateQueries({ queryKey: ['notifications-preview', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['unread-notification-count', user?.id] });
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;

    const unreadNotifications = notifications.filter((n) => !n.read_at);
    if (unreadNotifications.length === 0) {
      toast.info(t('notifications.toastNoUnreadNotifications'));
      return;
    }

    setLoading(true);
    const { error } = await supabase.rpc('mark_all_notifications_read', {
      user_id_param: user.id,
      read_via_param: 'app'
    });

    if (error) {
      console.error('Error marking all notifications as read:', error);
      toast.error(t('notifications.toastMarkAllReadError'));
    } else {
      toast.success(t('notifications.toastMarkAllReadSuccess'));
      setNotifications((prev) =>
        prev.map((notification) => ({
          ...notification,
          read_at: notification.read_at || new Date().toISOString()
        }))
      );
      queryClient.invalidateQueries({ queryKey: ['notifications-preview', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['unread-notification-count', user?.id] });
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader />
      <main className="flex-1">
        <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="space-y-3 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t('notifications.pageTitle')}
            </h1>
            <p className="mx-auto max-w-2xl text-sm text-muted-foreground sm:text-base">
              {t('notifications.pageDescription')}
            </p>
          </div>

          <div className="mt-8 flex justify-center gap-3">
            <Button
              variant="outline"
              className="rounded-full px-6 py-2 text-sm font-medium"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.reload();
                }
              }}
            >
              {t('notifications.refreshButton')}
            </Button>
            {notifications.some((n) => !n.read_at) && (
              <Button
                variant="outline"
                className="rounded-full px-6 py-2 text-sm font-medium"
                onClick={markAllAsRead}
                disabled={loading}
              >
                {t('notifications.markAllAsRead')}
              </Button>
            )}
          </div>

          {loading ? (
            <div className="mt-12 flex justify-center">
              <div className="flex items-center gap-3 rounded-full bg-white/70 px-6 py-3 text-sm text-muted-foreground shadow-[0_12px_30px_rgba(101,195,200,0.15)]">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-transparent" />
                {t('notifications.loading')}
              </div>
            </div>
          ) : notifications.length === 0 ? (
            <Card className="mt-12 rounded-3xl border border-primary/20 bg-background/80 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur">
              <CardContent className="space-y-4 px-6 py-12 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary text-3xl">
                  ✨
                </div>
                <h2 className="text-2xl font-semibold text-foreground">
                  {t('notifications.emptyTitle')}
                </h2>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  {t('notifications.emptyDescription')}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="mt-10 space-y-6">
              {notifications.map((notification) => {
                const { title, body, summary } = formatNotificationContent(notification);
                const isUnread = !notification.read_at;
                const linkTarget: string | null =
                  notification.payload?.link ??
                  (notification.payload?.fanmark_short_id
                    ? `/f/${notification.payload.fanmark_short_id}`
                    : null);
                const showChannelBadge =
                  notification.channel && notification.channel !== 'in_app';

                return (
                  <Card
                    key={notification.id}
                    className={`rounded-3xl border bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] transition-all hover:-translate-y-1 ${isUnread ? 'border-primary/30' : 'border-border/80 opacity-80'
                      }`}
                  >
                    <CardContent className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-1 gap-4">
                        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner shadow-primary/10">
                          <Bell className="h-5 w-5" />
                        </span>
                        <div className="space-y-1.5">
                          <p className="text-sm leading-relaxed text-foreground">
                            {body || title || t('notifications.fallbackTitle')}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(notification.triggered_at), 'yyyy/MM/dd HH:mm')}
                            </span>
                            {showChannelBadge && (
                              <Badge variant="outline" className="text-xs">
                                {notification.channel}
                              </Badge>
                            )}
                            {isUnread && (
                              <Badge variant="default" className="text-xs">
                                {t('notifications.unreadBadge')}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-3 sm:min-w-[180px]">
                        {linkTarget && (
                          <Button
                            asChild
                            variant="outline"
                            className="w-full justify-center gap-2 rounded-full border-primary/40 text-primary hover:bg-primary/10 sm:w-auto"
                          >
                            <Link to={linkTarget}>
                              <Link2 className="h-4 w-4" />
                              {t('notifications.viewDetails')}
                            </Link>
                          </Button>
                        )}
                        {isUnread && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="w-full justify-center text-muted-foreground hover:text-primary sm:w-auto"
                            onClick={() => markAsRead(notification.id)}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            {t('notifications.markAsRead')}
                          </Button>
                        )}
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
