import { usePendingCheckout } from '@/hooks/usePendingCheckout';
import { getErrorMessage } from '@/lib/error-message';
import { formatInTimeZone } from 'date-fns-tz';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { type ExtendLicenseTarget, type ExtendPlanOption } from '@/components/ExtendLicenseDialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
// Using Undo2 for return/return action

import { useFanmarkLimit } from '@/hooks/useFanmarkLimit';
import { useFavoriteFanmarks } from '@/hooks/useFavoriteFanmarks';
import { useLifecycleSettings } from '@/hooks/useLifecycleSettings';
import { useOwnedFanmarks } from '@/hooks/useOwnedFanmarks';
import { useSubscription } from '@/hooks/useSubscription';
import { fetchFanmarkAnalyticsSummaryWorker } from '@/lib/fanmark-analytics-api';
import { returnFanmarkThroughWorker } from '@/lib/fanmark-return-api';
import { deriveLicenseTiming, type LicenseTimingResult } from '@/lib/licenseTiming';
import { parseDateString } from '@/lib/utils';

import { useTransferCode } from '@/hooks/useTransferCode';
import { createStripeExtensionCheckoutThroughWorker, waitForStripeExtensionApplication } from '@/lib/stripe-extension-checkout-api';

const LICENSE_STATUS_WEIGHT: Record<LicenseTimingResult['status'], number> = {
  active: 0,
  'grace-return': 2,
  grace: 3,
  expired: 4,
};

const ACTIVE_TAB_STORAGE_KEY = 'fanmark-dashboard:active-tab';
const EXTENSION_CHECKOUT_REQUEST_STORAGE_PREFIX = 'fanmark:extension-checkout-request:';

function clearExtensionCheckoutRequestIds() {
  if (typeof window === 'undefined') return;
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(EXTENSION_CHECKOUT_REQUEST_STORAGE_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    }
  } catch (error) {
    console.warn('Failed to clear extension checkout request IDs:', error);
  }
}

interface Fanmark {
  id: string;
  user_input_fanmark: string;
  emoji_ids: string[];
  fanmark: string;
  emoji_key: string;
  fanmark_name: string | null;
  short_id: string;
  access_type: string;
  tier_level: number | null;
  current_license_id: string | null;
  is_transferable: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  user_id?: string;
  fanmark_licenses?: {
    license_start: string;
    license_end: string | null;
    grace_expires_at?: string | null;
    status: string;
    is_returned?: boolean | null;
    excluded_at?: string | null;
    excluded_from_plan?: string | null;
  } | null;
  current_license?: {
    id: string;
    license_start: string;
    license_end: string | null;
    status: string;
    created_at: string;
  };
}

interface DashboardLocationState {
  prefillFanmark?: string;
  scrollToSearch?: boolean;
}
export function useDashboardController() {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { toast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings: lifecycleSettings } = useLifecycleSettings();
  const { limit: fanmarkLimit, isUnlimited } = useFanmarkLimit();
  const { paymentFailureAt, nextPaymentAttempt, subscription_end: subscriptionEnd } = useSubscription();
  const { count: favoriteCount, isLoading: favoritesLoading } = useFavoriteFanmarks({
    enabled: Boolean(user),
  });
  const { getPendingCheckout, setPendingCheckout, clearPendingCheckout } = usePendingCheckout();

  const canAccessAnalytics = useMemo(() => {
    const planType = profile?.plan_type;
    return planType === 'creator' || planType === 'business' || planType === 'enterprise' || planType === 'admin';
  }, [profile?.plan_type]);

  const [extensionConfirmation, setExtensionConfirmation] = useState<'pending' | 'timeout' | null>(null);
  const [extensionConfirmationRetry, setExtensionConfirmationRetry] = useState(0);
  const { fanmarks, loading, error: fanmarksError, refetch: fetchFanmarks } = useOwnedFanmarks();
  const [activeTab, setActiveTabState] = useState(() => {
    if (typeof window === 'undefined') {
      return 'my-fanmarks';
    }
    const stored = sessionStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return stored === 'acquisition' || stored === 'my-fanmarks' ? stored : 'my-fanmarks';
  });
  const setActiveTab = useCallback((value: string) => {
    setActiveTabState(value);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(ACTIVE_TAB_STORAGE_KEY, value);
    }
  }, []);
  const [prefilledEmoji, setPrefilledEmoji] = useState<string | undefined>();
  const [shouldScrollToSearch, setShouldScrollToSearch] = useState(false);
  const [returningFanmarkId, setReturningFanmarkId] = useState<string | null>(null);
  const [returningFanmarkEmoji, setReturningFanmarkEmoji] = useState<string | undefined>();
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnTargetFanmark, setReturnTargetFanmark] = useState<Fanmark | null>(null);
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [extendTarget, setExtendTarget] = useState<ExtendLicenseTarget | null>(null);
  const [extendSelectedPlan, setExtendSelectedPlan] = useState<ExtendPlanOption | null>(null);
  const [extendPlans, setExtendPlans] = useState<ExtendPlanOption[]>([]);
  const [extendProcessing, setExtendProcessing] = useState(false);
  const extensionCheckoutRequestIds = useRef(new Map<string, string>());
  const [totalAccessCount, setTotalAccessCount] = useState<number | null>(null);
  const [accessCountLoading, setAccessCountLoading] = useState(true);
  const paymentWarningDate = useMemo(() => {
    const nextAttemptDate = parseDateString(nextPaymentAttempt);
    const subscriptionEndDate = parseDateString(subscriptionEnd);
    const candidate = nextAttemptDate && subscriptionEndDate
      ? (nextAttemptDate > subscriptionEndDate ? nextAttemptDate : subscriptionEndDate)
      : nextAttemptDate ?? subscriptionEndDate;

    return candidate ? formatInTimeZone(candidate, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : null;
  }, [nextPaymentAttempt, subscriptionEnd]);
  const showPaymentWarning = Boolean(paymentFailureAt || nextPaymentAttempt);

  // Transfer system - single source of truth
  const transferCodeData = useTransferCode();
  const { hasActiveTransfer, getTransferStatus, refetch: refetchTransfer } = transferCodeData;
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferTargetFanmark, setTransferTargetFanmark] = useState<{ fanmarkId: string; licenseId: string; emoji: string } | null>(null);

  const openTransferDialog = (fanmark: Fanmark) => {
    if (!fanmark.current_license_id) return;
    setTransferTargetFanmark({
      fanmarkId: fanmark.id,
      licenseId: fanmark.current_license_id,
      emoji: fanmark.fanmark,
    });
    setTransferDialogOpen(true);
  };

  const handleOpenSettings = (fanmarkId: string) => {
    // Find and cache fanmark data for profile edit page
    const fanmark = fanmarks.find(f => f.id === fanmarkId);
    if (fanmark) {
      const fanmarkData = {
        user_input_fanmark: fanmark.user_input_fanmark,
        fanmark: fanmark.fanmark,
        emoji_ids: fanmark.emoji_ids,
        fanmark_name: fanmark.fanmark_name,
        fanmarkId: fanmarkId,
        timestamp: Date.now()
      };
      localStorage.setItem('fanmark_settings_cache', JSON.stringify(fanmarkData));
    }
    navigate(`/fanmarks/${fanmarkId}/settings`);
  };

  const handleReturnFanmark = async (fanmarkId: string, fanmarkEmoji?: string) => {
    setReturningFanmarkId(fanmarkId);
    if (fanmarkEmoji) {
      setReturningFanmarkEmoji(fanmarkEmoji);
    }

    try {
      {
        await returnFanmarkThroughWorker(fanmarkId);
      }

      toast({
        title: t('dashboard.returnSuccess'),
        description: t('dashboard.returnSuccessDescription'),
      });

      await fetchFanmarks();
    } catch (error: unknown) {
      console.error('Error returning fanmark via function:', error);
      const desc = getErrorMessage(error, t('dashboard.returnErrorDescription'));
      toast({
        title: t('dashboard.returnError'),
        description: desc,
        variant: 'destructive',
      });
    } finally {
      setReturningFanmarkId(null);
      setReturningFanmarkEmoji(undefined);
    }
  };

  const openReturnDialog = (fanmark: Fanmark) => {
    setReturnTargetFanmark(fanmark);
    setReturnDialogOpen(true);
  };

  const handleConfirmReturn = async () => {
    if (!returnTargetFanmark) return;
    await handleReturnFanmark(returnTargetFanmark.id, returnTargetFanmark.fanmark);
    setReturnDialogOpen(false);
    setReturnTargetFanmark(null);
  };

  const openExtendDialog = (fanmark: Fanmark, timing: LicenseTimingResult) => {
    extensionCheckoutRequestIds.current.clear();
    const licenseData = fanmark.fanmark_licenses;
    setExtendTarget({
      fanmarkId: fanmark.id,
      licenseId: fanmark.current_license_id ?? null,
      emoji: fanmark.fanmark,
      shortId: fanmark.short_id,
      licenseEnd: licenseData?.license_end ?? null,
      graceExpiresAt: licenseData?.grace_expires_at ?? null,
      status: timing.status,
      tierLevel: fanmark.tier_level ?? null,
    });
    setExtendSelectedPlan(null);
    setExtendDialogOpen(true);
  };

  const handleChangePlan = useCallback((plan: ExtendPlanOption | null) => {
    setExtendSelectedPlan(plan);
  }, []);

  const handleExtendSubmit = async () => {
    if (!extendTarget || !extendSelectedPlan) return;
    const requestScope = [
      user?.id ?? 'anonymous',
      extendTarget.licenseId ?? '',
      extendTarget.fanmarkId,
      extendSelectedPlan.months,
    ].join(':');
    const requestStorageKey = `${EXTENSION_CHECKOUT_REQUEST_STORAGE_PREFIX}${requestScope}`;
    let requestId = extensionCheckoutRequestIds.current.get(requestScope);
    if (!requestId) {
      try {
        const storedRequestId = sessionStorage.getItem(requestStorageKey);
        requestId = storedRequestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(storedRequestId)
          ? storedRequestId
          : undefined;
      } catch (error) {
        console.warn('Failed to read extension checkout request ID:', error);
      }
      requestId ??= crypto.randomUUID();
      extensionCheckoutRequestIds.current.set(requestScope, requestId);
      try {
        sessionStorage.setItem(requestStorageKey, requestId);
      } catch (error) {
        console.warn('Failed to save extension checkout request ID:', error);
      }
    }
    setExtendProcessing(true);

    try {
      let data: { url?: string | null } | null;
      {

        if (!extendTarget.licenseId) throw new Error('The license ID is unavailable.');
        data = await createStripeExtensionCheckoutThroughWorker({
          licenseId: extendTarget.licenseId,
          months: extendSelectedPlan.months,
          requestId,
        });
      }

      if (!data?.url) throw new Error('Failed to create checkout session');

      // Track pending checkout
      setPendingCheckout(extendTarget.fanmarkId,
        requestId, user?.id);

      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (extendError) {
      console.error('Error creating checkout session:', extendError);
      const message = extendError instanceof Error ? extendError.message : null;
      toast({
        title: t('dashboard.extendDialog.errorTitle'),
        description: message
          ? t('dashboard.extendDialog.errorDescription', { message })
          : t('dashboard.extendDialog.errorDescriptionFallback'),
        variant: 'destructive',
      });
      setExtendProcessing(false);
    }
  };

  useEffect(() => {
    const locationState = location.state as DashboardLocationState | null;
    let nextPrefill = locationState?.prefillFanmark;
    const requestScroll = Boolean(locationState?.scrollToSearch);
    let shouldClearState = Boolean(locationState);

    // Check for extension URL parameters
    const extensionStatus = searchParams.get('extension');

    if (extensionStatus === 'success') {
      if (!user) return;
      const pending = getPendingCheckout();
      if (!pending?.requestId || pending.userId !== user.id || pending.fanmarkId !== searchParams.get('fanmarkId')) {
        setExtensionConfirmation('timeout');
      }
      // Checkout redirect is not proof that the signed application has committed.
      navigate(location.pathname, { replace: true });
    } else if (extensionStatus === 'canceled') {
      clearPendingCheckout();
      toast({
        title: t('dashboard.canceledTitle'),
        description: t('dashboard.canceledDescription'),
      });
      // Clear URL parameter
      navigate(location.pathname, { replace: true });
      return;
    }

    if (!nextPrefill) {
      try {
        const stored = localStorage.getItem('fanmark.prefill');
        if (stored) {
          nextPrefill = stored;
          localStorage.removeItem('fanmark.prefill');
        }
      } catch (error) {
        console.warn('Failed to access localStorage for fanmark prefill:', error);
      }
    }

    if (nextPrefill) {
      setPrefilledEmoji(nextPrefill);
      setActiveTab('acquisition');
      shouldClearState = true;
    }

    if (requestScroll) {
      setActiveTab('acquisition');
      setShouldScrollToSearch(true);
      shouldClearState = true;
    }

    if (shouldClearState) {
      navigate(location.pathname, { replace: true });
    }
  }, [location, navigate, setActiveTab, toast, t, user, searchParams, getPendingCheckout, clearPendingCheckout]);

  useEffect(() => {
    if (!shouldScrollToSearch) return;

    // ensure acquisition tab is active so the search section mounts
    setActiveTab('acquisition');
  }, [shouldScrollToSearch, setActiveTab]);

  useEffect(() => {
    if (!fanmarksError) return;
    toast({ title: t('dashboard.errorLoadingData'), description: t('dashboard.failedToLoadFanmarks'), variant: 'destructive' });
  }, [fanmarksError, t, toast]);

  useEffect(() => {
    if (!user) return;
    const pending = getPendingCheckout();
    if (!pending?.requestId || pending.userId !== user.id) return;
    const controller = new AbortController();
    setExtensionConfirmation('pending');
    void waitForStripeExtensionApplication(pending.requestId, pending.fanmarkId, { signal: controller.signal })
      .then(async (result) => {
        if (controller.signal.aborted) return;
        if (result.status === 'applied') {
          const refreshed = await fetchFanmarks();
          if (controller.signal.aborted) return;
          if (!refreshed) throw new Error('extension_refresh_unavailable');
          toast({ title: t('dashboard.paymentSuccessTitle'), description: t('dashboard.paymentSuccessDescription') });
        } else {
          toast({ title: t('dashboard.extensionConfirmation.failed'), variant: 'destructive' });
        }
        clearPendingCheckout();
        clearExtensionCheckoutRequestIds();
        extensionCheckoutRequestIds.current.clear();
        setExtensionConfirmation(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setExtensionConfirmation('timeout');
      });
    return () => controller.abort();
  }, [user, fetchFanmarks, t, toast, getPendingCheckout, clearPendingCheckout, extensionConfirmationRetry]);

  const gracePeriodDaysSetting = lifecycleSettings.grace_period_days;

  // Fetch total access count for all fanmarks (available for all plans)
  useEffect(() => {
    const fetchTotalAccessCount = async () => {
      if (!user) {
        setAccessCountLoading(false);
        return;
      }

      try {
        setAccessCountLoading(true);

        {
          const total = await fetchFanmarkAnalyticsSummaryWorker({ days: 30 });
          setTotalAccessCount(total);
          return;
        }

        // Filter to only active fanmarks (exclude grace/expired status)

        // If no active fanmarks, set count to 0

        // Get date range for last 30 days

      } catch (err) {
        console.error('Failed to fetch access count:', err);
        setTotalAccessCount(0);
      } finally {
        setAccessCountLoading(false);
      }
    };

    fetchTotalAccessCount();
  }, [user, fanmarks, gracePeriodDaysSetting]);

  const getLicenseTiming = useCallback((licenseData: Fanmark['fanmark_licenses']) => {
    return deriveLicenseTiming({
      licenseEnd: licenseData?.license_end ?? null,
      graceExpiresAt: licenseData?.grace_expires_at ?? null,
      status: licenseData?.status ?? null,
      gracePeriodDays: gracePeriodDaysSetting,
      isReturned: licenseData?.is_returned ?? null,
    });
  }, [gracePeriodDaysSetting]);

  // Helper function to determine if a fanmark is inactive/expired
  const isFanmarkInactive = (fanmark: Fanmark) => {
    const licenseData = fanmark.fanmark_licenses;
    const timing = getLicenseTiming(licenseData);
    return timing.status === 'expired';
  };

  // Helper function to determine if a fanmark is returned/expired
  const isReturned = (fanmark: Fanmark) => {
    const licenseData = fanmark.fanmark_licenses;
    return Boolean(licenseData?.is_returned);
  };

  const dedupedFanmarks = useMemo(() => {
    const map = new Map<string, Fanmark>();
    fanmarks.forEach((fanmark) => {
      const key = fanmark.emoji_key || fanmark.id;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, fanmark);
        return;
      }

      const existingTiming = getLicenseTiming(existing.fanmark_licenses as Fanmark['fanmark_licenses']);
      const currentTiming = getLicenseTiming(fanmark.fanmark_licenses as Fanmark['fanmark_licenses']);
      const existingWeight = LICENSE_STATUS_WEIGHT[existingTiming.status] ?? Number.MAX_SAFE_INTEGER;
      const currentWeight = LICENSE_STATUS_WEIGHT[currentTiming.status] ?? Number.MAX_SAFE_INTEGER;

      if (currentWeight < existingWeight) {
        map.set(key, fanmark);
        return;
      }

      if (currentWeight === existingWeight) {
        const existingDate = parseDateString((existing.fanmark_licenses)?.license_start)?.getTime() ?? 0;
        const currentDate = parseDateString((fanmark.fanmark_licenses)?.license_start)?.getTime() ?? 0;
        if (currentDate > existingDate) {
          map.set(key, fanmark);
        }
      }
    });

    return Array.from(map.values());
  }, [fanmarks, getLicenseTiming]);

  const activeFanmarks = dedupedFanmarks.filter(f => {
    const licenseData = f.fanmark_licenses;
    const timing = getLicenseTiming(licenseData);
    return timing.status === 'active' && !isReturned(f);
  }).length;

  const shouldBlockGraceExtension = useCallback(
    (timing: LicenseTimingResult) => {
      if (isUnlimited) return false;
      if (fanmarkLimit <= 0) return true;
      return (timing.status === 'grace' || timing.status === 'grace-return') && activeFanmarks >= fanmarkLimit;
    },
    [activeFanmarks, fanmarkLimit, isUnlimited],
  );

  const filteredFanmarks = useMemo(() => {
    const sorted = [...dedupedFanmarks].sort((a, b) => {
      const aLicenseData = a.fanmark_licenses;
      const bLicenseData = b.fanmark_licenses;
      const aTiming = getLicenseTiming(aLicenseData);
      const bTiming = getLicenseTiming(bLicenseData);

      const aWeight = LICENSE_STATUS_WEIGHT[aTiming.status] ?? Number.MAX_SAFE_INTEGER;
      const bWeight = LICENSE_STATUS_WEIGHT[bTiming.status] ?? Number.MAX_SAFE_INTEGER;

      if (aWeight !== bWeight) {
        return aWeight - bWeight;
      }

      // Within the same status, sort by acquisition date (newest first)
      const aAcquisitionDate = parseDateString(aLicenseData?.license_start);
      const bAcquisitionDate = parseDateString(bLicenseData?.license_start);
      const aAcquisition = aAcquisitionDate ? aAcquisitionDate.getTime() : 0;
      const bAcquisition = bAcquisitionDate ? bAcquisitionDate.getTime() : 0;
      return bAcquisition - aAcquisition;
    });

    return sorted;
  }, [dedupedFanmarks, getLicenseTiming]);

  const handleRequireAuth = (emoji: string) => {
    try {
      localStorage.setItem('fanmark.prefill', emoji);
    } catch (error) {
      console.warn('Failed to persist fanmark prefill before auth redirect:', error);
    }
    navigate('/auth', { state: { prefillFanmark: emoji } });
  };
  return {
    toast,
    t,
    navigate,
    location,
    fanmarkLimit,
    isUnlimited,
    favoriteCount,
    favoritesLoading,
    getPendingCheckout,
    canAccessAnalytics,
    extensionConfirmation,
    setExtensionConfirmationRetry,
    loading,
    activeTab,
    setActiveTab,
    prefilledEmoji,
    setPrefilledEmoji,
    shouldScrollToSearch,
    setShouldScrollToSearch,
    returningFanmarkId,
    returningFanmarkEmoji,
    returnDialogOpen,
    setReturnDialogOpen,
    returnTargetFanmark,
    setReturnTargetFanmark,
    extendDialogOpen,
    setExtendDialogOpen,
    extendTarget,
    setExtendTarget,
    extendSelectedPlan,
    setExtendSelectedPlan,
    extendProcessing,
    totalAccessCount,
    accessCountLoading,
    paymentWarningDate,
    showPaymentWarning,
    transferCodeData,
    hasActiveTransfer,
    getTransferStatus,
    refetchTransfer,
    transferDialogOpen,
    setTransferDialogOpen,
    transferTargetFanmark,
    openTransferDialog,
    handleOpenSettings,
    openReturnDialog,
    handleConfirmReturn,
    openExtendDialog,
    handleChangePlan,
    handleExtendSubmit,
    fetchFanmarks,
    getLicenseTiming,
    isFanmarkInactive,
    isReturned,
    activeFanmarks,
    shouldBlockGraceExtension,
    filteredFanmarks,
    handleRequireAuth,
  };
}
