import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useSubscription } from '@/hooks/useSubscription';
import { useTranslation } from '@/hooks/useTranslation';
import { UserProfileForm } from '@/components/UserProfileForm';
import { LanguageToggle } from '@/components/LanguageToggle';
import { AppHeader } from '@/components/layout/AppHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { CardDescription } from '@/components/ui/card';
import { User, LogOut, CreditCard, Globe, Palette, Link2, Info, PencilLine, Languages, Heart, Lock, ShieldCheck, Check, X, AlertTriangle, Loader2 } from 'lucide-react';
import { MdSpaceDashboard } from 'react-icons/md';
import { RiCalendarCheckLine } from 'react-icons/ri';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { usePreferredLanguage } from '@/hooks/usePreferredLanguage';
import { ACTIVE_LANGUAGES, isActiveLanguage, FALLBACK_LANGUAGE, ActiveLanguageCode } from '@/lib/language';
import { getPlanLimit, type PlanType } from '@/lib/plan-utils';
import { usePasswordValidation } from '@/hooks/usePasswordValidation';
import { PasswordRequirement } from '@/components/PasswordRequirement';
import { supabase } from '@/integrations/supabase/client';

type Section = 'account' | 'plan' | 'language' | 'display' | 'integrations';

interface SidebarItem {
  id: Section;
  label: string;
  description?: string;
  icon: typeof User;
}

const InputStatusIcon = ({ status }: { status: boolean | null }) => {
  if (status === null) return null;
  return (
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
      {status ? <Check className="h-4 w-4 text-emerald-500" /> : <X className="h-4 w-4 text-destructive" />}
    </span>
  );
};

const Profile = () => {
  const { user, signOut, signingOut, loading: authLoading, setRequiresPasswordSetup } = useAuth();
  const { profile, loading, updateProfile } = useProfile();
  const { subscribed, subscription_end, loading: subLoading, refetch: refetchSubscription } = useSubscription();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { persistPreferredLanguage, isSaving: isSavingPreferredLanguage } = usePreferredLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const isOnDashboard = pathname.startsWith('/dashboard');
  const isOnFavorites = pathname.startsWith('/favorites');
  const isOnProfilePage = pathname.startsWith('/profile');
  const [activeSection, setActiveSection] = useState<Section>('account');
  const [languagePreference, setLanguagePreference] = useState<ActiveLanguageCode>(
    isActiveLanguage(profile?.preferred_language ?? null) ? (profile?.preferred_language as ActiveLanguageCode) : FALLBACK_LANGUAGE,
  );
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const { requirements: passwordRequirements, isValid: isPasswordValid } = usePasswordValidation(newPassword);

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

  const handlePasswordUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (newPassword !== confirmNewPassword) {
      toast({
        title: t('common.error'),
        description: t('auth.passwordMismatch'),
        variant: 'destructive',
      });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      if (user?.id) {
        const { error: flagError } = await supabase
          .from('user_settings')
          .update({ requires_password_setup: false })
          .eq('user_id', user.id);

        if (flagError) throw flagError;
      }

      setRequiresPasswordSetup(false);
      setNewPassword('');
      setConfirmNewPassword('');
      toast({
        title: t('common.passwordUpdated'),
        description: t('common.passwordUpdatedDesc'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      toast({
        title: t('common.error'),
        description: message || t('common.tryAgain'),
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

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
  const planType = (profile?.plan_type ?? 'free') as PlanType;
  const planLimit = getPlanLimit(planType);
  const planLimitCopy =
    planLimit === -1 ? t('userSettings.planUnlimited') : t('userSettings.planLimitInfo', { limit: planLimit });

  const passwordStatus = newPassword ? isPasswordValid : null;
  const confirmPasswordStatus = confirmNewPassword
    ? confirmNewPassword === newPassword && confirmNewPassword.length > 0
    : null;

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    
    setIsDeletingAccount(true);
    try {
      const { error } = await supabase.functions.invoke('delete-user-account');
      if (error) throw error;
      
      toast({
        title: t('userSettings.deleteAccount.successTitle'),
        description: t('userSettings.deleteAccount.successDescription'),
      });
      
      // Auto logout and redirect
      await signOut();
      navigate('/');
    } catch (error) {
      console.error('Account deletion failed:', error);
      toast({
        title: t('userSettings.deleteAccount.errorTitle'),
        description: t('userSettings.deleteAccount.errorDescription'),
        variant: 'destructive',
      });
    } finally {
      setIsDeletingAccount(false);
      setDeleteConfirmText('');
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
    <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.2)]">
      <CardHeader className="px-6 pt-6 pb-4 space-y-2">
        <CardTitle className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <User className="h-5 w-5 text-primary" />
          {t('userSettings.navAccount')}
        </CardTitle>
        <p className="ml-7 text-sm text-muted-foreground">{t('userSettings.accountSectionDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-6 px-6 pb-6 pt-2">
        <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.2)]">
          <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold">
              <Info className="h-5 w-5 text-primary" />
              {t('userSettings.accountInfo')}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 px-6 pb-6">
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
              <PencilLine className="h-5 w-5 text-primary" />
              {t('userSettings.editSettings')}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <UserProfileForm profile={profile} onUpdate={updateProfile} />
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.2)]">
          <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <Lock className="h-5 w-5 text-primary" />
              {t('userSettings.passwordSectionTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <form onSubmit={handlePasswordUpdate} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="profile-new-password" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <Lock className="h-4 w-4" />
                  {t('auth.newPassword')}
                </Label>
                <div className="relative">
                  <Input
                    id="profile-new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={t('password.requirements.length')}
                    autoComplete="new-password"
                    className="h-11 rounded-2xl border border-primary/15 bg-background/80 pr-10 focus-visible:ring-2 focus-visible:ring-primary/40"
                    required
                    minLength={8}
                  />
                  <InputStatusIcon status={passwordStatus} />
                </div>
                {newPassword && (
                  <div className="rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
                    <h4 className="mb-2 font-semibold text-primary">{t('password.requirements.title')}</h4>
                    <div className="space-y-1.5">
                      {passwordRequirements.map((req, index) => (
                        <PasswordRequirement key={index} met={req.met} text={req.text} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-confirm-password" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <ShieldCheck className="h-4 w-4" />
                  {t('auth.confirmNewPassword')}
                </Label>
                <div className="relative">
                  <Input
                    id="profile-confirm-password"
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    autoComplete="new-password"
                    className="h-11 rounded-2xl border border-primary/15 bg-background/80 pr-10 focus-visible:ring-2 focus-visible:ring-primary/40"
                    required
                  />
                  <InputStatusIcon status={confirmPasswordStatus} />
                </div>
                {confirmNewPassword && confirmNewPassword !== newPassword && (
                  <p className="text-xs text-destructive">{t('auth.passwordMismatch')}</p>
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={
                    isUpdatingPassword ||
                    !isPasswordValid ||
                    newPassword.length === 0 ||
                    newPassword !== confirmNewPassword
                  }
                  className="rounded-full"
                >
                  {isUpdatingPassword ? t('common.loading') : t('userSettings.updatePasswordButton')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-2 border-destructive/30 bg-destructive/5">
          <CardHeader className="flex flex-col gap-2 px-6 pt-6 pb-2">
            <CardTitle className="flex items-center gap-2 text-lg font-semibold text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t('userSettings.deleteAccount.title')}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {t('userSettings.deleteAccount.description')}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="rounded-full">
                  {t('userSettings.deleteAccount.buttonLabel')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('userSettings.deleteAccount.confirmTitle')}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="whitespace-pre-line">
                    {t('userSettings.deleteAccount.confirmDescription')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                
                {subscribed && subscription_end && !subLoading && (
                  <div className="rounded-2xl border-2 border-destructive/30 bg-destructive/10 p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
                      <div className="space-y-1 flex-1">
                        <p className="font-semibold text-sm text-destructive">
                          {t('userSettings.deleteAccount.subscriptionWarningTitle')}
                        </p>
                        <p className="text-xs text-destructive/90">
                          {t('userSettings.deleteAccount.subscriptionWarningDescription', {
                            daysLeft: Math.max(0, Math.ceil((new Date(subscription_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                          })}
                        </p>
                        <div className="text-xs text-muted-foreground pt-1">
                          {t('userSettings.deleteAccount.subscriptionEndDate', {
                            date: new Date(subscription_end).toLocaleDateString()
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="delete-confirm">{t('userSettings.deleteAccount.confirmPrompt')}</Label>
                    <Input
                      id="delete-confirm"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={t('userSettings.deleteAccount.confirmPlaceholder')}
                      className="rounded-2xl"
                    />
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setDeleteConfirmText('')}>
                    {t('userSettings.deleteAccount.cancelButton')}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== 'DELETE' || isDeletingAccount}
                    className="bg-destructive hover:bg-destructive/90"
                  >
                    {isDeletingAccount
                      ? t('userSettings.deleteAccount.deleting')
                      : t('userSettings.deleteAccount.deleteButton')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );

  const planSection = (
    <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.2)]">
      <CardHeader className="px-6 pt-6 pb-4 space-y-2">
        <CardTitle className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <CreditCard className="h-5 w-5 text-primary" />
          {t('userSettings.navPlan')}
        </CardTitle>
        <p className="ml-7 text-sm text-muted-foreground">{t('userSettings.planSectionDescription')}</p>
      </CardHeader>
      <CardContent className="space-y-6 px-6 pb-6 pt-2">
        {/* Current Plan Info */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-background/70 px-4 py-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{currentPlanLabel}</p>
              <p className="text-xs text-muted-foreground">{planLimitCopy}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-full border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
              onClick={() => navigate('/plans', { state: { from: location.pathname } })}
            >
              {t('userSettings.changePlan')}
            </Button>
          </div>
        </div>

        {/* Subscription Status */}
        <Card className="rounded-2xl border border-primary/15 bg-primary/5">
          <CardHeader className="px-5 pt-5 pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-foreground">
                サブスクリプション状態
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={refetchSubscription}
                disabled={subLoading}
                className="h-8 w-8 rounded-full p-0 hover:bg-primary/10"
              >
                {subLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <RiCalendarCheckLine className="h-4 w-4 text-primary" />
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-background/80 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">ステータス</span>
                <Badge 
                  variant={subscribed ? "default" : "secondary"}
                  className="rounded-full"
                >
                  {subscribed ? '有効' : '無効'}
                </Badge>
              </div>

              {subscription_end && (
                <div className="flex items-center justify-between rounded-xl bg-background/80 px-3 py-2.5">
                  <span className="text-sm text-muted-foreground">次回更新日</span>
                  <span className="text-sm font-medium text-foreground">
                    {new Date(subscription_end).toLocaleDateString('ja-JP', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              )}

              {!subscribed && !subLoading && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  現在、有効なサブスクリプションはありません
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );

  const languageSection = (
    <Card className="rounded-3xl border border-primary/20 bg-white shadow-[0_20px_45px_rgba(101,195,200,0.2)]">
      <CardHeader className="px-6 pt-6 pb-4 space-y-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Globe className="h-5 w-5 text-primary" />
          {t('userSettings.languageSectionTitle')}
        </CardTitle>
        <p className="ml-7 text-sm text-muted-foreground">{t('userSettings.languageSectionDescriptionDetailed')}</p>
      </CardHeader>
      <CardContent className="space-y-6 px-6 pb-6 pt-2">
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Languages className="h-3.5 w-3.5 text-primary" />
            {t('userSettings.languageFieldLabel')}
          </p>
          <Select value={languagePreference} onValueChange={handleLanguageSelect} disabled={isSavingPreferredLanguage}>
            <SelectTrigger className="rounded-2xl border border-primary/20 bg-white text-left text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
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
      </CardContent>
    </Card>
  );

  const displaySection = (
    <Card className="rounded-3xl border border-primary/15 bg-background/95 shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
      <CardHeader className="px-6 pt-6 pb-4 space-y-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Palette className="h-5 w-5 text-primary" />
          {t('userSettings.displaySettingsTitle')}
        </CardTitle>
        <p className="ml-7 text-sm text-muted-foreground">{t('userSettings.displaySectionDescriptionDetailed')}</p>
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6 pt-2">
        <div className="rounded-2xl border border-dashed border-primary/20 bg-primary/5 px-4 py-6 text-center text-sm text-muted-foreground">
          <p className="text-base font-semibold text-primary">{t('userSettings.displayComingSoonTitle')}</p>
          <p className="mt-2">{t('userSettings.displayComingSoonDescription')}</p>
        </div>
      </CardContent>
    </Card>
  );

  const integrationsSection = (
    <Card className="rounded-3xl border border-primary/15 bg-background/95 shadow-[0_20px_45px_rgba(101,195,200,0.15)]">
      <CardHeader className="px-6 pt-6 pb-4 space-y-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Link2 className="h-5 w-5 text-primary" />
          {t('userSettings.integrationsTitle')}
        </CardTitle>
        <p className="ml-7 text-sm text-muted-foreground">{t('userSettings.integrationsSectionDescriptionDetailed')}</p>
      </CardHeader>
      <CardContent className="space-y-4 px-6 pb-6 pt-2">
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

  const headerRight = (
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
                  if (!isOnDashboard) {
                    navigate('/dashboard');
                  }
                }}
                className={isOnDashboard ? 'opacity-60' : 'cursor-pointer'}
                disabled={isOnDashboard}
              >
                <MdSpaceDashboard className="mr-2 h-4 w-4" />
                {t('navigation.dashboard')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  if (!isOnFavorites) {
                    navigate('/favorites');
                  }
                }}
                className={isOnFavorites ? 'opacity-60' : 'cursor-pointer'}
                disabled={isOnFavorites}
              >
                <Heart className="mr-2 h-4 w-4" />
                {t('navigation.favorites')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  if (!isOnProfilePage) {
                    navigate('/profile');
                  }
                }}
                className={isOnProfilePage ? 'opacity-60' : 'cursor-pointer'}
                disabled={isOnProfilePage}
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
              {signingOut ? t('userSettings.saving') : t('navigation.logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <AppHeader
        className="border-border/30 bg-white/80"
        showNotifications={false}
        showUserMenu={false}
        showAuthButton={false}
        showLanguageToggle={false}
        rightSlot={headerRight}
      />

      <main className="flex-1">
        <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[280px,1fr]">
            <aside className="rounded-3xl border border-primary/20 bg-white/80 shadow-[0_25px_50px_rgba(101,195,200,0.25)]">
              <div className="space-y-4 px-6 pb-6 pt-8">
                <div className="flex items-center gap-4">
                  <div className="relative h-14 w-14 overflow-hidden rounded-full border border-primary/20 bg-primary/10">
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

      <SiteFooter className="border-primary/20 bg-white/80 backdrop-blur" />
    </div>
  );
};

export default Profile;
