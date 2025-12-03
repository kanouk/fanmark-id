import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  getPlanLimit,
  formatPlanPrice,
  evaluatePlanDowngrade,
  type PlanType,
  type ActiveFanmark,
} from '@/lib/plan-utils';
import { FanmarkSelectionModal } from '@/components/FanmarkSelectionModal';
import { DowngradeWarningDialog } from '@/components/DowngradeWarningDialog';
import { supabase } from '@/integrations/supabase/client';
import { Check, ArrowLeft, Loader2, Sparkle, Crown, Star, ExternalLink, Flame } from 'lucide-react';

interface PlanCardCopy {
  type: PlanType;
  name: string;
  description: string;
  highlight?: boolean;
  badge?: string;
  price: string;
  monthlySuffix?: string;
  features: string[];
}

const CUSTOMER_PLANS: PlanType[] = ['free', 'creator', 'business'];

const PlanSelection = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = (location.state as { from?: string } | null) ?? null;
  const [backPath, setBackPath] = useState('/profile');
  const { t } = useTranslation();
  const { toast } = useToast();
  const { profile, loading, updateProfile, refetch: refetchProfile } = useProfile();
  const { user } = useAuth();
  const { subscription_end, refetch: refetchSubscription } = useSubscription();

  const [processingPlan, setProcessingPlan] = useState<PlanType | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [showFanmarkSelection, setShowFanmarkSelection] = useState(false);
  const [pendingPlanType, setPendingPlanType] = useState<PlanType | null>(null);
  const [fanmarksForSelection, setFanmarksForSelection] = useState<ActiveFanmark[]>([]);
  const [newPlanLimit, setNewPlanLimit] = useState<number>(0);
  const [checkingSubscription, setCheckingSubscription] = useState(false);
  const [pendingCheckout, setPendingCheckout] = useState(false);
  const [pollState, setPollState] = useState<'idle' | 'waiting-session' | 'polling'>('idle');
  const [pollAttempts, setPollAttempts] = useState(0);
  const [initialPlanType, setInitialPlanType] = useState<PlanType | null>(null);
  const [showDowngradeWarning, setShowDowngradeWarning] = useState(false);
  const [downgradeInfo, setDowngradeInfo] = useState<{
    currentPlan: PlanType;
    newPlan: PlanType;
    currentLimit: number;
    newLimit: number;
  } | null>(null);

  const planCards = useMemo<PlanCardCopy[]>(() => CUSTOMER_PLANS.map((planType) => {
    return {
      type: planType,
      name: t(`planSelection.${planType}.name`),
      description: t(`planSelection.${planType}.description`),
      highlight: planType === 'creator',
      badge: planType === 'creator' ? t('planSelection.popularBadge') : undefined,
      price: formatPlanPrice(planType),
      monthlySuffix: planType === 'free' ? undefined : t('planSelection.perMonth'),
      features: [
        t('planSelection.features.limit', { limit: getPlanLimit(planType) }),
        t(`planSelection.${planType}.feature1`),
        t(`planSelection.${planType}.feature2`),
      ],
    };
  }), [t]);

  useEffect(() => {
    const fromPath = locationState?.from;
    if (fromPath && typeof fromPath === 'string') {
      setBackPath(fromPath);
    }
  }, [locationState?.from]);

  const finishCheckoutSync = useCallback((outcome: 'success' | 'timeout') => {
    setPendingCheckout(false);
    setPollState('idle');
    setPollAttempts(0);
    setInitialPlanType(null);
    setCheckingSubscription(false);

    if (outcome === 'timeout') {
      toast({
        title: t('planSelection.checkoutSuccess'),
        description: t('planSelection.refreshRequired'),
      });
    }
  }, [t, toast]);

  // Handle checkout success or cancellation with auto-refresh
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get('checkout');

    if (!checkoutStatus) {
      return;
    }

    const clearQuery = () => {
      window.history.replaceState({}, '', window.location.pathname);
    };

    if (checkoutStatus === 'success') {
      setCheckingSubscription(true);
      setPendingCheckout(true);
      setInitialPlanType((profile?.plan_type || 'free') as PlanType);
      setPollAttempts(0);
      setPollState(user ? 'polling' : 'waiting-session');
      
      clearQuery();
      
      // Poll for subscription update
      toast({
        title: t('planSelection.processingPayment'),
        description: t('planSelection.pleaseWait'),
      });
    } else if (checkoutStatus === 'canceled') {
      clearQuery();
      toast({
        title: t('planSelection.checkoutCanceled'),
        description: t('planSelection.checkoutCanceledDescription'),
      });
    }
  }, [location.search, refetchSubscription, refetchProfile, profile?.plan_type, t, toast, user]);

  // Transition from waiting-session to polling when the Supabase session is ready
  useEffect(() => {
    if (!pendingCheckout) return;
    if (pollState !== 'waiting-session') return;
    if (!user) return;
    setPollState('polling');
  }, [pendingCheckout, pollState, user]);

  // Poll for subscription/profile updates while in polling state
  useEffect(() => {
    if (!pendingCheckout) return;
    if (pollState !== 'polling') return;
    if (pollAttempts >= 15) return;

    const delay = pollAttempts === 0 ? 1000 : 2000;
    const timer = setTimeout(async () => {
      setPollAttempts(prev => prev + 1);
      try {
        await Promise.all([refetchSubscription(), refetchProfile()]);
      } catch (error) {
        console.warn('[PlanSelection] Poll error', error);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [pendingCheckout, pollState, pollAttempts, refetchProfile, refetchSubscription]);

  // Timeout while waiting for Supabase session recovery
  useEffect(() => {
    if (!pendingCheckout) return;
    if (pollState !== 'waiting-session') return;
    const timer = setTimeout(() => finishCheckoutSync('timeout'), 15000);
    return () => clearTimeout(timer);
  }, [finishCheckoutSync, pendingCheckout, pollState]);

  // Detect successful plan change based on profile updates
  useEffect(() => {
    if (!pendingCheckout) return;
    if (!initialPlanType) return;
    if (!profile?.plan_type) return;
    if (profile.plan_type === initialPlanType) return;

    finishCheckoutSync('success');
  }, [finishCheckoutSync, initialPlanType, pendingCheckout, profile?.plan_type]);

  // Handle timeout condition
  useEffect(() => {
    if (!pendingCheckout) return;
    if (pollState !== 'polling') return;
    if (pollAttempts < 15) return;
    finishCheckoutSync('timeout');
  }, [finishCheckoutSync, pendingCheckout, pollState, pollAttempts]);

  const handlePlanChange = async (planType: PlanType) => {
    if (!profile || planType === profile.plan_type) {
      return;
    }

    if (!user) {
      toast({
        title: t('common.error'),
        description: t('planSelection.errorNoUser'),
        variant: 'destructive',
      });
      return;
    }

    setProcessingPlan(planType);

    try {
      const currentPlanType = profile.plan_type as PlanType;
      
      // Upgrading from free to paid plan
      if (currentPlanType === 'free' && (planType === 'creator' || planType === 'business')) {
        setRedirecting(true);
        
        const { data, error } = await supabase.functions.invoke('create-checkout', {
          body: { plan_type: planType }
        });
        
        if (error) {
          setRedirecting(false);
          throw error;
        }
        
        if (data?.url) {
          setTimeout(() => {
            window.location.href = data.url;
          }, 500);
        } else {
          setRedirecting(false);
          throw new Error('Checkout URL not received');
        }
        return;
      }
      
      // Check if downgrade requires fanmark selection
      const evaluation = await evaluatePlanDowngrade(user.id, currentPlanType, planType);
      
      if (evaluation.requiresSelection) {
        // Show fanmark selection modal for downgrades
        setPendingPlanType(planType);
        setFanmarksForSelection(evaluation.fanmarks);
        setNewPlanLimit(evaluation.newPlanLimit);
        setShowFanmarkSelection(true);
        setProcessingPlan(null);
        return;
      }
      
      // Determine if this is an upgrade or downgrade
      const planOrder: Record<PlanType, number> = {
        free: 0,
        creator: 1,
        business: 2,
        enterprise: 3,
        admin: 4,
      };
      
      const isUpgrade = planOrder[planType] > planOrder[currentPlanType];
      
      if (isUpgrade) {
        // UPGRADE: Use change-subscription with proration (no warning)
        setRedirecting(true);
        
        const { data, error } = await supabase.functions.invoke('change-subscription', {
          body: { 
            current_plan_type: currentPlanType,
            new_plan_type: planType 
          }
        });
        
        if (error) {
          setRedirecting(false);
          throw error;
        }
        
        // Refresh profile and subscription data
        await Promise.all([refetchProfile(), refetchSubscription()]);
        
        setRedirecting(false);
        toast({
          title: t('planSelection.upgradeSuccess'),
          description: t('planSelection.upgradeSuccessDescription', { 
            plan: t(`planSelection.${planType}.name`) 
          }),
        });
      } else {
        // DOWNGRADE: Show warning dialog first
        const currentLimit = getPlanLimit(currentPlanType);
        const newLimit = getPlanLimit(planType);
        
        setDowngradeInfo({
          currentPlan: currentPlanType,
          newPlan: planType,
          currentLimit,
          newLimit,
        });
        setShowDowngradeWarning(true);
        setProcessingPlan(null);
      }
    } catch (error) {
      console.error('Plan change error:', error);
      toast({
        title: t('planSelection.errorTitle'),
        description: error instanceof Error ? error.message : t('planSelection.errorDescription'),
        variant: 'destructive',
      });
    } finally {
      setProcessingPlan(null);
    }
  };

  const handleDowngradeConfirm = async () => {
    if (!user || !downgradeInfo) return;

    setShowDowngradeWarning(false);
    setRedirecting(true);

    try {
      const { data, error } = await supabase.functions.invoke('change-subscription', {
        body: { 
          current_plan_type: downgradeInfo.currentPlan,
          new_plan_type: downgradeInfo.newPlan 
        }
      });
      
      if (error) {
        setRedirecting(false);
        throw error;
      }
      
      // Check if we need to redirect to Checkout (for paid plan downgrades)
      if (data?.checkout_url) {
        setTimeout(() => {
          window.location.href = data.checkout_url;
        }, 500);
        return;
      }
      
      // For free plan downgrades, just refresh and show success
      await Promise.all([refetchProfile(), refetchSubscription()]);
      
      setRedirecting(false);
      toast({
        title: t('planSelection.downgradeSuccess'),
        description: t('planSelection.downgradeSuccessDescription', { 
          plan: t(`planSelection.${downgradeInfo.newPlan}.name`) 
        }),
      });
    } catch (error) {
      console.error('Downgrade confirmation error:', error);
      toast({
        title: t('planSelection.errorTitle'),
        description: error instanceof Error ? error.message : t('planSelection.errorDescription'),
        variant: 'destructive',
      });
    } finally {
      setDowngradeInfo(null);
    }
  };

  const handleFanmarkSelectionConfirm = async (selectedFanmarkIds: string[]) => {
    if (!user || !pendingPlanType) return;

    try {
      // Update plan_excluded status for fanmarks
      const allFanmarkIds = fanmarksForSelection.map(fm => fm.id);
      const excludedFanmarkIds = allFanmarkIds.filter(id => !selectedFanmarkIds.includes(id));

      // Mark excluded fanmarks
      if (excludedFanmarkIds.length > 0) {
        const licensesToExclude = fanmarksForSelection
          .filter(fm => excludedFanmarkIds.includes(fm.id))
          .map(fm => fm.license_id);

        const { error } = await supabase
          .from('fanmark_licenses')
          .update({
            plan_excluded: true,
            excluded_at: new Date().toISOString(),
            excluded_from_plan: profile?.plan_type || 'unknown'
          })
          .in('id', licensesToExclude);

        if (error) throw error;
      }

      // Reset excluded status for selected fanmarks
      if (selectedFanmarkIds.length > 0) {
        const licensesToInclude = fanmarksForSelection
          .filter(fm => selectedFanmarkIds.includes(fm.id))
          .map(fm => fm.license_id);

        const { error } = await supabase
          .from('fanmark_licenses')
          .update({
            plan_excluded: false,
            excluded_at: null,
            excluded_from_plan: null
          })
          .in('id', licensesToInclude);

        if (error) throw error;
      }

      // Close modal and proceed with downgrade
      setShowFanmarkSelection(false);
      setRedirecting(true);

      const currentPlanType = profile?.plan_type as PlanType;
      
      const { data, error } = await supabase.functions.invoke('change-subscription', {
        body: { 
          current_plan_type: currentPlanType,
          new_plan_type: pendingPlanType 
        }
      });
      
      if (error) {
        setRedirecting(false);
        throw error;
      }
      
      // Check if we need to redirect to Checkout (for paid plan downgrades)
      if (data?.checkout_url) {
        setTimeout(() => {
          window.location.href = data.checkout_url;
        }, 500);
        return;
      }
      
      // For free plan downgrades, just refresh and show success
      await Promise.all([refetchProfile(), refetchSubscription()]);
      
      setRedirecting(false);
      toast({
        title: t('planSelection.downgradeSuccess'),
        description: excludedFanmarkIds.length > 0 
          ? t('planSelection.fanmarksExcluded', { count: excludedFanmarkIds.length })
          : t('planSelection.downgradeSuccessDescription'),
      });
    } catch (error) {
      console.error('Fanmark selection error:', error);
      toast({
        title: t('common.error'),
        description: error instanceof Error ? error.message : t('planSelection.errorDescription'),
        variant: 'destructive',
      });
    } finally {
      setPendingPlanType(null);
      setFanmarksForSelection([]);
      setNewPlanLimit(0);
    }
  };

  const isCurrentPlan = (planType: PlanType) => profile?.plan_type === planType;

  const getPlanIcon = (planType: PlanType) => {
    switch (planType) {
      case 'creator':
        return <Sparkle className="h-6 w-6 text-primary" />;
      case 'business':
        return <Crown className="h-6 w-6 text-primary" />;
      case 'free':
      default:
        return <Star className="h-6 w-6 text-primary" />;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50">
        <div className="rounded-3xl border border-primary/20 bg-background/90 px-8 py-10 text-center shadow-[0_22px_55px_rgba(101,195,200,0.16)]">
          <p className="text-sm text-muted-foreground">{t('planSelection.errorNoProfile')}</p>
          <Button className="mt-6 rounded-full" onClick={() => navigate('/profile')}>
            {t('planSelection.backToSettings')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 pb-24">
      <div className="mx-auto max-w-6xl px-4 pt-10">
        <div className="mb-8 flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => navigate(backPath)}
            className="h-10 w-10 rounded-full border border-primary/20 bg-background/90 text-foreground hover:bg-primary/10"
            aria-label={t('planSelection.backToSettings')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </div>

        <header className="space-y-4 text-center">
          <Badge className="mx-auto w-fit rounded-full bg-primary/10 px-4 py-1 text-primary">
            {t('planSelection.currentPlanLabel', { plan: t(`planSelection.${profile.plan_type}.name`) })}
          </Badge>
          <h1 className="text-3xl font-semibold text-foreground md:text-4xl">
            {t('planSelection.title')}
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-muted-foreground md:text-base">
            {t('planSelection.subtitle')}
          </p>
        </header>

        <section className="mt-12 grid gap-6 md:grid-cols-3">
          {planCards.map(card => {
            const isCurrent = isCurrentPlan(card.type);
            return (
              <div key={card.type} className={`relative ${card.badge ? 'pt-4' : ''}`}>
                {card.badge && (
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="rounded-full bg-amber-500 px-3 py-1 text-white shadow-md">
                      <Flame className="h-3 w-3 mr-1" />
                      {card.badge}
                    </Badge>
                  </div>
                )}
                <div
                  className={`relative flex h-full flex-col gap-6 rounded-3xl border-2 bg-background/95 p-6 shadow-[0_20px_45px_rgba(101,195,200,0.12)] backdrop-blur transition-all hover:-translate-y-1 hover:shadow-[0_25px_55px_rgba(101,195,200,0.16)] ${
                    isCurrent 
                      ? 'border-green-500 bg-green-50/50 dark:bg-green-950/20' 
                      : 'border-primary/10'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 text-left">
                      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                        {getPlanIcon(card.type)}
                        <span>{card.name}</span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-foreground">{card.price}</span>
                        {card.monthlySuffix && (
                          <span className="text-xs text-muted-foreground">{card.monthlySuffix}</span>
                        )}
                      </div>
                    </div>
                    {isCurrent && (
                      <Badge className="rounded-full bg-green-500 px-3 py-1 text-white">
                        {t('planSelection.currentPlanLabel', { plan: '' }).replace(/\s*-\s*$/, '')}
                      </Badge>
                    )}
                  </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {card.description}
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {card.features.map(feature => (
                    <li key={feature} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-2">
                  <Button
                    className="w-full rounded-full"
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={processingPlan !== null || isCurrent}
                    onClick={() => handlePlanChange(card.type)}
                  >
                    {processingPlan === card.type ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('common.loading')}
                      </>
                    ) : isCurrent ? (
                      t('planSelection.currentPlanCta')
                    ) : (
                      t('planSelection.choosePlanCta', { plan: card.name })
                    )}
                  </Button>
                </div>
              </div>
            </div>
            );
          })}
        </section>

      </div>

      {/* Fanmark Selection Modal */}
      <FanmarkSelectionModal
        isOpen={showFanmarkSelection}
        onClose={() => {
          setShowFanmarkSelection(false);
          setPendingPlanType(null);
          setFanmarksForSelection([]);
          setNewPlanLimit(0);
        }}
        newPlanType={pendingPlanType || 'free'}
        newPlanLimit={newPlanLimit}
        currentFanmarks={fanmarksForSelection}
        onConfirm={handleFanmarkSelectionConfirm}
      />

      {/* Downgrade Warning Dialog */}
      <DowngradeWarningDialog
        open={showDowngradeWarning}
        onOpenChange={setShowDowngradeWarning}
        currentPlan={downgradeInfo?.currentPlan || 'free'}
        newPlan={downgradeInfo?.newPlan || 'free'}
        subscriptionEnd={subscription_end}
        currentLimit={downgradeInfo?.currentLimit || 0}
        newLimit={downgradeInfo?.newLimit || 0}
        onConfirm={handleDowngradeConfirm}
        isProcessing={redirecting}
      />

      {/* Subscription Check Loading Overlay */}
      {checkingSubscription && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <Card className="w-[90%] max-w-md p-6">
            <div className="flex flex-col items-center gap-4 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div>
                <h3 className="font-semibold text-lg mb-2">
                  {t('planSelection.processingPayment')}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('planSelection.pleaseWait')}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Redirect Loading Overlay */}
      {redirecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-fade-in">
          <div className="rounded-3xl border border-primary/20 bg-background/95 px-8 py-12 shadow-[0_25px_60px_rgba(101,195,200,0.3)] animate-scale-in">
            <div className="flex flex-col items-center gap-6">
              <div className="relative">
                <Loader2 className="h-16 w-16 animate-spin text-primary" />
                <div className="absolute inset-0 animate-pulse">
                  <ExternalLink className="h-16 w-16 text-primary/20" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-xl font-semibold text-foreground">
                  {t('planSelection.redirectTitle')}
                </h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {t('planSelection.redirectDescription')}
                </p>
              </div>
              <div className="flex gap-2">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0ms' }} />
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" style={{ animationDelay: '150ms' }} />
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlanSelection;
