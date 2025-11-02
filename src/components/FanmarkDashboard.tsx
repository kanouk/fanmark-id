import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { formatInTimeZone } from 'date-fns-tz';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { Search, Eye, Edit, Settings, Trash2, ExternalLink, Copy, Undo2, QrCode, MoreVertical, Heart } from 'lucide-react';
import { FiTarget, FiLayers, FiCompass, FiStar, FiCheckCircle, FiMoon, FiUser, FiLink, FiFileText, FiClock } from 'react-icons/fi';
import { FanmarkAcquisition } from './FanmarkAcquisition';
import { ExtendLicenseDialog, type ExtendLicenseTarget, type ExtendPlanOption } from './ExtendLicenseDialog';
import { FanmarkReturnLoading } from './FanmarkReturnLoading';
// Using Undo2 for return/return action
import { supabase } from '@/integrations/supabase/client';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useFanmarkLimit } from '@/hooks/useFanmarkLimit';
import { useFavoriteFanmarks } from '@/hooks/useFavoriteFanmarks';
import { navigateToFanmark, getFanmarkUrlForClipboard } from '@/utils/emojiUrl';
import { parseDateString } from '@/lib/utils';
import { deriveLicenseTiming, type LicenseTimingResult } from '@/lib/licenseTiming';
import { resolveFanmarkDisplay } from '@/lib/emojiConversion';

const LICENSE_STATUS_WEIGHT: Record<LicenseTimingResult['status'], number> = {
  active: 0,
  'grace-return': 2,
  grace: 3,
  expired: 4,
};

const ACTIVE_TAB_STORAGE_KEY = 'fanmark-dashboard:active-tab';

const formatCountdown = (target: Date | string | null) => {
  if (!target) return '00:00:00';
  const targetDate = target instanceof Date ? target : parseDateString(target);
  if (!targetDate) return '00:00:00';
  const diffMs = targetDate.getTime() - Date.now();
  if (diffMs <= 0) return '00:00:00';
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

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
  user_id: string;
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

interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
}

interface DashboardLocationState {
  prefillFanmark?: string;
  scrollToSearch?: boolean;
}

interface ExtendLicenseResponse {
  success: boolean;
  license?: {
    id: string;
    license_end: string | null;
    grace_expires_at: string | null;
    status: string | null;
  } | null;
  price_yen?: number;
  tier_level?: number;
}

export const FanmarkDashboard = () => {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { toast } = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { settings } = useSystemSettings();
  const { limit: fanmarkLimit, isUnlimited } = useFanmarkLimit();
  const { count: favoriteCount, isLoading: favoritesLoading } = useFavoriteFanmarks({
    enabled: Boolean(user),
  });

  const [fanmarks, setFanmarks] = useState<Fanmark[]>([]);
  const [loading, setLoading] = useState(true);
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
      const { data, error } = await supabase.functions.invoke('return-fanmark', {
        body: { fanmark_id: fanmarkId },
      });

      if (error) {
        throw error;
      }

      toast({
        title: t('dashboard.returnSuccess'),
        description: t('dashboard.returnSuccessDescription'),
      });

      await fetchFanmarks();
    } catch (error: any) {
      console.error('Error returning fanmark via function:', error);
      const desc = error?.message || t('dashboard.returnErrorDescription');
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
    const licenseData = fanmark.fanmark_licenses;
    setExtendTarget({
      fanmarkId: fanmark.id,
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

  const handleChangePlan = (plan: ExtendPlanOption | null) => {
    setExtendSelectedPlan(plan);
  };

  const handleExtendSubmit = async () => {
    if (!extendTarget || !extendSelectedPlan) return;
    setExtendProcessing(true);

    try {
      const { data, error } = await supabase.functions.invoke<ExtendLicenseResponse>('extend-fanmark-license', {
        body: {
          fanmark_id: extendTarget.fanmarkId,
          months: extendSelectedPlan.months,
        },
      });

      if (error) {
        throw new Error(error.message ?? 'extend-fanmark-license failed');
      }

      const updatedLicense = data?.license;
      const extendedUntil = updatedLicense?.license_end
        ? formatInTimeZone(new Date(updatedLicense.license_end), 'Asia/Tokyo', 'yyyy/MM/dd')
        : null;

      const priceYen = data?.price_yen ?? extendSelectedPlan.price;

      toast({
        title: t('dashboard.extendDialog.successTitle'),
        description: extendedUntil
          ? t('dashboard.extendDialog.successDescriptionWithDate', {
              months: extendSelectedPlan.months,
              date: extendedUntil,
            })
          : t('dashboard.extendDialog.successDescription', {
              months: extendSelectedPlan.months,
            }),
      });

      await fetchFanmarks();
      setExtendDialogOpen(false);
      setExtendTarget(null);
      setExtendSelectedPlan(null);
    } catch (extendError) {
      console.error('Error extending fanmark license:', extendError);
      const message = extendError instanceof Error ? extendError.message : null;
      toast({
        title: t('dashboard.extendDialog.errorTitle'),
        description: message
          ? t('dashboard.extendDialog.errorDescription', { message })
          : t('dashboard.extendDialog.errorDescriptionFallback'),
        variant: 'destructive',
      });
    } finally {
      setExtendProcessing(false);
    }
  };

  useEffect(() => {
    const locationState = location.state as DashboardLocationState | null;
    let nextPrefill = locationState?.prefillFanmark;
    const requestScroll = Boolean(locationState?.scrollToSearch);
    let shouldClearState = Boolean(locationState);

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
  }, [location, navigate, setActiveTab]);

  useEffect(() => {
    if (!shouldScrollToSearch) return;

    // ensure acquisition tab is active so the search section mounts
    setActiveTab('acquisition');
  }, [shouldScrollToSearch, setActiveTab]);

  const fetchFanmarks = useCallback(async () => {
    try {
      // First, get the licenses and fanmarks
      const { data: licenses, error: licensesError } = await supabase
        .from('fanmark_licenses')
        .select(`
          id,
          fanmark_id,
          license_start,
          license_end,
          grace_expires_at,
          status,
          is_returned,
          excluded_at,
          plan_excluded,
          created_at,
          fanmarks (
            id,
            user_input_fanmark,
            emoji_ids,
            normalized_emoji,
            short_id,
            status,
            created_at,
            updated_at,
            tier_level
          )
        `)
        .eq('user_id', user?.id)
        .in('status', ['active', 'expired', 'grace'])
        .order('created_at', { ascending: false });

      if (licensesError) throw licensesError;

      if (!licenses || licenses.length === 0) {
        setFanmarks([]);
        return;
      }

      // Get all license IDs to fetch configs
      const licenseIds = licenses.map(license => license.id).filter(Boolean);

      // Fetch basic configs for all licenses
      const { data: basicConfigs, error: configError } = await supabase
        .from('fanmark_basic_configs')
        .select('license_id, access_type, fanmark_name')
        .in('license_id', licenseIds);

      if (configError) {
        console.warn('Error fetching basic configs:', configError);
      }

      // Create lookup maps for configs
      const basicConfigMap = new Map((basicConfigs || []).map(config => [config.license_id, config]));

      // Process fanmarks with their configs
      const fanmarksWithDefaults = licenses
        .map((license) => {
          const fanmark = license.fanmarks as unknown as {
            id: string;
            user_input_fanmark?: string | null;
            emoji_ids?: (string | null)[] | null;
            normalized_emoji?: string | null;
            short_id: string;
            status: string;
            created_at: string;
            updated_at: string;
            tier_level?: number | null;
          } | null;

          if (!fanmark) {
            return null;
          }

          const rawEmojiIds = Array.isArray(fanmark.emoji_ids)
            ? (fanmark.emoji_ids as (string | null)[]).filter((value): value is string => Boolean(value))
            : [];
          const fallbackEmojiString =
            (typeof fanmark.user_input_fanmark === 'string' && fanmark.user_input_fanmark.length > 0
              ? fanmark.user_input_fanmark
              : null) ??
            (typeof fanmark.normalized_emoji === 'string' && fanmark.normalized_emoji.length > 0
              ? fanmark.normalized_emoji
              : null) ??
            '';
          const userInputValue =
            typeof fanmark.user_input_fanmark === 'string' && fanmark.user_input_fanmark.length > 0
              ? fanmark.user_input_fanmark
              : '';
          const resolvedDisplay = resolveFanmarkDisplay(userInputValue || fallbackEmojiString, rawEmojiIds);
          const displayFanmark = resolvedDisplay || userInputValue;
          const emojiKey = rawEmojiIds.length > 0
            ? rawEmojiIds.join(':')
            : resolvedDisplay || userInputValue || fanmark.id;
          const basicConfig = basicConfigMap.get(license.id);

          return {
            ...fanmark,
            user_input_fanmark: userInputValue,
            emoji_ids: rawEmojiIds,
            fanmark: displayFanmark,
            emoji_key: emojiKey,
            // Fill in required properties from Fanmark interface
            access_type: basicConfig?.access_type || 'inactive',
            fanmark_name: basicConfig?.fanmark_name || displayFanmark || userInputValue || '',
            license_id: license.id,
            tier_level: typeof fanmark.tier_level === 'number' ? fanmark.tier_level : null,
            current_license_id: license.id,
            is_transferable: true, // Default value
            user_id: '', // Not available in new schema
            // Add license information for compatibility
            current_license: {
              id: license.id,
              license_start: license.license_start,
              license_end: license.license_end,
              status: license.status,
              created_at: license.created_at,
            },
            fanmark_licenses: {
              license_start: license.license_start,
              license_end: license.license_end,
              grace_expires_at: license.grace_expires_at,
              status: license.status,
              is_returned: license.is_returned ?? false,
              excluded_at: license.excluded_at ?? null,
              excluded_from_plan: license.plan_excluded ? String(license.plan_excluded) : null,
            },
          } as Fanmark;
        })
        .filter((item): item is Fanmark => item !== null);
      
      setFanmarks(fanmarksWithDefaults);
    } catch (error) {
      console.error('Error fetching fanmarks:', error);
      toast({
        title: t('dashboard.errorLoadingData'),
        description: t('dashboard.failedToLoadFanmarks'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [t, toast, user?.id]);

  useEffect(() => {
    if (!user) return;
    fetchFanmarks();
  }, [fetchFanmarks, user]);

  const gracePeriodDaysSetting = settings?.grace_period_days ?? null;

  const getLicenseTiming = (licenseData: Fanmark['fanmark_licenses']) => {
    return deriveLicenseTiming({
      licenseEnd: licenseData?.license_end ?? null,
      graceExpiresAt: licenseData?.grace_expires_at ?? null,
      status: licenseData?.status ?? null,
      gracePeriodDays: gracePeriodDaysSetting,
      isReturned: licenseData?.is_returned ?? null,
    });
  };

  const getStatusBadge = (timing: LicenseTimingResult) => {
    let icon = <FiMoon className="h-3.5 w-3.5" />;
    let className = 'border-gray-200/60 bg-gray-50 text-gray-600 shadow-sm';
    let label = t('dashboard.statusUnknown');

    switch (timing.status) {
      case 'active':
        icon = <FiCheckCircle className="h-3.5 w-3.5" />;
        className = 'border-emerald-200/60 bg-emerald-50 text-emerald-600 shadow-sm';
        label = t('dashboard.statusActive');
        break;
      case 'grace-return':
        icon = <FiTarget className="h-3.5 w-3.5" />;
        className = 'border-amber-200/60 bg-amber-50 text-amber-600 shadow-sm';
        label = t('dashboard.statusReturnProcessing');
        break;
      case 'grace':
        icon = <FiTarget className="h-3.5 w-3.5" />;
        className = 'border-amber-200/60 bg-amber-50 text-amber-600 shadow-sm';
        label = t('dashboard.statusGrace');
        break;
      case 'expired':
      default:
        icon = <FiTarget className="h-3.5 w-3.5" />;
        className = 'border-rose-200/60 bg-rose-50 text-rose-600 shadow-sm';
        label = t('dashboard.statusExpired');
        break;
    }

    return (
      <Badge className={`${className} inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide whitespace-nowrap`}>
        {icon}
        <span>{label}</span>
      </Badge>
    );
  };

  // Helper function to determine if a fanmark is inactive/expired
  const isFanmarkInactive = (fanmark: Fanmark) => {
    const licenseData = fanmark.fanmark_licenses as any;
    const timing = getLicenseTiming(licenseData);
    return timing.status === 'expired';
  };

  // Helper function to determine if a fanmark is returned/expired
  const isReturned = (fanmark: Fanmark) => {
    const licenseData = fanmark.fanmark_licenses as any;
    return Boolean(licenseData?.is_returned);
  };

  const getTierOvalStyle = (tierLevel: number): string => {
    switch (tierLevel) {
      case 4: // S Tier - Gold/Platinum
        return "bg-gradient-to-br from-amber-200 via-yellow-100 to-amber-300 border-[3px] border-amber-500 shadow-lg hover:shadow-xl transition-all duration-300 tier-s-shine";
      case 3: // A Tier - Purple/Violet
        return "bg-gradient-to-br from-purple-200 via-violet-200 to-purple-300 border-[2.5px] border-purple-500 shadow-md hover:shadow-lg transition-all duration-300 tier-a-glow";
      case 2: // B Tier - Blue/Cyan
        return "bg-gradient-to-br from-blue-100 via-cyan-100 to-blue-200 border-2 border-blue-400 shadow-sm hover:shadow-md transition-all duration-300";
      case 1: // C Tier - Green/White
        return "bg-gradient-to-br from-emerald-50 via-white to-emerald-100 border border-emerald-300 shadow-sm hover:shadow transition-all duration-300";
      default:
        return "bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200";
    }
  };

  const getTierBadgeStyle = (tierLevel: number): string => {
    switch (tierLevel) {
      case 4: // S Tier - Gold gradient
        return "bg-gradient-to-br from-amber-500 to-yellow-600 text-white border border-amber-600";
      case 3: // A Tier - Purple gradient
        return "bg-gradient-to-br from-purple-500 to-violet-600 text-white border border-purple-600";
      case 2: // B Tier - Blue gradient
        return "bg-gradient-to-br from-blue-500 to-cyan-600 text-white border border-blue-600";
      case 1: // C Tier - Green gradient
        return "bg-gradient-to-br from-emerald-500 to-green-600 text-white border border-emerald-600";
      default:
        return "bg-foreground text-background";
    }
  };

  const getTierLabel = (tierLevel: number | null | undefined) => {
    switch (tierLevel) {
      case 1:
        return 'C';
      case 2:
        return 'B';
      case 3:
        return 'A';
      case 4:
        return 'S';
      default:
        return '—';
    }
  };

  const getAccessTypeBadge = (accessType: string) => {
    let IconComponent = FiMoon;
    let label = t('dashboard.accessTypes.inactive');

    if (accessType === 'profile') {
      IconComponent = FiUser;
      label = t('dashboard.accessTypes.profile');
    } else if (accessType === 'redirect') {
      IconComponent = FiLink;
      label = t('dashboard.accessTypes.redirect');
    } else if (accessType === 'text') {
      IconComponent = FiFileText;
      label = t('dashboard.accessTypes.text');
    }

    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground">
        <IconComponent className="h-3 w-3 text-foreground" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
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
        const existingDate = parseDateString((existing.fanmark_licenses as any)?.license_start)?.getTime() ?? 0;
        const currentDate = parseDateString((fanmark.fanmark_licenses as any)?.license_start)?.getTime() ?? 0;
        if (currentDate > existingDate) {
          map.set(key, fanmark);
        }
      }
    });

    return Array.from(map.values());
  }, [fanmarks, gracePeriodDaysSetting]);

  const activeFanmarks = dedupedFanmarks.filter(f => {
    const licenseData = f.fanmark_licenses as any;
    const timing = getLicenseTiming(licenseData);
    return timing.status === 'active' && !isReturned(f);
  }).length;

  const filteredFanmarks = useMemo(() => {
    const sorted = [...dedupedFanmarks].sort((a, b) => {
      const aLicenseData = a.fanmark_licenses as any;
      const bLicenseData = b.fanmark_licenses as any;
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
  }, [dedupedFanmarks, gracePeriodDaysSetting]);

  const handleRequireAuth = (emoji: string) => {
    try {
      localStorage.setItem('fanmark.prefill', emoji);
    } catch (error) {
      console.warn('Failed to persist fanmark prefill before auth redirect:', error);
    }
    navigate('/auth', { state: { prefillFanmark: emoji } });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      </div>
    );
  }

  return (
    <section className="w-full bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
      <div className="container mx-auto px-4 py-12 space-y-10">
        <div className="space-y-3 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {t('dashboard.title')}
          </h1>
          <p className="mx-auto max-w-2xl text-sm sm:text-base text-muted-foreground">
            {t('dashboard.subtitle')}
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="relative overflow-hidden rounded-3xl border border-primary/25 bg-background/85 shadow-[0_15px_40px_rgba(101,195,200,0.16)] backdrop-blur">
            <CardContent className="flex h-full flex-col p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('dashboard.stats.yourFanmarks')}
                  </p>
                   <div className="flex items-baseline gap-3">
                     <span className="text-3xl font-bold text-primary">
                       {activeFanmarks}/{isUnlimited ? '∞' : fanmarkLimit}
                     </span>
                   </div>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <FiTarget className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-4 w-full overflow-hidden rounded-full bg-muted h-2.5">
                 <div 
                   className="bg-primary h-2.5 rounded-full transition-all duration-500"
                   style={{ width: `${isUnlimited ? 0 : Math.min((activeFanmarks / fanmarkLimit) * 100, 100)}%` }}
                 />
              </div>
              <div className="mt-auto flex justify-end pt-4">
                <button
                  type="button"
                  onClick={() => navigate('/plans', { state: { from: location.pathname } })}
                  className="text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  {t('dashboard.stats.upgradePlan')}
                </button>
              </div>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden rounded-3xl border border-primary/25 bg-background/85 shadow-[0_15px_40px_rgba(101,195,200,0.16)] backdrop-blur">
            <CardContent className="flex h-full flex-col p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('dashboard.stats.favoriteFanmarks')}
                  </p>
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold text-primary">
                      {favoritesLoading ? '—' : favoriteCount}
                    </span>
                  </div>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Heart className="h-6 w-6" />
                </div>
              </div>
              <div className="mt-auto flex justify-end pt-4">
                <button
                  type="button"
                  onClick={() => navigate('/favorites', { state: { from: location.pathname } })}
                  className="text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  {t('dashboard.stats.viewFavorites')}
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Additional stats cards... */}
        </div>

        {/* Main Content */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-8">
          <TabsList className="grid w-full grid-cols-2 gap-2 rounded-full border border-primary/20 bg-background/70 p-2 backdrop-blur">
            <TabsTrigger 
              value="my-fanmarks"
              className="gap-2 rounded-full py-3 px-4 text-base font-medium transition-all duration-200 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
            >
              <FiLayers className="h-5 w-5" />
              {t('dashboard.tabs.myFanmarks')}
            </TabsTrigger>
            <TabsTrigger 
              value="acquisition"
              className="gap-2 rounded-full py-3 px-4 text-base font-medium transition-all duration-200 data-[state=active]:bg-primary/15 data-[state=active]:text-foreground data-[state=active]:shadow-lg"
            >
              <FiCompass className="h-5 w-5" />
              {t('dashboard.tabs.getFanma')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-fanmarks" className="space-y-6">
            {/* Fanmarks List */}
            <Card className="rounded-3xl border border-primary/15 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur">
              <CardHeader className="px-6 pt-8 pb-6">
                <CardTitle>
                  <div className="space-y-3 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <FiLayers className="h-6 w-6" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground">
                      {t('dashboard.yourFanmarks')}
                    </h3>
                    <p className="mx-auto max-w-xl text-sm text-muted-foreground">
                      {t('dashboard.manageFanmarks')}
                    </p>
                  </div>
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-12 px-6 pb-6">
                {filteredFanmarks.length === 0 ? (
                  <div className="py-14 text-center">
                    <div className="space-y-6">
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <FiLayers className="h-8 w-8" />
                      </div>
                      <h3 className="text-xl font-semibold text-foreground">
                        {t('dashboard.noFanmarksYet')}
                      </h3>
                      <p className="mx-auto max-w-md text-muted-foreground">
                        {t('dashboard.getStarted')}
                      </p>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            size="lg"
                            className="mt-6 gap-2 rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-300 hover:shadow-xl hover:scale-105"
                          >
                            <FiStar className="h-5 w-5" />
                            {t('dashboard.createFirstFanma')}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>{t('dashboard.createFirstFanma')}</DialogTitle>
                            <DialogDescription>
                              {t('dashboard.createFanmarkDescription')}
                            </DialogDescription>
                          </DialogHeader>
                <FanmarkAcquisition
                  prefilledEmoji={prefilledEmoji}
                  fanmarkLimit={isUnlimited ? -1 : fanmarkLimit}
                  currentCount={activeFanmarks}
                  rememberSearch
                  scrollToSearch={shouldScrollToSearch}
                  onSearchScrolled={() => setShouldScrollToSearch(false)}
                  onObtain={() => {
                    setPrefilledEmoji(undefined);
                    fetchFanmarks();
                    setActiveTab('my-fanmarks');
                  }}
                  onRequireAuth={handleRequireAuth}
                />
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Desktop Table View */}
                    <div className="hidden lg:block">
                      <div className="rounded-2xl border border-primary/10 bg-background/50">
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[920px]">
                            <thead>
                              <tr className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b border-primary/10">
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.fanmark')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.fanmarkId')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.accessType')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.acquisitionDate')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.returnDate')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.remainingDays')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-4 py-3">{t('dashboard.status')}</th>
                                <th className="text-left px-3 py-3 w-12"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredFanmarks.map((fanmark, idx) => {
                                const licenseData = fanmark.fanmark_licenses;
                                const acquisitionDateValue = parseDateString(licenseData?.license_start);
                                const acquisitionDate = acquisitionDateValue ? formatInTimeZone(acquisitionDateValue, 'Asia/Tokyo', 'yyyy/MM/dd') : '-';
                                const timing = getLicenseTiming(licenseData);
                                const expirationDateUTC = timing.licenseEndDate;
                                const msRemaining = timing.remainingMs;
                                const daysRemaining = timing.remainingWholeDays;
                                const isExpiringSoon = msRemaining !== null && msRemaining > 0 && msRemaining <= 3 * 24 * 60 * 60 * 1000;
                                const timeDisplayClass = `font-medium whitespace-nowrap text-sm ${isExpiringSoon ? 'text-destructive' : 'text-foreground'}`;
                                const canNavigateToSettings = timing.status === 'active' || timing.status === 'grace';
                                const handleRowNavigation = () => {
                                  if (!canNavigateToSettings || isReturned(fanmark)) return;
                                  navigate(`/fanmarks/${fanmark.id}/settings`);
                                };
                                const isGraceReturn = timing.status === 'grace-return';
                                const hasPerpetualLicense = !licenseData?.license_end;
                                const canReturn = !isReturned(fanmark) && timing.status === 'active';
                                const canExtend = (['active', 'grace', 'grace-return'].includes(timing.status)) && (!isReturned(fanmark) || isGraceReturn) && !hasPerpetualLicense;

                                const rowKey = `${fanmark.emoji_key}-${fanmark.current_license_id ?? licenseData?.license_end ?? idx}`;
                                const isInactive = isFanmarkInactive(fanmark);
                                const rowVisualState = isInactive
                                  ? 'bg-gray-200/60 dark:bg-gray-700/60 text-muted-foreground/70'
                                  : (timing.status === 'grace' || timing.status === 'grace-return')
                                    ? `${canNavigateToSettings ? 'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50' : 'bg-amber-50/70 dark:bg-amber-950/20'}`
                                    : `${canNavigateToSettings ? 'hover:bg-primary/5 hover:shadow-sm' : ''}`;
                                const tierOvalStyle = isInactive
                                  ? 'bg-none bg-gray-200 border border-gray-300 text-muted-foreground/70 hover:scale-100 saturate-0'
                                  : getTierOvalStyle(fanmark.tier_level || 1);
                                const tierBadgeStyle = isInactive
                                  ? 'bg-gray-300 text-muted-foreground border border-gray-400'
                                  : getTierBadgeStyle(fanmark.tier_level);
                                const primaryTextClass = isInactive ? 'text-muted-foreground/70' : 'text-foreground';
                                const countdownClass = isInactive ? 'font-medium whitespace-nowrap text-sm text-muted-foreground/70' : timeDisplayClass;

                                return (
                                  <tr
                                    key={rowKey}
                                    onClick={handleRowNavigation}
                                    className={`relative border-b border-primary/5 transition-all duration-200 after:pointer-events-none after:absolute after:left-0 after:bottom-0 after:h-px after:w-full after:bg-primary/10 ${rowVisualState}`}
                                  >
                                    <td className="relative overflow-visible px-4 py-3">
                                      <div className="min-h-[2.25rem] flex items-end overflow-visible" onClick={(event) => event.stopPropagation()}>
                                        <div
                                          className={`relative flex items-center px-3.5 py-2.5 rounded-md shadow-sm transition-transform ${isInactive ? '' : 'hover:scale-105'} whitespace-nowrap cursor-pointer overflow-visible ${tierOvalStyle}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            navigator.clipboard.writeText(fanmark.fanmark);
                                            toast({
                                              title: t('dashboard.emojiCopiedTitle'),
                                              description: fanmark.fanmark,
                                            });
                                          }}
                                          title={t('dashboard.clickToCopyEmoji')}
                                        >
                                          <span className={`absolute -top-2 -left-2 z-20 rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-widest shadow ${tierBadgeStyle}`}>
                                            {getTierLabel(fanmark.tier_level)}
                                          </span>
                                          <span className="text-2xl leading-none select-none" style={{ letterSpacing: '0.2em' }}>{fanmark.fanmark}</span>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="min-h-[2.25rem] flex items-center" onClick={(event) => event.stopPropagation()}>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <button
                                              type="button"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                navigate(`/f/${fanmark.short_id}`);
                                              }}
                                            className="rounded-md border border-border/50 bg-muted/60 px-2.5 py-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted/80"
                                              aria-label={t('dashboard.viewDetails')}
                                            >
                                              {fanmark.short_id}
                                            </button>
                                          </TooltipTrigger>
                                          <TooltipContent>{t('dashboard.viewDetails')}</TooltipContent>
                                        </Tooltip>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="min-h-[2.25rem] flex items-center min-w-fit">
                                        {!isFanmarkInactive(fanmark) && timing.status === 'active' && getAccessTypeBadge(fanmark.access_type)}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="min-h-[2.25rem] flex items-center">
                                        <div className={`text-sm font-medium ${primaryTextClass}`}>
                                          {acquisitionDate}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className={`min-h-[2.25rem] flex items-center text-sm font-medium ${primaryTextClass}`}>
                                        {expirationDateUTC ? (
                                          <span>{formatInTimeZone(expirationDateUTC, 'Asia/Tokyo', 'yyyy/MM/dd')}</span>
                                        ) : (
                                          <span className="text-muted-foreground">{t('dashboard.perpetualLicense')}</span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 align-middle">
                                      <div className="relative min-h-[2.25rem] flex items-center gap-1.5">
                                        {(timing.status === 'grace' || timing.status === 'grace-return') && timing.graceExpiresDate ? (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className={`${countdownClass} ${isInactive ? '' : 'text-destructive underline decoration-dotted underline-offset-4'}`}>
                                                {t('dashboard.countdown', { time: formatCountdown(timing.graceExpiresDate) })}
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent className="rounded-2xl border border-rose-200 bg-rose-100 px-4 py-2 text-[0.7rem] font-medium text-rose-900 shadow-lg">
                                              {t('dashboard.extendHint')}
                                            </TooltipContent>
                                          </Tooltip>
                                        ) : timing.status === 'active' && expirationDateUTC ? (
                                          <div className={countdownClass}>
                                            {t('dashboard.daysRemaining', { days: Math.max(daysRemaining ?? 0, 0) })}
                                          </div>
                                        ) : isReturned(fanmark) ? (
                                          <span className="text-muted-foreground text-sm">{t('dashboard.returned')}</span>
                                        ) : (
                                          <span className="text-muted-foreground text-sm">-</span>
                                        )}
                                        {/* Bubble removed per design */}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="min-h-[2.25rem] flex items-center gap-1 min-w-fit">
                                        <span className={isInactive ? 'opacity-60 saturate-50' : ''}>{getStatusBadge(timing)}</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                                      <div className="flex items-center">
                                        <DropdownMenu>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <DropdownMenuTrigger asChild>
                                                <Button
                                                  size="sm"
                                                  variant="ghost"
                                                  type="button"
                                                  onClick={(event) => event.stopPropagation()}
                                                  className="h-9 w-9 rounded-md border border-border/60 bg-background/50 text-foreground hover:bg-background transition-colors"
                                                  aria-label={t('dashboard.actionsMenu')}
                                                >
                                                  <MoreVertical className="h-5 w-5" />
                                                </Button>
                                              </DropdownMenuTrigger>
                                            </TooltipTrigger>
                                            <TooltipContent>{t('dashboard.actionsMenu')}</TooltipContent>
                                          </Tooltip>
                                          <DropdownMenuContent align="end" sideOffset={8} collisionPadding={16} className="w-48">
                                            <DropdownMenuItem
                                              onSelect={(event) => { event.preventDefault(); event.stopPropagation(); navigateToFanmark(fanmark.fanmark, true); }}
                                              className="gap-2"
                                            >
                                              <ExternalLink className="h-4 w-4 text-primary" />
                                              <span>{t('dashboard.visitFanmarkTooltip')}</span>
                                            </DropdownMenuItem>
                                            {fanmark.short_id && (
                                              <DropdownMenuItem
                                                onSelect={(event) => { event.preventDefault(); event.stopPropagation(); window.open(`/q/${fanmark.short_id}`, '_blank', 'noopener,noreferrer'); }}
                                                className="gap-2"
                                              >
                                                <QrCode className="h-4 w-4 text-primary" />
                                                <span>{t('dashboard.actionsQRCode')}</span>
                                              </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem
                                              onSelect={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                const fullUrl = getFanmarkUrlForClipboard(fanmark.fanmark);
                                                navigator.clipboard.writeText(fullUrl);
                                                toast({
                                                  title: t('dashboard.urlCopiedTitle'),
                                                  description: fullUrl,
                                                });
                                              }}
                                              className="gap-2"
                                            >
                                              <Copy className="h-4 w-4 text-primary" />
                                              <span>{t('dashboard.copyFanmarkLink')}</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                if (!canExtend) return;
                                                openExtendDialog(fanmark, timing);
                                              }}
                                              className="gap-2"
                                              disabled={!canExtend}
                                            >
                                              <FiClock className="h-4 w-4 text-primary" />
                                              <span>{t('dashboard.extendMenuLabel')}</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                if (!canReturn) return;
                                                openReturnDialog(fanmark);
                                              }}
                                              className="gap-2"
                                              disabled={!canReturn}
                                            >
                                              <Undo2 className="h-4 w-4 text-primary" />
                                              <span>{t('dashboard.actionsReturn')}</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                              onSelect={() => handleOpenSettings(fanmark.id)}
                                              className="gap-2"
                                              disabled={isReturned(fanmark) || timing.status !== 'active'}
                                            >
                                              <Settings className="h-4 w-4 text-primary" />
                                              <span>{t('dashboard.actionsSettings')}</span>
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="lg:hidden space-y-4">
                      {filteredFanmarks.map((fanmark, idx) => {
                        const licenseData = fanmark.fanmark_licenses;
                        const acquisitionDateValue = parseDateString(licenseData?.license_start);
                        const acquisitionDate = acquisitionDateValue ? formatInTimeZone(acquisitionDateValue, 'Asia/Tokyo', 'yyyy/MM/dd') : '-';
                        const timing = getLicenseTiming(licenseData);
                        const expirationDate = timing.licenseEndDate;
                        const msRemainingMobile = timing.remainingMs;
                        const daysRemaining = timing.remainingWholeDays;
                        const isExpiringSoon = msRemainingMobile !== null && msRemainingMobile > 0 && msRemainingMobile <= 3 * 24 * 60 * 60 * 1000;
                        const isCountdownActiveMobile = msRemainingMobile !== null && msRemainingMobile > 0 && msRemainingMobile <= 24 * 60 * 60 * 1000;
                        const mobileTimeDisplayClass = `font-medium whitespace-nowrap text-sm ${isExpiringSoon ? 'text-destructive' : 'text-foreground'}`;
                        const isGraceReturn = timing.status === 'grace-return';
                        const hasPerpetualLicense = !licenseData?.license_end;
                        const canReturn = !isReturned(fanmark) && timing.status === 'active';
                        const canExtend = (['active', 'grace', 'grace-return'].includes(timing.status)) && (!isReturned(fanmark) || isGraceReturn) && !hasPerpetualLicense;

                        const cardKey = `${fanmark.id}-${fanmark.current_license_id ?? licenseData?.license_end ?? idx}`;
                        const isInactiveCard = isFanmarkInactive(fanmark);
                        const cardVisualState = isInactiveCard
                          ? 'bg-gray-200/60 dark:bg-gray-700/60 text-muted-foreground/70'
                          : (timing.status === 'grace' || timing.status === 'grace-return')
                            ? 'bg-amber-50 dark:bg-amber-950/30 hover:border-amber-200'
                            : 'bg-background/80 hover:border-primary/20';
                        const mobileTierOvalStyle = isInactiveCard
                          ? 'bg-none bg-gray-200 border border-gray-300 text-muted-foreground/70 hover:scale-100 saturate-0'
                          : getTierOvalStyle(fanmark.tier_level || 1);
                        const mobileTierBadgeStyle = isInactiveCard
                          ? 'bg-gray-300 text-muted-foreground border border-gray-400'
                          : getTierBadgeStyle(fanmark.tier_level);
                        const mobilePrimaryText = isInactiveCard ? 'text-muted-foreground/70' : 'text-foreground';
                        const mobileCountdownClass = isInactiveCard
                          ? 'font-medium whitespace-nowrap text-sm text-muted-foreground/70'
                          : mobileTimeDisplayClass;

                         return (
                          <Card key={cardKey} className={`overflow-visible rounded-3xl border border-primary/10 transition-colors ${cardVisualState}`}>
                            <CardContent className="overflow-visible p-5">
                                  <div className="space-y-3">
                                   <div className="flex items-start justify-between">
                                    <div className="flex items-end overflow-visible">
                                      <div
                                        className={`relative flex items-center px-3 py-2 rounded-md cursor-pointer transition-transform ${isInactiveCard ? '' : 'hover:scale-105'} overflow-visible ${mobileTierOvalStyle}`}
                                        onClick={() => {
                                          navigator.clipboard.writeText(fanmark.fanmark);
                                          toast({
                                            title: t('dashboard.emojiCopiedTitle'),
                                            description: fanmark.fanmark,
                                          });
                                        }}
                                        title={t('dashboard.clickToCopyEmoji')}
                                      >
                                        <span className={`absolute -top-2 -left-2 z-20 rounded-full px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-widest shadow ${mobileTierBadgeStyle}`}>
                                          {getTierLabel(fanmark.tier_level)}
                                        </span>
                                        <span
                                          className="text-3xl leading-none select-none whitespace-nowrap tracking-[0.1em]"
                                          style={{ wordBreak: 'keep-all' }}
                                        >
                                          {fanmark.fanmark}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                      <span className={isInactiveCard ? 'opacity-60 saturate-50' : ''}>{getStatusBadge(timing)}</span>
                                    </div>
                                 </div>

                                 {/* Date Information */}
                               <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm bg-muted/20 rounded-lg p-3">
                                  <div>
                                    <div className="text-xs text-muted-foreground font-semibold mb-1">
                                      {t('dashboard.fanmarkId')}
                                    </div>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          onClick={() => navigate(`/f/${fanmark.short_id}`)}
                                          className="rounded-md border border-border/50 bg-muted/60 px-3 py-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-muted/80"
                                          aria-label={t('dashboard.viewDetails')}
                                        >
                                          {fanmark.short_id}
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent>{t('dashboard.viewDetails')}</TooltipContent>
                                    </Tooltip>
                                  </div>
                                  <div>
                                    <div className="text-xs text-muted-foreground font-semibold mb-1">
                                      {t('dashboard.accessType')}
                                    </div>
                                    <div className={mobilePrimaryText}>
                                      {!isInactiveCard && timing.status === 'active'
                                        ? getAccessTypeBadge(fanmark.access_type)
                                        : <span className="text-muted-foreground text-sm">{t('dashboard.accessTypes.inactive')}</span>}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-muted-foreground font-semibold mb-1">
                                      {t('dashboard.acquisitionDate')}
                                    </div>
                                    <div className={mobilePrimaryText}>{acquisitionDate}</div>
                                  </div>
                                   <div>
                                     <div className="text-xs text-muted-foreground font-semibold mb-1">
                                       {t('dashboard.returnDate')}
                                     </div>
                                     <div className={mobilePrimaryText}>
                                       {expirationDate
                                         ? formatInTimeZone(expirationDate, 'Asia/Tokyo', 'yyyy/MM/dd')
                                         : t('dashboard.perpetualLicense')}
                                     </div>
                                   </div>
                                   <div>
                                     <div className="text-xs text-muted-foreground font-semibold mb-1">
                                       {t('dashboard.remainingDays')}
                                     </div>
                                      <div className="flex items-start justify-between gap-2">
                                        <div>
                                          {(timing.status === 'grace' || timing.status === 'grace-return') && timing.graceExpiresDate ? (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <span className={`${mobileCountdownClass} ${isInactiveCard ? '' : 'text-destructive underline decoration-dotted underline-offset-4'}`}>
                                                  {t('dashboard.countdown', { time: formatCountdown(timing.graceExpiresDate) })}
                                                </span>
                                              </TooltipTrigger>
                                              <TooltipContent className="rounded-2xl border border-rose-200 bg-rose-100 px-4 py-2 text-[0.7rem] font-medium text-rose-900 shadow-lg">
                                                {t('dashboard.extendHint')}
                                              </TooltipContent>
                                            </Tooltip>
                                          ) : timing.status === 'active' && expirationDate ? (
                                            <div>
                                              <span className={mobileCountdownClass}>
                                                {t('dashboard.daysRemaining', { days: Math.max(daysRemaining ?? 0, 0) })}
                                              </span>
                                            </div>
                                          ) : timing.status === 'active' && !expirationDate ? (
                                            <span className="text-muted-foreground text-sm">
                                              {t('dashboard.perpetualLicense')}
                                            </span>
                                          ) : isReturned(fanmark) ? (
                                            <span className="text-muted-foreground text-sm">{t('dashboard.returned')}</span>
                                          ) : (
                                            <span className="text-muted-foreground text-sm">-</span>
                                          )}
                                        </div>
                                     </div>
                                   </div>
                                </div>

                                  <div className="flex items-center justify-end pt-2">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="gap-2 px-3 rounded-md border border-border/60 bg-background/50 text-foreground hover:bg-background"
                                          aria-label={t('dashboard.actionsMenu')}
                                        >
                                          <MoreVertical className="h-5 w-5" />
                                          <span className="text-xs font-medium">{t('dashboard.actionsMenu')}</span>
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" sideOffset={8} collisionPadding={16} className="w-48">
                                        <DropdownMenuItem
                                          onSelect={(event) => { event.preventDefault(); event.stopPropagation(); navigateToFanmark(fanmark.fanmark, true); }}
                                          className="gap-2"
                                        >
                                          <ExternalLink className="h-4 w-4 text-primary" />
                                          <span>{t('dashboard.visitFanmarkTooltip')}</span>
                                        </DropdownMenuItem>
                                        {fanmark.short_id && (
                                          <DropdownMenuItem
                                            onSelect={(event) => { event.preventDefault(); event.stopPropagation(); window.open(`/q/${fanmark.short_id}`, '_blank', 'noopener,noreferrer'); }}
                                            className="gap-2"
                                          >
                                            <QrCode className="h-4 w-4 text-primary" />
                                            <span>{t('dashboard.actionsQRCode')}</span>
                                          </DropdownMenuItem>
                                        )}
                                       <DropdownMenuItem
                                         onSelect={() => {
                                           const fullUrl = getFanmarkUrlForClipboard(fanmark.fanmark);
                                           navigator.clipboard.writeText(fullUrl);
                                           toast({
                                             title: t('dashboard.urlCopiedTitle'),
                                             description: fullUrl,
                                           });
                                         }}
                                         className="gap-2"
                                       >
                                         <Copy className="h-4 w-4 text-primary" />
                                         <span>{t('dashboard.copyFanmarkLink')}</span>
                                       </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onSelect={() => {
                                            if (!canExtend) return;
                                            openExtendDialog(fanmark, timing);
                                          }}
                                          className="gap-2"
                                          disabled={!canExtend}
                                        >
                                          <FiClock className="h-4 w-4 text-primary" />
                                          <span>{t('dashboard.extendMenuLabel')}</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onSelect={() => {
                                            if (!canReturn) return;
                                            openReturnDialog(fanmark);
                                          }}
                                          className="gap-2"
                                          disabled={!canReturn}
                                        >
                                          <Undo2 className="h-4 w-4 text-primary" />
                                          <span>{t('dashboard.actionsReturn')}</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          onSelect={() => handleOpenSettings(fanmark.id)}
                                          className="gap-2"
                                          disabled={isReturned(fanmark) || timing.status !== 'active'}
                                        >
                                          <Settings className="h-4 w-4 text-primary" />
                                          <span>{t('dashboard.actionsSettings')}</span>
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="acquisition" className="space-y-6">
            <Card
              id="dashboard-fanmark-search"
              className="overflow-hidden rounded-3xl border border-primary/20 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur"
            >
              <CardContent className="space-y-6 p-6 sm:p-8">
                <div className="space-y-3 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FiCompass className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">
                    {t('dashboard.getFanmaTitle')}
                  </h3>
                  <p className="mx-auto max-w-xl text-sm text-muted-foreground">
                    {t('dashboard.getFanmaDescription')}
                  </p>
                </div>
                <FanmarkAcquisition
                  prefilledEmoji={prefilledEmoji}
                  fanmarkLimit={isUnlimited ? -1 : fanmarkLimit}
                  currentCount={activeFanmarks}
                  rememberSearch
                  scrollToSearch={shouldScrollToSearch}
                  onSearchScrolled={() => setShouldScrollToSearch(false)}
                  onObtain={() => {
                    setPrefilledEmoji(undefined);
                    fetchFanmarks();
                    setActiveTab('my-fanmarks');
                  }}
                  onRequireAuth={handleRequireAuth}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>
      {returningFanmarkId && (
        <FanmarkReturnLoading fanmark={returningFanmarkEmoji || returnTargetFanmark?.fanmark} />
      )}

      <ExtendLicenseDialog
        target={extendTarget}
        open={extendDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (extendProcessing) return;
            setExtendDialogOpen(false);
            setExtendTarget(null);
            setExtendSelectedPlan(null);
          } else {
            setExtendDialogOpen(true);
          }
        }}
        onChangePlan={handleChangePlan}
        onSubmit={handleExtendSubmit}
        isProcessing={extendProcessing}
        selectedPlan={extendSelectedPlan}
      />

      <AlertDialog
        open={returnDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            if (returningFanmarkId) return;
            setReturnDialogOpen(false);
            setReturnTargetFanmark(null);
          } else {
            setReturnDialogOpen(true);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dashboard.returnConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('dashboard.returnConfirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(returningFanmarkId)}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReturn}
              className="bg-destructive hover:bg-destructive/90"
              disabled={Boolean(returningFanmarkId)}
            >
              {returningFanmarkId === returnTargetFanmark?.id ? t('common.processing') : t('dashboard.returnConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
