import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useTransferCode } from '@/hooks/useTransferCode';
import { AlertTriangle, Copy } from 'lucide-react';

interface TransferCodeIssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fanmarkId: string;
  licenseId: string;
  fanmarkEmoji: string;
  onSuccess: () => void;
}

export const TransferCodeIssueDialog = ({
  open,
  onOpenChange,
  fanmarkId,
  licenseId,
  fanmarkEmoji,
  onSuccess
}: TransferCodeIssueDialogProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { issueTransferCode } = useTransferCode();

  const [agreed, setAgreed] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!agreed) return;

    setIssuing(true);
    try {
      const result = await issueTransferCode(fanmarkId, licenseId);
      setIssuedCode(result.transfer_code);
      toast({
        title: t('transfer.success.codeIssued'),
        description: t('transfer.success.codeIssuedDesc').replace('{code}', result.transfer_code)
      });
      onSuccess();
    } catch (error: any) {
      const message = error?.message || '';
      let errorKey = 'transfer.error.issueFailed';
      let errorDescription: string | undefined;
      
      if (message.includes('48') || message.includes('insufficient')) {
        errorKey = 'transfer.error.insufficientLicense';
      } else if (message.includes('pending') || message.includes('applied')) {
        errorKey = 'transfer.error.pendingRequest';
      } else if (message.includes('transfer_locked') || message.includes('locked')) {
        errorKey = 'transfer.error.transferLocked';
        const lockedUntil = error?.lockedUntil as string | undefined;
        if (lockedUntil) {
          const date = new Date(lockedUntil);
          if (!Number.isNaN(date.getTime())) {
            const yyyy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            errorDescription = t('transfer.error.transferLockedDetail', {
              date: `${yyyy}/${mm}/${dd}`,
            });
          }
        }
      }

      toast({
        title: t(errorKey),
        description: errorDescription,
        variant: 'destructive'
      });
    } finally {
      setIssuing(false);
    }
  };

  const handleCopyCode = async () => {
    if (!issuedCode) return;
    try {
      await navigator.clipboard.writeText(issuedCode);
      toast({
        title: t('common.linkCopied'),
        description: issuedCode
      });
    } catch {
      // Fallback
    }
  };

  const handleClose = () => {
    setAgreed(false);
    setIssuedCode(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('transfer.issueDialog.title')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('transfer.issueDialog.title')}
          </DialogDescription>
        </DialogHeader>

        {issuedCode ? (
          <div className="space-y-6 py-4">
            <div className="text-center space-y-4">
              <div className="text-4xl">{fanmarkEmoji}</div>
              <div className="p-4 rounded-lg bg-muted">
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono text-xl tracking-wider">{issuedCode}</span>
                  <button
                    onClick={handleCopyCode}
                    className="p-2 hover:bg-primary/10 rounded"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
            <Button className="w-full" onClick={handleClose}>
              {t('common.close')}
            </Button>
          </div>
        ) : (
          <div className="space-y-6 py-4">
            <div className="text-center">
              <div className="text-4xl mb-2">{fanmarkEmoji}</div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-4 space-y-3">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium text-sm">{t('transfer.issueDialog.disclaimer')}</span>
              </div>
              <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1.5 list-disc pl-5">
                <li>{t('transfer.issueDialog.disclaimerItem1')}</li>
                <li>{t('transfer.issueDialog.disclaimerItem2')}</li>
                <li>{t('transfer.issueDialog.disclaimerItem3')}</li>
                <li>{t('transfer.issueDialog.disclaimerItem4')}</li>
                <li>{t('transfer.issueDialog.disclaimerItem5')}</li>
              </ul>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="agree-issue"
                checked={agreed}
                onCheckedChange={(checked) => setAgreed(checked === true)}
              />
              <Label htmlFor="agree-issue" className="text-sm leading-relaxed cursor-pointer">
                {t('transfer.issueDialog.agreeCheckbox')}
              </Label>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={handleClose}>
                {t('transfer.issueDialog.cancelButton')}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!agreed || issuing}
              >
                {issuing ? t('transfer.issueDialog.issuing') : t('transfer.issueDialog.issueButton')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
