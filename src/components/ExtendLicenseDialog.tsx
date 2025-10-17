import { useEffect, useMemo, useState, useRef } from 'react';
import { addMonths } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { formatInTimeZone } from 'date-fns-tz';
import { supabase } from '@/integrations/supabase/client';

export interface ExtendPlanOption {
  months: number;
  price: number;
}

export interface ExtendLicenseTarget {
  fanmarkId: string;
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
}

export const ExtendLicenseDialog = ({
  target,
  open,
  onOpenChange,
  onChangePlan,
  onSubmit,
  isProcessing,
  selectedPlan,
}: ExtendLicenseDialogProps) => {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<ExtendPlanOption[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const selectedPlanRef = useRef<ExtendPlanOption | null | undefined>(selectedPlan);

  useEffect(() => {
    selectedPlanRef.current = selectedPlan;
  }, [selectedPlan]);

  useEffect(() => {
    const fetchPlans = async () => {
      if (!open || !target?.tierLevel) {
        setPlans([]);
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
    if (!selectedPlan && initialPlan) {
      onChangePlan(initialPlan);
    }
  }, [selectedPlan, initialPlan, onChangePlan]);
  const formattedExpiration = useMemo(() => {
    if (!target?.licenseEnd) return null;
    const date = new Date(target.licenseEnd);
    return formatInTimeZone(date, 'Asia/Tokyo', 'yyyy/MM/dd');
  }, [target?.licenseEnd]);

  const formattedExtendedExpiration = useMemo(() => {
    if (!target?.licenseEnd || !activePlan) return null;
    const base = new Date(target.licenseEnd);
    const extended = addMonths(base, activePlan.months);
    return formatInTimeZone(extended, 'Asia/Tokyo', 'yyyy/MM/dd');
  }, [target?.licenseEnd, activePlan]);

  const formattedGraceExpiration = useMemo(() => {
    if (!target?.graceExpiresAt) return null;
    const date = new Date(target.graceExpiresAt);
    return formatInTimeZone(date, 'Asia/Tokyo', 'yyyy/MM/dd');
  }, [target?.graceExpiresAt]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dashboard.extendDialog.title')}</DialogTitle>
          <DialogDescription>{t('dashboard.extendDialog.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
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

          <div>
            <div className="mt-3 grid grid-cols-2 gap-3">
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
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
              {t('dashboard.extendDialog.buttonCancel')}
            </Button>
            <Button onClick={onSubmit} disabled={isProcessing || !selectedPlan}>
              {isProcessing ? t('dashboard.extendDisabled') : t('dashboard.extendDialog.buttonConfirm')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
