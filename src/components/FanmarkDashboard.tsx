import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { format, differenceInDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogTrigger, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTranslation } from '@/hooks/useTranslation';
import { Search, Eye, Edit, Settings, Trash2, ExternalLink, Copy, Undo2 } from 'lucide-react';
import { FiTarget, FiLayers, FiCompass, FiStar, FiCheckCircle, FiMoon, FiFileText, FiUser, FiLink } from 'react-icons/fi';
import { FanmarkAcquisition } from './FanmarkAcquisition';
// Using Undo2 for return/return action
import { supabase } from '@/integrations/supabase/client';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useFanmarkLimit } from '@/hooks/useFanmarkLimit';
import { navigateToFanmark, getFanmarkUrlForClipboard } from '@/utils/emojiUrl';
import { GraceStatusCountdown } from './GraceStatusCountdown';

interface Fanmark {
  id: string;
  emoji_combination: string;
  fanmark_name: string | null;
  short_id: string;
  access_type: string;
  target_url: string | null;
  text_content: string | null;
  redirect_url?: string | null;
  profile_text?: string | null;
  tier_level: number | null;
  current_license_id: string | null;
  is_transferable: boolean;
  status: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  normalized_emoji: string;
  fanmark_licenses?: {
    license_start: string;
    license_end: string;
    status: string;
    plan_excluded?: boolean;
    excluded_at?: string | null;
    excluded_from_plan?: string | null;
  } | null;
}

interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
}

interface DashboardLocationState {
  prefillFanmark?: string;
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

  const [fanmarks, setFanmarks] = useState<Fanmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('my-fanmarks');
  const [prefilledEmoji, setPrefilledEmoji] = useState<string | undefined>();
  const [returningFanmarkId, setReturningFanmarkId] = useState<string | null>(null);

  const handleOpenSettings = (fanmarkId: string) => {
    // Find and cache fanmark data for profile edit page
    const fanmark = fanmarks.find(f => f.id === fanmarkId);
    if (fanmark) {
      const fanmarkData = {
        emoji_combination: fanmark.emoji_combination,
        fanmark_name: fanmark.fanmark_name,
        fanmarkId: fanmarkId,
        timestamp: Date.now()
      };
      localStorage.setItem('fanmark_settings_cache', JSON.stringify(fanmarkData));
    }
    navigate(`/fanmarks/${fanmarkId}/settings`);
  };

  const handleReturnFanmark = async (fanmarkId: string) => {
    setReturningFanmarkId(fanmarkId);

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
    }
  };

  useEffect(() => {
    const state = (location.state as DashboardLocationState | null)?.prefillFanmark;
    let nextPrefill = state;

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
      if (state) {
        navigate(location.pathname, { replace: true });
      }
    }
  }, [location, navigate]);

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
          status,
          plan_excluded,
          excluded_at,
          excluded_from_plan,
          created_at,
          fanmarks (
            id,
            emoji_combination,
            normalized_emoji,
            short_id,
            status,
            created_at,
            updated_at
          )
        `)
        .eq('user_id', user?.id)
        .in('status', ['active', 'expired'])
        .order('created_at', { ascending: false });

      if (licensesError) throw licensesError;

      if (!licenses || licenses.length === 0) {
        setFanmarks([]);
        return;
      }

      // Get all fanmark IDs to fetch configs
      const fanmarkIds = licenses.map(license => license.fanmark_id).filter(Boolean);

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

      // Fetch redirect configs
      const { data: redirectConfigs, error: redirectError } = await supabase
        .from('fanmark_redirect_configs')
        .select('license_id, target_url')
        .in('license_id', licenseIds);

      if (redirectError) {
        console.warn('Error fetching redirect configs:', redirectError);
      }

      // Fetch message configs
      const { data: messageConfigs, error: messageError } = await supabase
        .from('fanmark_messageboard_configs')
        .select('license_id, content')
        .in('license_id', licenseIds);

      if (messageError) {
        console.warn('Error fetching message configs:', messageError);
      }

      // Create lookup maps for configs
      const basicConfigMap = new Map((basicConfigs || []).map(config => [config.license_id, config]));
      const redirectConfigMap = new Map((redirectConfigs || []).map(config => [config.license_id, config]));
      const messageConfigMap = new Map((messageConfigs || []).map(config => [config.license_id, config]));

      // Process fanmarks with their configs
      const fanmarksWithDefaults = licenses.map(license => {
        const fanmark = license.fanmarks as any;
        const basicConfig = basicConfigMap.get(license.id);
        const redirectConfig = redirectConfigMap.get(license.id);
        const messageConfig = messageConfigMap.get(license.id);
        
        return {
          ...fanmark,
          // Fill in required properties from Fanmark interface
          access_type: basicConfig?.access_type || 'inactive',
          fanmark_name: basicConfig?.fanmark_name || fanmark.emoji_combination,
          target_url: redirectConfig?.target_url || null,
          text_content: messageConfig?.content || null,
          license_id: license.id,
          redirect_url: null,
          profile_text: null,
          tier_level: null, // Removed from fanmarks table
          current_license_id: license.id,
          is_transferable: true, // Default value
          user_id: '', // Not available in new schema
          // Add license information for compatibility
          current_license: {
            id: license.id,
            license_start: license.license_start,
            license_end: license.license_end,
            status: license.status,
            created_at: license.created_at
          },
          fanmark_licenses: {
            license_start: license.license_start,
            license_end: license.license_end,
            status: license.status,
            plan_excluded: license.plan_excluded,
            excluded_at: license.excluded_at,
            excluded_from_plan: license.excluded_from_plan
          }
        };
      }) as Fanmark[];
      
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

  const getStatusBadge = (licenseStatus?: string, isPlanExcluded?: boolean) => {
    let icon = <FiMoon className="h-3.5 w-3.5" />;
    let className = 'border-gray-200/60 bg-gray-50 text-gray-600 shadow-sm';
    let label = t('dashboard.statusUnknown');

    if (isPlanExcluded) {
      icon = <FiTarget className="h-3.5 w-3.5" />;
      className = 'border-amber-200/60 bg-amber-50 text-amber-600 shadow-sm';
      label = t('fanmarkStatus.planExcluded');
    } else if (licenseStatus === 'active') {
      icon = <FiCheckCircle className="h-3.5 w-3.5" />;
      className = 'border-emerald-200/60 bg-emerald-50 text-emerald-600 shadow-sm';
      label = t('dashboard.statusActive');
    } else if (licenseStatus === 'grace') {
      icon = <FiTarget className="h-3.5 w-3.5" />;
      className = 'border-amber-200/60 bg-amber-50 text-amber-600 shadow-sm';
      label = t('dashboard.statusGrace');
    } else if (licenseStatus === 'expired') {
      icon = <FiTarget className="h-3.5 w-3.5" />;
      className = 'border-rose-200/60 bg-rose-50 text-rose-600 shadow-sm';
      label = t('dashboard.statusExpired');
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
    return !fanmark.current_license_id || licenseData?.status === 'expired';
  };

  // Helper function to determine if a fanmark is returned/expired
  const isReturned = (fanmark: Fanmark) => {
    const licenseData = fanmark.fanmark_licenses as any;
    return licenseData?.status === 'expired';
  };

  const getTierOvalStyle = (tierLevel: number) => {
    if (tierLevel === 1) {
      return 'bg-gray-100 border border-gray-300';
    } else if (tierLevel === 2) {
      return 'bg-gradient-to-r from-blue-100 to-purple-100 border border-blue-300';
    } else if (tierLevel === 3) {
      return 'bg-gradient-to-r from-amber-100 via-orange-100 to-pink-100 border-2 border-amber-400 shadow-lg';
    }
    return 'bg-gray-50 border border-gray-200';
  };

  const getAccessTypeBadge = (accessType: string) => {
    let icon = <FiMoon className="h-3.5 w-3.5" />;
    let className = 'border-gray-200/60 bg-gray-50 text-gray-600 shadow-sm';
    let label = t('dashboard.accessTypes.inactive');

    if (accessType === 'profile') {
      icon = <FiUser className="h-3.5 w-3.5" />;
      className = 'border-sky-200/60 bg-sky-50 text-sky-600 shadow-sm';
      label = t('dashboard.accessTypes.profile');
    } else if (accessType === 'redirect') {
      icon = <FiLink className="h-3.5 w-3.5" />;
      className = 'border-emerald-200/60 bg-emerald-50 text-emerald-600 shadow-sm';
      label = t('dashboard.accessTypes.redirect');
    } else if (accessType === 'text') {
      icon = <FiFileText className="h-3.5 w-3.5" />;
      className = 'border-amber-200/60 bg-amber-50 text-amber-600 shadow-sm';
      label = t('dashboard.accessTypes.text');
    }

    return (
      <Badge className={`${className} inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide whitespace-nowrap`}>
        {icon}
        <span>{label}</span>
      </Badge>
    );
  };

  const activeFanmarks = fanmarks.filter(f => {
    const licenseData = f.fanmark_licenses as any;
    return licenseData?.status === 'active' || licenseData?.status === 'grace';
  }).length;

  const filteredFanmarks = fanmarks.sort((a, b) => {
    // First sort by status (active only at top)
    const aLicenseData = a.fanmark_licenses as any;
    const bLicenseData = b.fanmark_licenses as any;
    const aIsActive = aLicenseData?.status === 'active';
    const bIsActive = bLicenseData?.status === 'active';

    if (aIsActive !== bIsActive) {
      return aIsActive ? -1 : 1; // Active first
    }

    // Second sort by acquisition date (newest first)
    const aAcquisition = aLicenseData?.license_start ? new Date(aLicenseData.license_start).getTime() : 0;
    const bAcquisition = bLicenseData?.license_start ? new Date(bLicenseData.license_start).getTime() : 0;
    return bAcquisition - aAcquisition;
  });

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
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                   <p className="text-sm font-medium text-muted-foreground">
                     {t('dashboard.stats.activeFanmarks')}
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
              <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden mt-4">
                 <div 
                   className="bg-primary h-2.5 rounded-full transition-all duration-500"
                   style={{ width: `${isUnlimited ? 0 : Math.min((activeFanmarks / fanmarkLimit) * 100, 100)}%` }}
                 />
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
                      <div className="overflow-hidden rounded-2xl border border-primary/10 bg-background/50">
                        <table className="w-full">
                          <thead>
                              <tr className="bg-gradient-to-r from-primary/5 via-accent/5 to-primary/5 border-b border-primary/10">
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-6 py-4">{t('dashboard.fanmark')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-6 py-4">{t('dashboard.accessType')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-6 py-4">{t('dashboard.acquisitionDate')}</th>
                                 <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-6 py-4">{t('dashboard.returnDate')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-6 py-4">{t('dashboard.remainingDays')}</th>
                                <th className="text-muted-foreground font-medium text-xs uppercase tracking-wide text-left px-6 py-4">{t('dashboard.status')}</th>
                                <th className="text-left px-6 py-4 w-12"></th>
                                <th className="text-left px-6 py-4 w-12"></th>
                              </tr>
                          </thead>
                          <tbody>
                            {filteredFanmarks.map((fanmark) => {
                              const redirectUrl = fanmark.target_url ?? fanmark.redirect_url;
                              const textContent = fanmark.text_content ?? fanmark.profile_text;
                              const licenseData = fanmark.fanmark_licenses;
                              const acquisitionDate = licenseData?.license_start ? format(new Date(licenseData.license_start), 'yyyy/MM/dd') : '-';
                              const expirationDate = licenseData?.license_end ? new Date(licenseData.license_end) : null;
                              const daysRemaining = expirationDate ? differenceInDays(expirationDate, new Date()) : null;
                              const isExpiringSoon = daysRemaining !== null && daysRemaining <= 3;

                              return (
                                <tr key={fanmark.id} className={`border-b border-primary/5 transition-all duration-200 ${isFanmarkInactive(fanmark) ? 'bg-gray-200 dark:bg-gray-700' : 'hover:bg-primary/5 hover:shadow-sm'}`}>
                                      <td className="px-6 py-5">
                                        <div className="min-h-[2.5rem] flex items-center">
                                          <div
                                            className={`flex items-center px-4 py-3 rounded-full shadow-sm transition-transform hover:scale-105 whitespace-nowrap cursor-pointer ${getTierOvalStyle(fanmark.tier_level || 1)}`}
                                            onClick={() => {
                                              navigator.clipboard.writeText(fanmark.emoji_combination);
                                              toast({
                                                title: t('dashboard.emojiCopiedTitle'),
                                                description: fanmark.emoji_combination,
                                              });
                                            }}
                                            title={t('dashboard.clickToCopyEmoji')}
                                          >
                                            <span className="text-2xl leading-none select-none" style={{ letterSpacing: '0.2em' }}>{fanmark.emoji_combination}</span>
                                          </div>
                                        </div>
                                     </td>
                                <td className="px-6 py-5">
                                  <div className="min-h-[2.5rem] flex items-center min-w-fit">
                                    {!isFanmarkInactive(fanmark) && getAccessTypeBadge(fanmark.access_type)}
                                  </div>
                                </td>
                                <td className="px-6 py-5">
                                  <div className="min-h-[2.5rem] flex items-center">
                                    <div className="text-sm text-foreground font-medium">
                                      {acquisitionDate}
                                    </div>
                                  </div>
                                </td>
                                 <td className="px-6 py-5">
                                   <div className="min-h-[2.5rem] flex items-center">
                                     {expirationDate ? (
                                       <div className="text-sm text-foreground font-medium">
                                         {format(expirationDate, 'yyyy/MM/dd')}
                                       </div>
                                     ) : (
                                       <span className="text-muted-foreground text-sm">-</span>
                                     )}
                                   </div>
                                 </td>
                                 <td className="px-6 py-5">
                                   <div className="min-h-[2.5rem] flex items-center gap-2">
                                     {!isReturned(fanmark) && daysRemaining !== null && daysRemaining >= 0 ? (
                                       <>
                                         <div className={`text-sm font-medium whitespace-nowrap ${isExpiringSoon ? 'text-destructive' : 'text-foreground'}`}>
                                           {t('dashboard.daysRemaining', { days: daysRemaining })}
                                         </div>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                  <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 w-7 p-0 rounded-full hover:bg-red-50 hover:text-red-600 transition-colors"
                                                    disabled={returningFanmarkId === fanmark.id}
                                                  >
                                                    <Undo2 className="h-3.5 w-3.5" />
                                                  </Button>
                                                </AlertDialogTrigger>
                                           <AlertDialogContent>
                                             <AlertDialogHeader>
                                               <AlertDialogTitle>{t('dashboard.returnConfirmTitle')}</AlertDialogTitle>
                                               <AlertDialogDescription>
                                                 {t('dashboard.returnConfirmDescription')}
                                               </AlertDialogDescription>
                                             </AlertDialogHeader>
                                             <AlertDialogFooter>
                                               <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                                               <AlertDialogAction
                                                 onClick={() => handleReturnFanmark(fanmark.id)}
                                                 className="bg-red-600 hover:bg-red-700"
                                               >
                                                 {returningFanmarkId === fanmark.id ? t('common.processing') : t('dashboard.returnConfirmAction')}
                                               </AlertDialogAction>
                                             </AlertDialogFooter>
                                            </AlertDialogContent>
                                              </AlertDialog>
                                            </TooltipTrigger>
                                            <TooltipContent>{t('dashboard.actionsReturn')}</TooltipContent>
                                          </Tooltip>
                                       </>
                                     ) : isReturned(fanmark) ? (
                                       <span className="text-muted-foreground text-sm">{t('dashboard.returned')}</span>
                                     ) : (
                                       <span className="text-muted-foreground text-sm">-</span>
                                     )}
                                   </div>
                                 </td>
                                  <td className="px-6 py-5">
                                     <div className="min-h-[2.5rem] flex items-center gap-2 min-w-fit">
                                       {getStatusBadge(licenseData?.status, licenseData?.plan_excluded)}
                                       {licenseData?.plan_excluded && (
                                         <span className="text-xs text-muted-foreground">
                                           {t('fanmarkStatus.extensionNotPossible')}
                                         </span>
                                       )}
                                       {licenseData?.status === 'grace' && licenseData?.license_end && (
                                         <GraceStatusCountdown 
                                           licenseEnd={licenseData.license_end}
                                           className="ml-2"
                                         />
                                       )}
                                     </div>
                                  </td>
                                  <td className="px-6 py-5">
                                    <div className="min-h-[2.5rem] flex items-center gap-2">
                                       <Tooltip>
                                         <TooltipTrigger asChild>
                                           <Button
                                             size="sm"
                                             variant="ghost"
                                             className="h-9 w-9 p-0 rounded-full hover:bg-primary/10 transition-colors"
                                             onClick={() => {
                                               navigateToFanmark(fanmark.emoji_combination, true);
                                             }}
                                             aria-label={t('common.visitFanmarkAriaLabel')}
                                           >
                                              <ExternalLink className="h-4 w-4" />
                                           </Button>
                                         </TooltipTrigger>
                                         <TooltipContent>{t('dashboard.visitFanmarkTooltip')}</TooltipContent>
                                       </Tooltip>
                                       <Tooltip>
                                         <TooltipTrigger asChild>
                                           <Button
                                             size="sm"
                                             variant="ghost"
                                             className="h-9 w-9 p-0 rounded-full hover:bg-primary/10 transition-colors"
                                             onClick={() => {
                                               const fullUrl = getFanmarkUrlForClipboard(fanmark.emoji_combination);
                                               navigator.clipboard.writeText(fullUrl);
                                               toast({
                                                 title: t('dashboard.urlCopiedTitle'),
                                                 description: fullUrl,
                                               });
                                             }}
                                             aria-label={t('common.copyFanmarkAriaLabel')}
                                           >
                                              <Copy className="h-4 w-4" />
                                           </Button>
                                         </TooltipTrigger>
                                         <TooltipContent>{t('dashboard.copyFanmarkLink')}</TooltipContent>
                                       </Tooltip>
                                    </div>
                                  </td>
                                   <td className="px-6 py-5">
                                     <div className="min-h-[2.5rem] flex items-center">
                                        {!isReturned(fanmark) && (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                className="h-9 w-9 p-0 rounded-full hover:bg-primary/10 transition-colors"
                                                onClick={() => handleOpenSettings(fanmark.id)}
                                                aria-label={t('dashboard.actionsSettings')}
                                              >
                                                 <Settings className="h-5 w-5" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>{t('dashboard.actionsSettings')}</TooltipContent>
                                          </Tooltip>
                                        )}
                                     </div>
                                   </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="lg:hidden space-y-4">
                      {filteredFanmarks.map((fanmark) => {
                        const redirectUrl = fanmark.target_url ?? fanmark.redirect_url;
                        const textContent = fanmark.text_content ?? fanmark.profile_text;
                        const licenseData = fanmark.fanmark_licenses;
                        const acquisitionDate = licenseData?.license_start ? format(new Date(licenseData.license_start), 'yyyy/MM/dd') : '-';
                        const expirationDate = licenseData?.license_end ? new Date(licenseData.license_end) : null;
                        const daysRemaining = expirationDate ? differenceInDays(expirationDate, new Date()) : null;
                        const isExpiringSoon = daysRemaining !== null && daysRemaining <= 3;

                        return (
                          <Card key={fanmark.id} className={`rounded-3xl border border-primary/10 transition-colors ${isFanmarkInactive(fanmark) ? 'bg-gray-200 dark:bg-gray-700' : 'bg-background/80 hover:border-primary/20'}`}>
                            <CardContent className="p-5">
                              <div className="space-y-3">
                                 <div className="flex items-start justify-between">
                                    <div
                                      className={`flex items-center px-3 py-2 rounded-full cursor-pointer hover:scale-105 transition-transform ${getTierOvalStyle(fanmark.tier_level || 1)}`}
                                      onClick={() => {
                                        navigator.clipboard.writeText(fanmark.emoji_combination);
                                        toast({
                                          title: t('dashboard.emojiCopiedTitle'),
                                          description: fanmark.emoji_combination,
                                        });
                                      }}
                                      title={t('dashboard.clickToCopyEmoji')}
                                    >
                                      <span className="text-3xl leading-none select-none" style={{ letterSpacing: '0.2em' }}>{fanmark.emoji_combination}</span>
                                    </div>
                                 </div>

                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex-shrink-0">
                                        {!isFanmarkInactive(fanmark) && getAccessTypeBadge(fanmark.access_type)}
                                      </div>
                                      <div className="flex-shrink-0">
                                        {getStatusBadge(licenseData?.status, licenseData?.plan_excluded)}
                                      </div>
                                    </div>
                                    {licenseData?.plan_excluded && (
                                      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-2">
                                        <div className="flex items-center gap-2">
                                          <Badge variant="destructive" className="text-xs">
                                            🔒 {t('fanmarkStatus.planExcluded')}
                                          </Badge>
                                        </div>
                                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                                          {t('fanmarkStatus.extensionNotPossible')}
                                        </p>
                                      </div>
                                     )}
                                     {licenseData?.status === 'grace' && licenseData?.license_end && (
                                       <div className="mt-2">
                                         <GraceStatusCountdown 
                                           licenseEnd={licenseData.license_end}
                                         />
                                       </div>
                                     )}
                                   </div>

                                 {/* Date Information */}
                                <div className="grid grid-cols-3 gap-3 text-sm bg-muted/20 rounded-lg p-3">
                                  <div>
                                    <div className="text-xs text-muted-foreground font-medium mb-1">
                                      {t('dashboard.acquisitionDate')}
                                    </div>
                                    <div className="text-foreground">{acquisitionDate}</div>
                                  </div>
                                   <div>
                                     <div className="text-xs text-muted-foreground font-medium mb-1">
                                       {t('dashboard.returnDate')}
                                     </div>
                                     <div className="text-foreground">
                                       {expirationDate ? format(expirationDate, 'yyyy/MM/dd') : '-'}
                                     </div>
                                   </div>
                                   <div>
                                     <div className="text-xs text-muted-foreground font-medium mb-1">
                                       {t('dashboard.remainingDays')}
                                     </div>
                                     <div>
                                       {!isReturned(fanmark) && daysRemaining !== null && daysRemaining >= 0 ? (
                                         <span className={`text-sm font-medium whitespace-nowrap ${isExpiringSoon ? 'text-destructive' : 'text-foreground'}`}>
                                           {t('dashboard.daysRemaining', { days: daysRemaining })}
                                         </span>
                                       ) : isReturned(fanmark) ? (
                                         <span className="text-muted-foreground text-sm">{t('dashboard.returned')}</span>
                                       ) : (
                                         <span className="text-muted-foreground text-sm">-</span>
                                       )}
                                     </div>
                                   </div>
                                </div>

                                {(redirectUrl || textContent) && (
                                  <div className="text-sm text-muted-foreground mb-3 rounded bg-muted/30 p-2">
                                    {fanmark.access_type === 'redirect' && redirectUrl && (
                                      <div className="flex items-center gap-1">
                                        <ExternalLink className="h-3 w-3" />
                                        <span className="truncate">{redirectUrl}</span>
                                      </div>
                                    )}
                                    {fanmark.access_type === 'text' && textContent && (
                                      <div className="flex items-start gap-1">
                                        <FiFileText className="mt-0.5 h-3 w-3" />
                                        <span className="line-clamp-2">{textContent}</span>
                                      </div>
                                    )}
                                  </div>
                                )}

                                  <div className="flex items-center justify-between pt-2">
                                    <div className="flex items-center gap-2">
                                      {!isReturned(fanmark) && (
                                        <AlertDialog>
                                          <AlertDialogTrigger asChild>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="h-7 px-2 text-xs hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                                              disabled={returningFanmarkId === fanmark.id}
                                            >
                                              <Undo2 className="h-3 w-3 mr-1" />
                                              {t('dashboard.actionsReturn')}
                                            </Button>
                                          </AlertDialogTrigger>
                                          <AlertDialogContent>
                                            <AlertDialogHeader>
                                              <AlertDialogTitle>{t('dashboard.returnConfirmTitle')}</AlertDialogTitle>
                                              <AlertDialogDescription>
                                                {t('dashboard.returnConfirmDescription')}
                                              </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                                              <AlertDialogAction
                                                onClick={() => handleReturnFanmark(fanmark.id)}
                                                className="bg-red-600 hover:bg-red-700"
                                              >
                                                {returningFanmarkId === fanmark.id ? t('common.processing') : t('dashboard.returnConfirmAction')}
                                              </AlertDialogAction>
                                            </AlertDialogFooter>
                                          </AlertDialogContent>
                                        </AlertDialog>
                                      )}
                                       <Tooltip>
                                         <TooltipTrigger asChild>
                                           <Button
                                             size="sm"
                                             variant="ghost"
                                             className="h-8 w-8 p-0 hover:bg-secondary"
                                             onClick={() => {
                                               navigateToFanmark(fanmark.emoji_combination, true);
                                             }}
                                             aria-label={t('common.visitFanmarkAriaLabel')}
                                           >
                                              <ExternalLink className="h-4 w-4" />
                                           </Button>
                                         </TooltipTrigger>
                                         <TooltipContent>{t('dashboard.visitFanmarkTooltip')}</TooltipContent>
                                       </Tooltip>
                                       <Tooltip>
                                         <TooltipTrigger asChild>
                                           <Button
                                             size="sm"
                                             variant="ghost"
                                             className="h-8 w-8 p-0 hover:bg-secondary"
                                             onClick={() => {
                                               const fullUrl = getFanmarkUrlForClipboard(fanmark.emoji_combination);
                                               navigator.clipboard.writeText(fullUrl);
                                               toast({
                                                 title: t('dashboard.urlCopiedTitle'),
                                                 description: fullUrl,
                                               });
                                             }}
                                             aria-label={t('common.copyFanmarkAriaLabel')}
                                           >
                                              <Copy className="h-4 w-4" />
                                           </Button>
                                         </TooltipTrigger>
                                         <TooltipContent>{t('dashboard.copyFanmarkLink')}</TooltipContent>
                                       </Tooltip>
                                    </div>
                                      {!isReturned(fanmark) && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              className="h-9 w-9 p-0 hover:bg-secondary"
                                              onClick={() => handleOpenSettings(fanmark.id)}
                                              aria-label={t('dashboard.actionsSettings')}
                                            >
                                              <Settings className="h-5 w-5" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>{t('dashboard.actionsSettings')}</TooltipContent>
                                        </Tooltip>
                                      )}
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
            <Card className="overflow-hidden rounded-3xl border border-primary/20 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur">
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
    </section>
  );
};
