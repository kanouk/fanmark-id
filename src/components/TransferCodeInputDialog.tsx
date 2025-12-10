import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { AlertTriangle } from 'lucide-react';

interface TransferCodeInputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applyTransferCode: (code: string) => Promise<any>;
  onSuccess: () => void;
}

export const TransferCodeInputDialog = ({
  open,
  onOpenChange,
  applyTransferCode,
  onSuccess
}: TransferCodeInputDialogProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [code, setCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [applying, setApplying] = useState(false);

  const handleSubmit = async () => {
    if (!code.trim() || !agreed) return;

    setApplying(true);
    try {
      await applyTransferCode(code.trim().toUpperCase());
      toast({
        title: t('transfer.success.requestApplied'),
        description: t('transfer.success.requestAppliedDesc')
      });
      onSuccess();
      handleClose();
    } catch (error: any) {
      const message = error?.message || '';
      let errorTitle = 'transfer.error.applyFailed';
      let errorDescription = '';
      
      if (message.includes('invalid') || message.includes('not found')) {
        errorTitle = 'transfer.error.invalidCode';
      } else if (message.includes('expired')) {
        errorTitle = 'transfer.error.codeExpired';
      } else if (message.includes('self')) {
        errorTitle = 'transfer.error.selfTransfer';
      } else if (message.includes('fanmark_limit_exceeded')) {
        errorTitle = 'transfer.error.limitExceeded';
        // Parse detailed info from Edge Function response
        const currentMatch = message.match(/current[:\s]+(\d+)/i);
        const limitMatch = message.match(/limit[:\s]+(\d+)/i);
        if (currentMatch && limitMatch) {
          errorDescription = t('transfer.error.limitExceededDetail', {
            current: currentMatch[1],
            limit: limitMatch[1]
          });
        }
      } else if (message.includes('limit')) {
        errorTitle = 'transfer.error.limitExceeded';
      }

      toast({
        title: t(errorTitle),
        description: errorDescription || undefined,
        variant: 'destructive'
      });
    } finally {
      setApplying(false);
    }
  };

  const handleClose = () => {
    setCode('');
    setAgreed(false);
    onOpenChange(false);
  };

  // Format code as user types (XXXX-XXXX-XXXX)
  const handleCodeChange = (value: string) => {
    const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const parts = [];
    for (let i = 0; i < cleaned.length && i < 12; i += 4) {
      parts.push(cleaned.slice(i, i + 4));
    }
    setCode(parts.join('-'));
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('transfer.inputDialog.title')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t('transfer.inputDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="transfer-code">{t('transfer.codeLabel')}</Label>
            <Input
              id="transfer-code"
              value={code}
              onChange={(e) => handleCodeChange(e.target.value)}
              placeholder={t('transfer.inputDialog.codePlaceholder')}
              className="font-mono text-center text-lg tracking-wider"
              maxLength={14}
            />
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-4 space-y-3">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium text-sm">{t('transfer.inputDialog.disclaimer')}</span>
            </div>
            <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1.5 list-disc pl-5">
              <li>{t('transfer.inputDialog.disclaimerItem2')}</li>
              <li>{t('transfer.inputDialog.disclaimerItem3')}</li>
              <li>{t('transfer.inputDialog.disclaimerItem4')}</li>
            </ul>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="agree-input"
              checked={agreed}
              onCheckedChange={(checked) => setAgreed(checked === true)}
            />
            <Label htmlFor="agree-input" className="text-sm leading-relaxed cursor-pointer">
              {t('transfer.inputDialog.agreeCheckbox')}
            </Label>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={handleClose}>
            {t('transfer.inputDialog.cancelButton')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!code.trim() || !agreed || applying || code.length < 14}
          >
            {applying ? t('transfer.inputDialog.applying') : t('transfer.inputDialog.applyButton')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
