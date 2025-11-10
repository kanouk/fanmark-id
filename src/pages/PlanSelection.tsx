import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  getPlanLimit,
  formatPlanPrice,
  evaluatePlanDowngrade,
  type PlanType,
  type ActiveFanmark,
} from '@/lib/plan-utils';
import { FanmarkSelectionModal } from '@/components/FanmarkSelectionModal';
import { supabase } from '@/integrations/supabase/client';
import { Check, ArrowLeft, Loader2, Sparkle, Crown, Star, ExternalLink } from 'lucide-react';

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
  const { profile, loading, updateProfile } = useProfile();
  const { user } = useAuth();

  const [processingPlan, setProcessingPlan] = useState<PlanType | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [showFanmarkSelection, setShowFanmarkSelection] = useState(false);
  const [pendingPlanType, setPendingPlanType] = useState<PlanType | null>(null);
  const [fanmarksForSelection, setFanmarksForSelection] = useState<ActiveFanmark[]>([]);
  const [newPlanLimit, setNewPlanLimit] = useState<number>(0);

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

  const enterpriseCard = useMemo<PlanCardCopy>(() => ({
    type: 'enterprise',
    name: t('planSelection.enterprise.name'),
    description: t('planSelection.enterprise.description'),
    price: t('planSelection.enterprise.price'),
    features: [
      t('planSelection.enterprise.feature1'),
      t('planSelection.enterprise.feature2'),
      t('planSelection.enterprise.feature3'),
    ],
  }), [t]);

  useEffect(() => {
    const fromPath = locationState?.from;
    if (fromPath && typeof fromPath === 'string') {
      setBackPath(fromPath);
    }
  }, [locationState?.from]);

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
      
      // Check if downgrade requires fanmark selection
      const evaluation = await evaluatePlanDowngrade(user.id, currentPlanType, planType);
      
      if (evaluation.requiresSelection) {
        // Show fanmark selection modal
        setPendingPlanType(planType);
        setFanmarksForSelection(evaluation.fanmarks);
        setNewPlanLimit(evaluation.newPlanLimit);
        setShowFanmarkSelection(true);
        setProcessingPlan(null);
        return;
      }
      
      // Upgrading to paid plan (free → creator/business)
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
          // Keep showing loading overlay while redirecting
          setTimeout(() => {
            window.location.href = data.url;
          }, 500);
        } else {
          setRedirecting(false);
          throw new Error('Checkout URL not received');
        }
        return;
      }
      
      // Changing/downgrading from paid plan → use Customer Portal
      if (currentPlanType !== 'free' && planType !== currentPlanType) {
        setRedirecting(true);
        
        const { data, error } = await supabase.functions.invoke('customer-portal');
        
        if (error) {
          setRedirecting(false);
          throw error;
        }
        
        if (data?.url) {
          // Small delay for visual feedback
          setTimeout(() => {
            window.open(data.url, '_blank');
            setRedirecting(false);
            toast({
              title: t('planSelection.redirectTitle'),
              description: t('planSelection.redirectDescription'),
            });
          }, 500);
        } else {
          setRedirecting(false);
          throw new Error('Customer portal URL not received');
        }
        return;
      }
    } catch (error: any) {
      console.error('Plan change error:', error);
      toast({
        title: t('planSelection.errorTitle'),
        description: error.message || t('planSelection.errorDescription'),
        variant: 'destructive',
      });
    } finally {
      setProcessingPlan(null);
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

      // Reset excluded status for selected fanmarks (in case they were previously excluded)
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

      // Close modal and proceed with plan change
      setShowFanmarkSelection(false);
      
      // Open customer portal for downgrade
      if (pendingPlanType === 'free') {
        // If downgrading to free, just update locally and redirect to portal
        setRedirecting(true);
        
        const { data, error } = await supabase.functions.invoke('customer-portal');
        
        if (error) {
          setRedirecting(false);
          throw error;
        }
        
        if (data?.url) {
          setTimeout(() => {
            window.open(data.url, '_blank');
            setRedirecting(false);
            toast({
              title: t('planSelection.downgradeSuccess'),
              description: t('planSelection.fanmarksExcluded', { count: excludedFanmarkIds.length }),
            });
          }, 500);
        }
      } else {
        // For paid downgrades, open customer portal
        setRedirecting(true);
        
        const { data, error } = await supabase.functions.invoke('customer-portal');
        
        if (error) {
          setRedirecting(false);
          throw error;
        }
        
        if (data?.url) {
          setTimeout(() => {
            window.open(data.url, '_blank');
            setRedirecting(false);
            toast({
              title: t('planSelection.fanmarksExcluded', { count: excludedFanmarkIds.length }),
              description: t('planSelection.completeDowngradeInPortal'),
            });
          }, 500);
        }
      }
    } catch (error: any) {
      console.error('Fanmark selection error:', error);
      toast({
        title: t('common.error'),
        description: error.message || t('planSelection.errorDescription'),
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
          {planCards.map(card => (
            <div
              key={card.type}
              className={`relative flex h-full flex-col gap-6 rounded-3xl border border-primary/10 bg-background/95 p-6 shadow-[0_20px_45px_rgba(101,195,200,0.12)] backdrop-blur transition-transform hover:-translate-y-1 hover:shadow-[0_25px_55px_rgba(101,195,200,0.16)] ${
                card.highlight ? 'border-primary/40 bg-primary/5' : ''
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
                {card.badge && (
                  <Badge className="rounded-full bg-primary px-3 py-1 text-primary-foreground">
                    {card.badge}
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
                  variant={isCurrentPlan(card.type) ? 'outline' : 'default'}
                  disabled={processingPlan !== null || isCurrentPlan(card.type)}
                  onClick={() => handlePlanChange(card.type)}
                >
                  {processingPlan === card.type ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('common.loading')}
                    </>
                  ) : isCurrentPlan(card.type) ? (
                    t('planSelection.currentPlanCta')
                  ) : (
                    t('planSelection.choosePlanCta', { plan: card.name })
                  )}
                </Button>
              </div>
            </div>
          ))}
        </section>

        <section className="mt-12">
          <div className="rounded-3xl border border-primary/15 bg-background/95 p-8 shadow-[0_20px_45px_rgba(101,195,200,0.12)] backdrop-blur">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <ShieldIcon />
                  <span>{enterpriseCard.name}</span>
                </div>
                <p className="text-sm text-muted-foreground md:text-base">
                  {enterpriseCard.description}
                </p>
                <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  {enterpriseCard.features.map(feature => (
                    <li key={feature} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col items-start gap-4 rounded-2xl border border-primary/10 bg-primary/5 p-6">
                <span className="text-2xl font-semibold text-foreground">{enterpriseCard.price}</span>
                <p className="text-sm text-muted-foreground">
                  {t('planSelection.enterprise.ctaDescription')}
                </p>
                <Button
                  variant="default"
                  className="rounded-full"
                  onClick={() => window.open('mailto:hello@fanmark.id?subject=Enterprise%20Plan%20Inquiry')}
                >
                  {t('planSelection.enterprise.contactCta')}
                </Button>
              </div>
            </div>
          </div>
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

const ShieldIcon = () => (
  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
    <ShieldOutline />
  </div>
);

const ShieldOutline = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
    <path d="M12 3l7 4v5c0 4.97-3.58 9.54-7 10-3.42-.46-7-5.03-7-10V7l7-4z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default PlanSelection;
