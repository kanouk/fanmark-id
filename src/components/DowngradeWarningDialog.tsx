import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Calendar, TrendingDown } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { type PlanType } from '@/lib/plan-utils';
import { format } from 'date-fns';
import { ja, enUS, ko, id as idLocale } from 'date-fns/locale';

interface DowngradeWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan: PlanType;
  newPlan: PlanType;
  subscriptionEnd: string | null;
  currentLimit: number;
  newLimit: number;
  onConfirm: () => void;
  isProcessing: boolean;
}

export const DowngradeWarningDialog = ({
  open,
  onOpenChange,
  currentPlan,
  newPlan,
  subscriptionEnd,
  currentLimit,
  newLimit,
  onConfirm,
  isProcessing,
}: DowngradeWarningDialogProps) => {
  const { t, language } = useTranslation();

  const getDateFnsLocale = () => {
    switch (language) {
      case 'ja': return ja;
      case 'ko': return ko;
      case 'id': return idLocale;
      default: return enUS;
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return format(date, 'PPP', { locale: getDateFnsLocale() });
    } catch (error) {
      return dateString;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            {t('planDowngrade.downgradeWarningTitle')}
          </DialogTitle>
          <DialogDescription>
            {t(`planSelection.${currentPlan}.name`)} → {t(`planSelection.${newPlan}.name`)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Subscription end date */}
          {subscriptionEnd && (
            <div className="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
              <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-medium">
                  {t('planDowngrade.subscriptionEndDate', { date: formatDate(subscriptionEnd) })}
                </p>
              </div>
            </div>
          )}

          {/* Warning about losing remaining period */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="font-medium">
              {t('planDowngrade.loseRemainingPeriod')}
            </AlertDescription>
          </Alert>

          {/* Fanmark limit change */}
          <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <TrendingDown className="h-5 w-5 text-primary mt-0.5" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium">
                {t('planDowngrade.fanmarkLimitChange', { from: currentLimit, to: newLimit })}
              </p>
            </div>
          </div>

          {/* Suggestion to wait */}
          <p className="text-sm text-muted-foreground">
            {t('planDowngrade.considerWaiting')}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            {t('planDowngrade.cancelDowngrade')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                {t('common.processing')}
              </>
            ) : (
              t('planDowngrade.confirmDowngrade')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
