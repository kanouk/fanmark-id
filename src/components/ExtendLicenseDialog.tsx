import { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import { formatInTimeZone } from 'date-fns-tz';

export interface ExtendLicenseTarget {
  fanmarkId: string;
  emoji: string;
  shortId: string;
  licenseEnd?: string | null;
  graceExpiresAt?: string | null;
  status?: string | null;
}

interface ExtendLicenseDialogProps {
  target: ExtendLicenseTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChangePlan: (months: number) => void;
  onSubmit: () => void;
  isProcessing: boolean;
  selectedPlan?: number | null;
}

interface ExtendPlan {
  months: number;
  price: number;
}

const plans: ExtendPlan[] = [
  { months: 1, price: 1000 },
  { months: 2, price: 2000 },
  { months: 3, price: 3000 },
  { months: 6, price: 5000 },
];

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
  const formattedExpiration = useMemo(() => {
    if (!target?.licenseEnd) return null;
    const date = new Date(target.licenseEnd);
    return formatInTimeZone(date, 'Asia/Tokyo', 'yyyy/MM/dd');
  }, [target?.licenseEnd]);

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
          <div className="rounded-lg border border-border/40 bg-muted/30 p-3 text-sm">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{t('dashboard.extendDialog.currentExpiration')}</span>
              <span className="text-muted-foreground">{formattedExpiration ?? '—'}</span>
            </div>
            {formattedGraceExpiration && (
              <div className="mt-2 flex flex-col gap-1">
                <span className="font-medium text-foreground">{t('dashboard.extendDialog.graceExpiration')}</span>
                <span className="text-muted-foreground">{formattedGraceExpiration}</span>
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-foreground">{t('dashboard.extendDialog.selectPlan')}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {plans.map(plan => (
                <button
                  key={plan.months}
                  type="button"
                  className={cn(
                    'rounded-xl border px-4 py-3 text-left transition-colors hover:border-primary',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary',
                    selectedPlan === plan.months
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 bg-background/80 text-foreground'
                  )}
                  onClick={() => onChangePlan(plan.months)}
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
