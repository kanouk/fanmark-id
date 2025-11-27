import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { differenceInDays } from 'date-fns';

interface ReturnFanmarkDialogProps {
  fanmark: {
    emoji: string;
    shortId: string;
    tierLevel?: number;
    licenseEnd?: string | null;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isProcessing: boolean;
  hasPendingCheckout?: boolean;
}

export const ReturnFanmarkDialog = ({
  fanmark,
  open,
  onOpenChange,
  onConfirm,
  isProcessing,
  hasPendingCheckout = false,
}: ReturnFanmarkDialogProps) => {
  const { t } = useTranslation();
  const [understood, setUnderstood] = useState(false);

  const remainingDays = fanmark?.licenseEnd 
    ? differenceInDays(new Date(fanmark.licenseEnd), new Date())
    : 0;

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setUnderstood(false);
    }
    onOpenChange(newOpen);
  };

  const handleConfirm = () => {
    onConfirm();
    setUnderstood(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            {t('dashboard.returnDialog.title')}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-4 pt-2">
            {fanmark && (
              <div className="flex items-center justify-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
                <span className="text-3xl">{fanmark.emoji}</span>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-foreground">{fanmark.shortId}</span>
                  {remainingDays > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t('dashboard.returnDialog.remainingDays', { days: remainingDays })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {hasPendingCheckout && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {t('dashboard.returnDialog.pendingCheckoutWarning')}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{t('dashboard.returnDialog.irreversibleWarning')}</p>
              <p className="text-destructive font-medium">
                {t('dashboard.returnDialog.noRefundWarning')}
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background p-3">
              <Checkbox
                id="understood"
                checked={understood}
                onCheckedChange={(checked) => setUnderstood(checked === true)}
                disabled={isProcessing}
              />
              <label
                htmlFor="understood"
                className="text-sm leading-tight text-foreground cursor-pointer select-none"
              >
                {t('dashboard.returnDialog.confirmCheckbox')}
              </label>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isProcessing}>
            {t('dashboard.returnDialog.buttonCancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!understood || isProcessing}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('common.processing')}
              </>
            ) : (
              t('dashboard.returnDialog.buttonConfirm')
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
