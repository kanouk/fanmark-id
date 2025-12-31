import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { AlertTriangle } from 'lucide-react';

interface TransferRequest {
  id: string;
  fanmark?: {
    user_input_fanmark: string;
    display_fanmark?: string | null;
    short_id: string;
  };
  requester_username: string | null;
  requester_display_name: string | null;
}

interface TransferApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: TransferRequest;
  onApprove: () => void;
  processing: boolean;
}

export const TransferApprovalDialog = ({
  open,
  onOpenChange,
  request,
  onApprove,
  processing
}: TransferApprovalDialogProps) => {
  const { t } = useTranslation();

  const fanmarkDisplay = request.fanmark?.display_fanmark || '---';
  const displayName = request.requester_display_name || request.requester_username || 'unknown';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {t('transfer.approvalDialog.title')}
          </DialogTitle>
          <DialogDescription className="pt-4">
            {t('transfer.approvalDialog.description')
              .replace('{fanmark}', fanmarkDisplay)
              .replace('{username}', displayName)}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="flex items-center justify-center gap-4 p-6 rounded-lg bg-muted/50">
            <span className="text-4xl">{fanmarkDisplay}</span>
            <span className="text-2xl text-muted-foreground">→</span>
            <span className="text-lg font-medium">{displayName}</span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={processing}
          >
            {t('transfer.approvalDialog.cancelButton')}
          </Button>
          <Button
            variant="destructive"
            onClick={onApprove}
            disabled={processing}
          >
            {processing
              ? t('transfer.approvalDialog.approving')
              : t('transfer.approvalDialog.approveButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
