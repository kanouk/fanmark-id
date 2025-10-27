import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { UserProfileForm } from '@/components/UserProfileForm';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { User, LogOut, CreditCard, Globe, Palette, Link2, Info } from 'lucide-react';
import { MdOutlineMail, MdSpaceDashboard } from 'react-icons/md';
import { RiCalendarCheckLine } from 'react-icons/ri';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { usePreferredLanguage } from '@/hooks/usePreferredLanguage';
import { ACTIVE_LANGUAGES, UPCOMING_LANGUAGES, isActiveLanguage, FALLBACK_LANGUAGE, ActiveLanguageCode } from '@/lib/language';

type Section = 'account' | 'plan' | 'language' | 'display' | 'integrations';

interface SidebarItem {
  id: Section;
  label: string;
  description?: string;
  icon: typeof User;
}

const Profile = () => {
  const { user, signOut, signingOut, loading: authLoading } = useAuth();
  const { profile, loading, updateProfile } = useProfile();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { persistPreferredLanguage, isSaving: isSavingPreferredLanguage } = usePreferredLanguage();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>('account');
  const [languagePreference, setLanguagePreference] = useState<ActiveLanguageCode>(
    isActiveLanguage(profile?.preferred_language ?? null) ? (profile?.preferred_language as ActiveLanguageCode) : FALLBACK_LANGUAGE,
  );

  useEffect(() => {
    setLanguagePreference(
      isActiveLanguage(profile?.preferred_language ?? null)
        ? (profile?.preferred_language as ActiveLanguageCode)
        : FALLBACK_LANGUAGE,
    );
  }, [profile?.preferred_language]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  const sidebarNav: SidebarItem[] = useMemo(
    () => [
      {
        id: 'account',
        label: t('userSettings.navAccount'),
        description: t('userSettings.navAccountProfile'),
        icon: User,
      },
      {
        id: 'plan',
        label: t('userSettings.navPlan'),
        description: t('userSettings.navPlanDescription'),
        icon: CreditCard,
      },
      {
        id: 'language',
        label: t('userSettings.navLanguage'),
        description: t('userSettings.navLanguageDescription'),
        icon: Globe,
      },
      {
        id: 'display',
        label: t('userSettings.navDisplay'),
        description: t('userSettings.navDisplayDescription'),
        icon: Palette,
      },
      {
        id: 'integrations',
        label: t('userSettings.navIntegrations'),
        description: t('userSettings.navIntegrationsDescription'),
        icon: Link2,
      },
    ],
    [t],
  );

  const planLabelMap: Record<string, string> = {
    free: t('userSettings.planTypeFree'),
    creator: t('userSettings.planTypeCreator'),
    business: t('userSettings.planTypeBusiness'),
    enterprise: t('userSettings.planTypeEnterprise'),
    admin: t('userSettings.planTypeAdmin'),
  };
  const currentPlanLabel = planLabelMap[profile?.plan_type ?? 'free'];

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleLanguageSelect = async (value: string) => {
    if (!isActiveLanguage(value) || value === languagePreference) return;
    setLanguagePreference(value);
    try {
      await persistPreferredLanguage(value);
      toast({
        title: t('userSettings.languageUpdateSuccessTitle'),
        description: t('userSettings.languageUpdateSuccessDescription'),
      });
    } catch (error) {
      console.error('Failed to update language preference:', error);
      setLanguagePreference(
        isActiveLanguage(profile?.preferred_language ?? null)
          ? (profile?.preferred_language as ActiveLanguageCode)
          : FALLBACK_LANGUAGE,
      );
      toast({
        title: t('userSettings.languageUpdateErrorTitle'),
        description: t('userSettings.languageUpdateErrorDescription'),
        variant: 'destructive',
      });
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
      </div>
    );
  }

  const accountSection = (
    <div className="space-y-6">
      <Card className="rounded-3xl border border-primary/15 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
        <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <Info className="h-5 w-5 text-primary" />
            {t('userSettings.accountInfo')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('userSettings.accountInfoDescription')}</p>
        </CardHeader>
        <CardContent className="grid gap-4 px-6 pb-6 md:grid-cols-2">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <MdOutlineMail className="h-4 w-4" />
              {t('userSettings.email')}
            </p>
            <div className="rounded-2xl border border-primary/10 bg-background/70 px-4 py-3 text-sm">
              {user?.email}
            </div>
          </div>
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <RiCalendarCheckLine className="h-4 w-4" />
              {t('userSettings.memberSince')}
            </p>
            <div className="rounded-2xl border border-primary/10 bg-background/70 px-4 py-3 text-sm">
              {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.2)]">
        <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <User className="h-5 w-5 text-primary" />
            {t('userSettings.editSettings')}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{t('userSettings.editSettingsDescription')}</p>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <UserProfileForm profile={profile} onUpdate={updateProfile} />
        </CardContent>
      </Card>
    </div>
  );

  const planSection = (
    <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.2)]">
      <CardHeader className="px-6 pt-6 pb-4">
        <CardTitle className="flex items-center justify-between text-xl font-semibold text-foreground">
          <span>{t('userSettings.planOverviewTitle')}</span>
          <Badge className="rounded-full border border-primary/30 bg-primary/10 text-xs text-primary">{currentPlanLabel}</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('userSettings.planOverviewDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-5 px-6 pb-6">
        <div className="h-1.5 rounded-full bg-primary/10">
          <div className="h-full w-2/3 rounded-full bg-primary" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="default" className="rounded-full px-4">
            {t('userSettings.managePlan')}
          </Button>
          <Button variant="outline" className="rounded-full px-4">
            {t('userSettings.viewPlans')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('userSettings.planUpsellCopy')}</p>
      </CardContent>
    </Card>
  );

  const languageSection = (
    <Card className="rounded-3xl border border-primary/15 bg-background/95 shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
      <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Globe className="h-5 w-5 text-primary" />
          {t('userSettings.languageSectionTitle')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('userSettings.languageSectionDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-6 px-6 pb-6">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('userSettings.languageFieldLabel')}
          </p>
          <Select value={languagePreference} onValueChange={handleLanguageSelect} disabled={isSavingPreferredLanguage}>
            <SelectTrigger className="rounded-2xl border border-primary/20 bg-white text-left text-sm">
              <SelectValue placeholder={t('userSettings.languageFieldLabel')} />
            </SelectTrigger>
            <SelectContent>
              {ACTIVE_LANGUAGES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('userSettings.languageFieldHint')}</p>
        </div>
        <div className="rounded-2xl border border-dashed border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t('userSettings.languageComingSoonLabel')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {UPCOMING_LANGUAGES.map((option) => (
              <span key={option.value} className="rounded-full border border-border/60 px-3 py-1 text-[11px] uppercase tracking-wide">
                {option.label}
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const displaySection = (
    <Card className="rounded-3xl border border-primary/15 bg-background/95 shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
      <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Palette className="h-5 w-5 text-primary" />
          {t('userSettings.displaySettingsTitle')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('userSettings.displaySettingsDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6">
        <div className="rounded-2xl border border-dashed border-primary/20 bg-primary/5 px-4 py-6 text-center text-sm text-muted-foreground">
          <p className="text-base font-semibold text-primary">{t('userSettings.displayComingSoonTitle')}</p>
          <p className="mt-2">{t('userSettings.displayComingSoonDescription')}</p>
        </div>
      </CardContent>
    </Card>
  );

  const integrationsSection = (
    <Card className="rounded-3xl border border-primary/15 bg-background/95 shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
      <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Link2 className="h-5 w-5 text-primary" />
          {t('userSettings.integrationsTitle')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('userSettings.integrationsDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6">
        <div className="rounded-2xl border border-dashed border-primary/20 bg-primary/5 px-4 py-6 text-center text-sm text-muted-foreground">
          <p className="text-base font-semibold text-primary">{t('userSettings.integrationsComingSoonTitle')}</p>
          <p className="mt-2">{t('userSettings.integrationsComingSoonDescription')}</p>
        </div>
      </CardContent>
    </Card>
  );

  const renderSection = () => {
    switch (activeSection) {
      case 'account':
        return accountSection;
      case 'plan':
        return planSection;
      case 'language':
        return languageSection;
      case 'display':
        return displaySection;
      case 'integrations':
        return integrationsSection;
      default:
        return accountSection;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <header className="sticky top-0 z-50 border-b border-border/30 bg-white/80 backdrop-blur-xl">
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

          <div className="flex items-center gap-3">
            <LanguageToggle />
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/20 bg-white p-0 text-foreground shadow-[0_4px_12px_rgba(0,0,0,0.1)] transition-transform hover:-translate-y-0.5 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">{user.email}</div>
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
                  <DropdownMenuItem disabled className="cursor-pointer">
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
                    {signingOut ? t('userSettings.saving') : t('navigation.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[280px,1fr]">
            <aside className="rounded-3xl border border-primary/20 bg-white/80 shadow-[0_25px_50px_rgba(101,195,200,0.25)]">
              <div className="space-y-4 px-6 pb-6 pt-8">
                <div className="flex items-center gap-4">
                  <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-primary/20 bg-primary/10">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="Avatar" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <User className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-primary" />
                    )}
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-foreground">{profile?.display_name || user?.email}</p>
                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium uppercase tracking-wide text-primary">
                  <CreditCard className="h-4 w-4" />
                  {currentPlanLabel}
                </div>
              </div>
              <div className="border-t border-primary/10 px-3 py-3">
                {sidebarNav.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={`flex w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition ${
                        active ? 'bg-primary/10 text-foreground shadow-sm' : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'
                      }`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                      <div>
                        <p className="text-sm font-semibold">{item.label}</p>
                        {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-primary/10 px-6 py-6">
                <Button
                  variant="outline"
                  className="w-full justify-center rounded-full border-primary/30 text-primary hover:bg-primary/10"
                  onClick={handleLogout}
                  disabled={signingOut}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  {signingOut ? t('userSettings.saving') : t('userSettings.logoutButton')}
                </Button>
              </div>
            </aside>
            <section>{renderSection()}</section>
          </div>
        </div>
      </main>

      <footer className="border-t border-primary/20 bg-white/80 backdrop-blur">
        <div className="container mx-auto space-y-3 px-4 py-10 text-center">
          <div className="flex items-center justify-center gap-2 text-2xl font-bold text-primary">
            <span className="text-3xl">✨</span> <span className="text-gradient">fanmark.id</span>
          </div>
          <p className="text-sm text-muted-foreground">{t('common.footer')}</p>
        </div>
      </footer>
    </div>
  );
};

export default Profile;
