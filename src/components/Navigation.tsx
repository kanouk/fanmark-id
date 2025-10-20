import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Heart, LogOut, User, Bell } from 'lucide-react';
import { MdSpaceDashboard } from 'react-icons/md';
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications';

export const Navigation = () => {
  const { user, signOut, signingOut } = useAuth();
  const { profile } = useProfile();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: unreadCount = 0 } = useUnreadNotifications();

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
          <span className="text-gradient text-2xl">fanmark.id</span>
        </button>

        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex" />

        <div className="flex items-center gap-2">
          <LanguageToggle />
          {user && (
            <button
              onClick={() => navigate('/notifications')}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 shadow-[0_4px_12px_hsl(var(--primary)_/_0.15)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="通知"
            >
              <Bell className="h-5 w-5 text-primary" />
              {unreadCount > 0 && (
                <Badge 
                  variant="destructive" 
                  className="absolute -right-1 -top-1 h-5 min-w-[20px] flex items-center justify-center px-1 text-xs"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
              )}
            </button>
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
