import { useEffect, useMemo, useState, useRef } from 'react';
import { addMonths, differenceInMonths } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { formatInTimeZone } from 'date-fns-tz';
import { supabase } from '@/integrations/supabase/client';
import { CreditCard, Loader2, Info, Ticket, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

export interface ExtendPlanOption {
  months: number;
  price: number;
}

export interface ExtendLicenseTarget {
  fanmarkId: string;
  licenseId?: string | null;
  emoji: string;
  shortId: string;
  licenseEnd?: string | null;
  graceExpiresAt?: string | null;
  status?: string | null;
  tierLevel?: number | null;
}

interface ExtendLicenseDialogProps {
  target: ExtendLicenseTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChangePlan: (plan: ExtendPlanOption | null) => void;
  onSubmit: () => void;
  isProcessing: boolean;
  selectedPlan?: ExtendPlanOption | null;
  onCouponApplied?: () => void;
}

export const ExtendLicenseDialog = ({
  target,
  open,
  onOpenChange,
  onChangePlan,
  onSubmit,
  isProcessing,
  selectedPlan,
  onCouponApplied,
}: ExtendLicenseDialogProps) => {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<ExtendPlanOption[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const selectedPlanRef = useRef<ExtendPlanOption | null | undefined>(selectedPlan);
  const isPerpetual = target?.licenseEnd == null;
  const licenseId = target?.licenseId ?? null;

  // Coupon state
  const [couponCode, setCouponCode] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);

  useEffect(() => {
    selectedPlanRef.current = selectedPlan;
  }, [selectedPlan]);

  useEffect(() => {
    const fetchPlans = async () => {
      if (!open || !target?.tierLevel) {
        setPlans([]);
        return;
      }

      if (target?.licenseEnd == null) {
        setPlans([]);
        onChangePlan(null);
        setLoadingPlans(false);
        return;
      }

      setLoadingPlans(true);
      try {
        const { data, error } = await supabase
          .from('fanmark_tier_extension_prices' as any)
          .select('months, price_yen')
          .eq('tier_level', target.tierLevel)
          .eq('is_active', true)
          .order('months', { ascending: true });

        if (error) throw error;

        const typedData = (data ?? []) as unknown as Array<{ months: number; price_yen: number }>;
        const options = typedData.map(item => ({ months: item.months, price: item.price_yen }));
        setPlans(options);

        if (!selectedPlanRef.current) {
          if (options.length > 0) {
            onChangePlan(options[0]);
          } else {
            onChangePlan(null);
          }
        }
      } catch (err) {
        console.error('Failed to load extension plans:', err);
        setPlans([]);
        onChangePlan(null);
      } finally {
        setLoadingPlans(false);
      }
    };

    fetchPlans();
    // Intentionally re-run when open state or target tier changes
  }, [open, target?.tierLevel]);

  const initialPlan = plans[0] ?? null;
  const activePlan = selectedPlan ?? initialPlan ?? null;

  useEffect(() => {
    if (!selectedPlan && initialPlan && !isPerpetual) {
      onChangePlan(initialPlan);
    }
  }, [selectedPlan, initialPlan, onChangePlan, isPerpetual]);
  const formattedExpiration = useMemo(() => {
    if (isPerpetual) return t('dashboard.extendDialog.perpetualLabel');
    if (!target?.licenseEnd) return null;
    const date = new Date(target.licenseEnd);
    return formatInTimeZone(date, 'Asia/Tokyo', 'yyyy/MM/dd');
  }, [target?.licenseEnd, t, isPerpetual]);

  const formattedExtendedExpiration = useMemo(() => {
    if (isPerpetual) return t('dashboard.extendDialog.perpetualLabel');
    if (!target?.licenseEnd || !activePlan) return null;
    const base = new Date(target.licenseEnd);
    const extended = addMonths(base, activePlan.months);
    return formatInTimeZone(extended, 'Asia/Tokyo', 'yyyy/MM/dd');
  }, [target?.licenseEnd, activePlan, t, isPerpetual]);

  const formattedGraceExpiration = useMemo(() => {
    if (!target?.graceExpiresAt) return null;
    const date = new Date(target.graceExpiresAt);
    return formatInTimeZone(date, 'Asia/Tokyo', 'yyyy/MM/dd');
  }, [target?.graceExpiresAt]);

  // Calculate if extension will exceed 6 months from now
  const willExceedSixMonths = useMemo(() => {
    if (isPerpetual || !target?.licenseEnd || !activePlan) return false;

    const now = new Date();
    const currentEnd = new Date(target.licenseEnd);
    const baseDate = currentEnd > now ? currentEnd : now;
    const extendedEnd = addMonths(baseDate, activePlan.months);
    const sixMonthsFromNow = addMonths(now, 6);

    // Compare dates directly to account for partial months
    return extendedEnd > sixMonthsFromNow;
  }, [target?.licenseEnd, activePlan, isPerpetual]);

  const getCouponErrorDescription = async (err: unknown): Promise<string> => {
    const fallback = t('dashboard.extendDialog.couponErrorDescription');
    const knownCodes = new Set([
      'coupon_expired',
      'coupon_usage_exceeded',
      'coupon_not_found',
      'tier_not_allowed',
      'coupon_already_used_on_fanmark',
      'fanmark_limit_exceeded',
      'perpetual_license',
      'transfer_in_progress',
    ]);

    const formatCouponError = (errorCode: string): string => {
      if (errorCode === 'coupon_expired') {
        return t('dashboard.extendDialog.couponErrorExpired');
      }
      if (errorCode === 'coupon_usage_exceeded') {
        return t('dashboard.extendDialog.couponErrorUsageExceeded');
      }
      if (errorCode === 'coupon_not_found') {
        return t('dashboard.extendDialog.couponErrorNotFound');
      }
      if (errorCode === 'tier_not_allowed') {
        return t('dashboard.extendDialog.couponErrorTierNotAllowed');
      }
      if (errorCode === 'coupon_already_used_on_fanmark') {
        return t('dashboard.extendDialog.couponErrorAlreadyUsed');
      }
      if (errorCode === 'fanmark_limit_exceeded') {
        return t('dashboard.extendDialog.couponErrorFanmarkLimit');
      }
      if (errorCode === 'perpetual_license') {
        return t('dashboard.extendDialog.couponErrorPerpetual');
      }
      if (errorCode === 'transfer_in_progress') {
        return t('dashboard.extendDialog.couponErrorTransferInProgress');
      }
      return fallback;
    };

    const parseErrorCode = (value: unknown): string | null => {
      if (!value) return null;
      if (typeof value === 'string') {
        if (knownCodes.has(value.trim())) return value.trim();
        try {
          const parsed = JSON.parse(value) as { error?: string };
          if (parsed?.error && knownCodes.has(parsed.error)) return parsed.error;
        } catch {
          const match = value.match(/\"error\"\s*:\s*\"([^\"]+)\"/);
          if (match?.[1] && knownCodes.has(match[1])) return match[1];
        }
        return null;
      }
      if (typeof value === 'object') {
        const maybeError = (value as { error?: string }).error;
        if (maybeError && knownCodes.has(maybeError)) return maybeError;
      }
      return null;
    };

    // Check error.message first
    const errorCodeFromMessage =
      err instanceof Error ? parseErrorCode(err.message) : null;

    // Check error object structure (for supabase.functions.invoke errors)
    if (err && typeof err === 'object') {
      const anyErr = err as any;
      
      // Direct error property
      const direct = parseErrorCode(anyErr?.error);
      if (direct) {
        return formatCouponError(direct);
      }

      // Check context.response (Response object)
      const context = anyErr?.context;
      if (context) {
        if (context instanceof Response) {
          try {
            const clone = context.clone ? context.clone() : context;
            const rawBody = await clone.text();
            if (rawBody.trim()) {
              try {
                const json = JSON.parse(rawBody);
                  if (json?.error && knownCodes.has(json.error)) {
                  return formatCouponError(json.error);
                  }
              } catch {
                // Not JSON, continue
              }
            }
          } catch (parseError) {
            console.warn('[ExtendLicenseDialog] Failed to parse error response:', parseError);
          }
        }

        // Check context.response (object with response property)
        if (typeof context === 'object' && context.response) {
          const response: Response | undefined = context.response;
          if (response) {
            try {
              const clone = response.clone ? response.clone() : response;
              const rawBody = await clone.text();
              if (rawBody.trim()) {
                try {
                  const json = JSON.parse(rawBody);
                  if (json?.error && knownCodes.has(json.error)) {
                    return formatCouponError(json.error);
                  }
                } catch {
                  // Not JSON, continue
                }
              }
            } catch (parseError) {
              console.warn('[ExtendLicenseDialog] Failed to parse error response:', parseError);
            }
          }
        }
      }
    }

    // Fallback to error message or generic message
    return err instanceof Error && err.message ? err.message : fallback;
  };

  // Reset coupon code when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setCouponCode('');
    }
  }, [open]);

  const handleApplyCoupon = async () => {
    if (!couponCode.trim() || !licenseId) return;

    setCouponLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('apply-extension-coupon', {
        body: {
          coupon_code: couponCode.trim().toUpperCase(),
          license_id: licenseId,
        },
      });

      if (error) throw error;
      if (data?.error) {
        // Create error object with error code for proper parsing
        const errorObj = new Error(data.error);
        (errorObj as any).error = data.error;
        throw errorObj;
      }

      toast.success(t('dashboard.extendDialog.couponSuccessTitle'), {
        description: t('dashboard.extendDialog.couponSuccessDescription', { months: data.months }),
      });

      setCouponCode('');
      onOpenChange(false);
      onCouponApplied?.();
    } catch (err: any) {
      console.error('Coupon application failed:', err);
      const errorDescription = await getCouponErrorDescription(err);
      toast.error(t('dashboard.extendDialog.couponErrorTitle'), {
        description: errorDescription,
      });
    } finally {
      setCouponLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !isProcessing && !couponLoading && onOpenChange(open)}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => (isProcessing || couponLoading) && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('dashboard.extendDialog.title')}</DialogTitle>
        </DialogHeader>

        {isPerpetual ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
            {t('dashboard.extendDialog.perpetualMessage')}
          </div>
        ) : (
          <Tabs defaultValue="payment" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-12 p-1 bg-muted/50 rounded-xl">
              <TabsTrigger
                value="payment"
                disabled={isProcessing || couponLoading}
                className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm h-full"
              >
                <CreditCard className="h-4 w-4" />
                {t('dashboard.extendDialog.tabPayment')}
              </TabsTrigger>
              <TabsTrigger
                value="coupon"
                disabled={isProcessing || couponLoading}
                className="rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm h-full"
              >
                <Ticket className="h-4 w-4" />
                {t('dashboard.extendDialog.tabCoupon')}
              </TabsTrigger>
            </TabsList>

            {/* Payment Tab */}
            <TabsContent value="payment" className="space-y-4">
              {/* Expiration info - only for payment tab */}
              <div className="rounded-lg border border-border/40 bg-muted/30 p-4 text-sm space-y-4">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                  <div className="space-y-1 text-center">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('dashboard.extendDialog.currentExpiration')}
                    </span>
                    <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-base font-semibold text-foreground shadow-sm text-center">
                      {formattedExpiration ?? '—'}
                    </div>
                  </div>
                  <div className="flex flex-col items-center justify-center gap-2 text-primary">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <span className="text-lg">→</span>
                    </div>
                  </div>
                  <div className="space-y-1 text-center">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('dashboard.extendDialog.extendedExpiration')}
                    </span>
                    <div
                      className={cn(
                        'rounded-lg border px-3 py-2 text-base font-semibold shadow-sm transition-colors',
                        formattedExtendedExpiration
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                          : 'border-dashed border-border/60 bg-background text-muted-foreground'
                      )}
                    >
                      <span className="block text-center">
                        {formattedExtendedExpiration ?? t('dashboard.extendDialog.extendedExpirationPlaceholder', { months: activePlan?.months ?? initialPlan?.months ?? 1 })}
                      </span>
                    </div>
                  </div>
                </div>
                {formattedGraceExpiration && (
                  <div className="flex flex-col gap-1 border-t border-border/40 pt-3">
                    <span className="font-medium text-foreground">{t('dashboard.extendDialog.graceExpiration')}</span>
                    <span className="text-muted-foreground">{formattedGraceExpiration}</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {plans.length === 0 && !loadingPlans && (
                  <div className="col-span-2 text-sm text-muted-foreground text-center">
                    {t('dashboard.extendDialog.planUnavailable')}
                  </div>
                )}
                {plans.map(plan => (
                  <button
                    key={plan.months}
                    type="button"
                    className={cn(
                      'rounded-xl border px-4 py-3 text-left transition-colors hover:border-primary',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary',
                      activePlan?.months === plan.months
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 bg-background/80 text-foreground'
                    )}
                    onClick={() => onChangePlan(plan)}
                    disabled={isProcessing}
                  >
                    <div className="text-sm font-semibold">
                      {t('dashboard.extendDialog.planLabel', { months: plan.months })}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t('dashboard.extendDialog.planPrice', { price: plan.price.toLocaleString() })}
                    </div>
                  </button>
                ))}
              </div>

              {activePlan && (
                <>
                  <Alert className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 shadow-sm">
                    <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <Info className="h-4 w-4 text-primary" aria-hidden="true" />
                    </span>
                    <AlertDescription className="text-sm leading-relaxed space-y-1">
                      <p className="font-medium text-foreground">{t('dashboard.extendDialog.stripeRedirectNotice')}</p>
                      <p className="text-muted-foreground">{t('dashboard.extendDialog.paymentNotice')}</p>
                    </AlertDescription>
                  </Alert>

                  {willExceedSixMonths && (
                    <Alert className="flex items-start gap-3 rounded-xl border border-amber-200/60 bg-amber-50/50 px-4 py-3 shadow-sm">
                      <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-amber-100/80">
                        <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
                      </span>
                      <div className="flex-1 space-y-1">
                        <AlertTitle className="text-sm font-semibold text-amber-900">
                          {t('dashboard.extendDialog.longTermWarningTitle')}
                        </AlertTitle>
                        <AlertDescription className="text-xs leading-relaxed text-amber-800/90">
                          {t('dashboard.extendDialog.longTermWarningDescriptionBefore')}
                          <Link
                            to="/terms"
                            className="font-medium text-amber-900 underline decoration-amber-300 underline-offset-2 hover:decoration-amber-500 transition-colors"
                            onClick={() => onOpenChange(false)}
                          >
                            {t('dashboard.extendDialog.longTermWarningDescriptionLink')}
                          </Link>
                          {t('dashboard.extendDialog.longTermWarningDescriptionAfter')}
                        </AlertDescription>
                      </div>
                    </Alert>
                  )}
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
                  {t('dashboard.extendDialog.buttonCancel')}
                </Button>
                <Button
                  onClick={onSubmit}
                  disabled={isProcessing || !selectedPlan || loadingPlans}
                  className="min-w-[140px]"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('dashboard.extendDialog.processing')}
                    </>
                  ) : selectedPlan ? (
                    <>
                      <CreditCard className="h-4 w-4 mr-2" />
                      {t('dashboard.extendDialog.buttonConfirmWithPrice', { price: selectedPlan.price.toLocaleString() })}
                    </>
                  ) : (
                    t('dashboard.extendDialog.buttonConfirm')
                  )}
                </Button>
              </div>
            </TabsContent>

            {/* Coupon Tab */}
            <TabsContent value="coupon" className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('dashboard.extendDialog.couponDescription')}
              </p>
              <Input
                placeholder={t('dashboard.extendDialog.couponPlaceholder')}
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                disabled={couponLoading}
                className="uppercase"
                maxLength={20}
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={couponLoading}>
                  {t('dashboard.extendDialog.buttonCancel')}
                </Button>
                <Button
                  onClick={handleApplyCoupon}
                  disabled={!couponCode.trim() || couponLoading}
                  className="min-w-[140px]"
                >
                  {couponLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('dashboard.extendDialog.processing')}
                    </>
                  ) : (
                    <>
                      <Ticket className="h-4 w-4 mr-2" />
                      {t('dashboard.extendDialog.couponApplyButton')}
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};
