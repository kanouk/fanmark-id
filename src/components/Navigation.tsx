import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { LanguageToggle } from '@/components/LanguageToggle';
import { BrandWordmark } from '@/components/BrandWordmark';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Heart, LogOut, User, Bell } from 'lucide-react';
import { MdSpaceDashboard } from 'react-icons/md';
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useEffect } from 'react';

export const Navigation = () => {
  const { user, signOut, signingOut } = useAuth();
  const { profile } = useProfile();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: unreadCount = 0 } = useUnreadNotifications();
  const locale = ja;
  const { data: recentNotifications = [], isLoading: notificationsLoading } = useQuery({
    queryKey: ['notifications-preview', user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, payload, triggered_at, read_at')
        .eq('user_id', user!.id)
        .order('triggered_at', { ascending: false })
        .limit(5);

      if (error) {
        console.error('Error fetching notifications preview:', error);
        return [];
      }

      return data ?? [];
    },
  });

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`notifications-preview-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['notifications-preview', user.id] });
          queryClient.invalidateQueries({ queryKey: ['unread-notification-count', user.id] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  const handleLogout = async () => {
    try {
      await signOut();
      toast({
        title: t('navigation.logout'),
        description: t('common.logoutSuccess'),
      });
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
      toast({
        title: t('common.error'),
        description: t('common.logoutFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex items-center justify-between px-4 py-4 md:px-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="group flex items-center gap-2 text-lg font-semibold text-foreground transition-transform hover:translate-y-[-1px]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-2xl transition-all group-hover:scale-105">
            ✨
          </span>
          <BrandWordmark className="text-2xl" />
        </button>

        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex" />

        <div className="flex items-center gap-2">
          <LanguageToggle />
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="relative flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-transform hover:-translate-y-0.5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={t('notifications.ariaLabel')}
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.5rem] items-center justify-center rounded-full bg-gradient-to-br from-primary via-primary to-primary/90 px-1 text-[11px] font-semibold text-primary-foreground shadow-lg">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-80 rounded-2xl border border-border/60 bg-card/95 p-0 shadow-2xl backdrop-blur-xl"
              >
                <div className="border-b border-border/70 px-4 py-3">
                  <DropdownMenuLabel className="flex items-center justify-between px-0 text-sm font-semibold text-foreground">
                    <span>{t('notifications.pageTitle')}</span>
                    {unreadCount > 0 && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {t('notifications.unreadCountLabel', { count: unreadCount })}
                      </span>
                    )}
                  </DropdownMenuLabel>
                </div>
                <div className="max-h-80 overflow-y-auto px-2 py-2">
                  {notificationsLoading ? (
                    <div className="rounded-xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                      {t('notifications.loading')}
                    </div>
                  ) : recentNotifications.length === 0 ? (
                    <div className="rounded-xl bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                      {t('notifications.emptyTitle')}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {recentNotifications.map((notification: any) => (
                        <button
                          key={notification.id}
                          type="button"
                          onClick={() => {
                            const directLink =
                              notification.payload?.link ??
                              (notification.payload?.fanmark_short_id
                                ? `/f/${notification.payload.fanmark_short_id}`
                                : null);
                            if (directLink) {
                              navigate(directLink);
                            } else {
                              navigate('/notifications');
                            }
                          }}
                          className="group w-full rounded-xl border border-transparent bg-transparent px-3 py-2 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
                        >
                          <p className="text-sm font-medium text-foreground group-hover:text-primary">
                            {notification.payload?.title ?? t('notifications.fallbackTitle')}
                          </p>
                          {notification.payload?.body && (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {notification.payload.body}
                            </p>
                          )}
                          <p className="mt-2 text-[11px] text-muted-foreground">
                              {formatDistanceToNow(new Date(notification.triggered_at), {
                                addSuffix: true,
                                locale,
                              })}
                            {!notification.read_at && (
                              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                {t('notifications.unreadBadge')}
                              </span>
                            )}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <DropdownMenuSeparator className="mx-4" />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    navigate('/notifications');
                  }}
                  className="cursor-pointer justify-center rounded-b-2xl px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  {t('notifications.viewAll')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 shadow-[0_4px_12px_hsl(var(--primary)_/_0.15)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={t('navigation.userMenu')}
                >
                  <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="Avatar" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <User className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {user.email}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    navigate('/favorites');
                  }}
                  className="cursor-pointer"
                >
                  <Heart className="mr-2 h-4 w-4" />
                  {t('navigation.favorites')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    navigate('/dashboard');
                  }}
                  className="cursor-pointer"
                >
                  <MdSpaceDashboard className="mr-2 h-4 w-4" />
                  {t('navigation.dashboard')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    navigate('/profile');
                  }}
                  className="cursor-pointer"
                >
                  <User className="mr-2 h-4 w-4" />
                  {t('navigation.profile')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    handleLogout();
                  }}
                  className="cursor-pointer"
                  disabled={signingOut}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {signingOut ? t('navigation.loggingOut') : t('navigation.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild variant="default" size="sm">
              <Link to="/auth">{t('auth.login')}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
