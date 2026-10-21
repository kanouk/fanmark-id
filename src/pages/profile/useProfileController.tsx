import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useSubscription } from '@/hooks/useSubscription';
import { useTranslation } from '@/hooks/useTranslation';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useToast } from '@/hooks/use-toast';
import { usePasswordValidation } from '@/hooks/usePasswordValidation';
import { usePreferredLanguage } from '@/hooks/usePreferredLanguage';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { ActiveLanguageCode, FALLBACK_LANGUAGE, isActiveLanguage } from '@/lib/language';
import { getPlanLimit, type PlanLimits, type PlanType } from '@/lib/plan-utils';
import { CreditCard, Globe, User } from 'lucide-react';

import { deleteAccountThroughWorker } from '@/lib/account-deletion-api';
import { betterAuthClient } from '@/lib/auth-backend';
import { createStripeCustomerPortalThroughWorker } from '@/lib/stripe-customer-portal-api';

type Section = 'account' | 'plan' | 'language';
// TODO: Re-enable when features are implemented
// type Section = 'account' | 'plan' | 'language' | 'display' | 'integrations' | 'notifications';

interface SidebarItem {
  id: Section;
  label: string;
  description?: string;
  icon: typeof User;
}
export function useProfileController() {
  const { user, signOut, signingOut, loading: authLoading, setRequiresPasswordSetup } = useAuth();
  const { profile, loading, updateProfile } = useProfile();
  const {
    subscribed,
    subscription_start: subscriptionStart,
    subscription_end: subscriptionEnd,
    amount: subscriptionAmount,
    currency: subscriptionCurrency,
    interval: subscriptionInterval,
    interval_count: subscriptionIntervalCount,
    cancel_at_period_end: subscriptionCancels,
    loading: subLoading,
    refetch: refetchSubscription,
  } = useSubscription();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { persistPreferredLanguage, isSaving: isSavingPreferredLanguage } = usePreferredLanguage();
  const { settings } = useSystemSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const isOnDashboard = pathname.startsWith('/dashboard');
  const isOnFavorites = pathname.startsWith('/favorites');
  const isOnAnalytics = pathname.startsWith('/analytics');
  const isOnProfilePage = pathname.startsWith('/profile');
  const [activeSection, setActiveSection] = useState<Section>('account');
  const [languagePreference, setLanguagePreference] = useState<ActiveLanguageCode>(
    isActiveLanguage(profile?.preferred_language ?? null) ? (profile?.preferred_language as ActiveLanguageCode) : FALLBACK_LANGUAGE,
  );
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
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
      {
        await betterAuthClient.changePassword(currentPassword, newPassword);
      }

      setCurrentPassword('');
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
      // TODO: Re-enable when notifications feature is implemented
      // {
      //   id: 'notifications',
      //   label: t('userSettings.navNotifications'),
      //   description: t('userSettings.navNotificationsDescription'),
      //   icon: Bell,
      // },
      {
        id: 'language',
        label: t('userSettings.navLanguage'),
        description: t('userSettings.navLanguageDescription'),
        icon: Globe,
      },
      // TODO: Re-enable when display settings feature is implemented
      // {
      //   id: 'display',
      //   label: t('userSettings.navDisplay'),
      //   description: t('userSettings.navDisplayDescription'),
      //   icon: Palette,
      // },
      // TODO: Re-enable when integrations feature is implemented
      // {
      //   id: 'integrations',
      //   label: t('userSettings.navIntegrations'),
      //   description: t('userSettings.navIntegrationsDescription'),
      //   icon: Link2,
      // },
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
  const planLimits = useMemo<PlanLimits>(() => ({
    free: settings.free_fanmarks_limit,
    creator: settings.creator_fanmarks_limit,
    max: settings.max_fanmarks_limit,
    business: settings.business_fanmarks_limit,
    enterprise: settings.enterprise_fanmarks_limit,
    admin: -1,
  }), [settings]);
  const planLimit = getPlanLimit(planType, planLimits);
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
    const accountDeletionBackend = "worker";
    if (deleteConfirmText !== 'DELETE' || (accountDeletionBackend === 'worker' && !deletePassword)) return;

    setIsDeletingAccount(true);
    try {
      {
        await deleteAccountThroughWorker(deletePassword);
      }

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
      setDeletePassword('');
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

  const handleOpenCustomerPortal = async () => {
    setPortalLoading(true);
    try {
            const portal = await createStripeCustomerPortalThroughWorker();
      window.open(portal.url, '_blank');
    } catch (error) {
      console.error('Failed to open customer portal:', error);
      toast({
        title: t('common.error'),
        description: t('userSettings.portalError'),
        variant: 'destructive',
      });
    } finally {
      setPortalLoading(false);
    }
  };
  return {
    user,
    signingOut,
    authLoading,
    profile,
    loading,
    updateProfile,
    subscribed,
    subscriptionStart,
    subscriptionEnd,
    subscriptionAmount,
    subscriptionCurrency,
    subscriptionInterval,
    subscriptionIntervalCount,
    subscriptionCancels,
    subLoading,
    t,
    isSavingPreferredLanguage,
    navigate,
    location,
    pathname,
    isOnDashboard,
    isOnFavorites,
    isOnAnalytics,
    isOnProfilePage,
    activeSection,
    setActiveSection,
    languagePreference,
    newPassword,
    setNewPassword,
    confirmNewPassword,
    setConfirmNewPassword,
    currentPassword,
    setCurrentPassword,
    showNewPassword,
    setShowNewPassword,
    showConfirmNewPassword,
    setShowConfirmNewPassword,
    isUpdatingPassword,
    deleteConfirmText,
    setDeleteConfirmText,
    deletePassword,
    setDeletePassword,
    isDeletingAccount,
    portalLoading,
    passwordRequirements,
    isPasswordValid,
    handlePasswordUpdate,
    sidebarNav,
    currentPlanLabel,
    planLimitCopy,
    passwordStatus,
    confirmPasswordStatus,
    handleLogout,
    handleDeleteAccount,
    handleLanguageSelect,
    handleOpenCustomerPortal,
  };
}
