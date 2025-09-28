import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { UserProfileForm } from '@/components/UserProfileForm';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { User, Settings, Info, LogOut } from 'lucide-react';
import { MdOutlineMail, MdSpaceDashboard } from 'react-icons/md';
import { RiCalendarCheckLine } from 'react-icons/ri';
import { HiOutlineSparkles } from 'react-icons/hi2';

const Profile = () => {
  const { user, signOut, signingOut, loading: authLoading } = useAuth();
  const { profile, loading, updateProfile } = useProfile();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      {/* Header Navigation */}
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

          <div className="flex items-center gap-2">
            <LanguageToggle />
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 p-0 shadow-[0_4px_12px_hsl(var(--primary)_/_0.15)] transition-transform hover:-translate-y-0.5 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label={t('navigation.userMenu')}
                  >
                    <div className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                      {profile?.avatar_url ? (
                        <img src={profile.avatar_url} alt="Avatar" className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <User className="h-4 w-4 text-primary" />
                      )}
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    {user.email}
                  </div>
                  <DropdownMenuSeparator />
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
                      // Already on profile page, no need to navigate
                    }}
                    className="cursor-pointer bg-primary/5"
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
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">
        <section className="container mx-auto px-4 py-12">
          <div className="space-y-10">
            <div className="space-y-2 text-center">
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {t('userSettings.pageTitle')}
              </h1>
              <p className="text-sm text-muted-foreground sm:text-base">
                {t('userSettings.pageSubtitle')}
              </p>
            </div>

            <Card className="rounded-3xl border border-primary/20 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur">
              <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:gap-8">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-primary/20 bg-primary/10">
                  {profile?.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt={profile?.display_name || 'Avatar'}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <User className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 text-primary" />
                  )}
                </div>
                <div className="space-y-2 text-center sm:text-left">
                  <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center">
                    <h2 className="text-2xl font-semibold text-foreground">
                      {profile?.display_name || profile?.username || 'Welcome'}
                    </h2>
                    <Badge className={`rounded-full px-3 py-1 text-xs font-medium ${
                      profile?.plan_type === 'admin' ? 'border-destructive/40 bg-destructive/5 text-destructive' :
                      profile?.plan_type === 'business' ? 'border-purple-300/60 bg-purple-50 text-purple-700' :
                      profile?.plan_type === 'creator' ? 'border-blue-300/60 bg-blue-50 text-blue-700' :
                      'border-gray-300/60 bg-gray-50 text-gray-700'
                    }`}>
                      {profile?.plan_type === 'admin' ? 'Admin' :
                       profile?.plan_type === 'business' ? 'Business' :
                       profile?.plan_type === 'creator' ? 'Creator' :
                       'Free'}
                    </Badge>
                  </div>
                  {profile?.username && (
                    <p className="text-sm text-muted-foreground">@{profile.username}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="edit" className="space-y-6">
              <TabsList className="grid w-full grid-cols-2 gap-2 rounded-full border border-primary/20 bg-background/70 p-2 backdrop-blur">
                <TabsTrigger
                  value="edit"
                  className="gap-2 rounded-full py-3 px-4 text-base font-medium transition-all duration-200 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
                >
                  <Settings className="h-4 w-4" />
                  {t('userSettings.editSettings')}
                </TabsTrigger>
                <TabsTrigger
                  value="settings"
                  className="gap-2 rounded-full py-3 px-4 text-base font-medium transition-all duration-200 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
                >
                  <Info className="h-4 w-4" />
                  {t('userSettings.accountInfo')}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="edit" className="space-y-6">
                <Card className="rounded-3xl border border-primary/15 bg-background/90 shadow-[0_18px_40px_rgba(101,195,200,0.12)]">
                  <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-4">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                      <User className="h-5 w-5 text-primary" />
                      {t('userSettings.editSettings')}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{t('userSettings.editSettingsDescription')}</p>
                  </CardHeader>
                  <CardContent className="px-6 pb-6 pt-6">
                    <UserProfileForm profile={profile} onUpdate={updateProfile} />
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="settings" className="space-y-6">
                <Card className="rounded-3xl border border-primary/15 bg-background/90 shadow-[0_18px_40px_rgba(101,195,200,0.12)]">
                  <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-4">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                      <Info className="h-5 w-5 text-primary" />
                      {t('userSettings.accountInfo')}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">{t('userSettings.accountInfoDescription')}</p>
                  </CardHeader>
                  <CardContent className="space-y-4 p-6">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <MdOutlineMail className="h-4 w-4" />
                          {t('userSettings.email')}
                        </p>
                        <div className="rounded-2xl border border-primary/10 bg-background/80 px-4 py-3 text-sm text-foreground">
                          {user?.email}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <RiCalendarCheckLine className="h-4 w-4" />
                          {t('userSettings.memberSince')}
                        </p>
                        <div className="rounded-2xl border border-primary/10 bg-background/80 px-4 py-3 text-sm text-foreground">
                          {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : 'N/A'}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <HiOutlineSparkles className="h-4 w-4" />
                          {t('userSettings.planType')}
                        </p>
                        <div className="flex items-center gap-2 rounded-2xl border border-primary/10 bg-background/80 px-4 py-3 text-sm text-foreground">
                          <Badge className={`rounded-full px-3 py-1 text-xs font-medium ${
                            profile?.plan_type === 'admin' ? 'border-destructive/40 bg-destructive/5 text-destructive' :
                            profile?.plan_type === 'business' ? 'border-purple-300/60 bg-purple-50 text-purple-700' :
                            profile?.plan_type === 'creator' ? 'border-blue-300/60 bg-blue-50 text-blue-700' :
                            'border-gray-300/60 bg-gray-50 text-gray-700'
                          }`}>
                            {profile?.plan_type === 'admin' ? 'Admin' :
                             profile?.plan_type === 'business' ? 'Business' :
                             profile?.plan_type === 'creator' ? 'Creator' :
                             'Free'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </section>
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
};

export default Profile;
