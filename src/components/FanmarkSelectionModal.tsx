import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { FiUser, FiExternalLink, FiFileText, FiMoon, FiCheck } from 'react-icons/fi';
import { deriveLicenseTiming } from '@/lib/licenseTiming';

interface Fanmark {
  id: string;
  user_input_fanmark: string;
  emoji_ids: string[];
  fanmark: string;
  fanmark_name: string | null;
  license_id: string;
  license_end: string | null;
  access_type: string | null;
}

interface FanmarkSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  newPlanType: 'free' | 'creator' | 'max' | 'business' | 'enterprise' | 'admin';
  newPlanLimit: number;
  currentFanmarks: Fanmark[];
  onConfirm: (selectedFanmarkIds: string[]) => Promise<void>;
}

export const FanmarkSelectionModal = ({
  isOpen,
  onClose,
  newPlanType,
  newPlanLimit,
  currentFanmarks,
  onConfirm
}: FanmarkSelectionModalProps) => {
  const { t } = useTranslation();
  const [selectedFanmarks, setSelectedFanmarks] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  // Initialize with no fanmarks selected
  useEffect(() => {
    setSelectedFanmarks(new Set());
  }, [currentFanmarks, newPlanLimit]);

  const handleFanmarkToggle = (fanmarkId: string) => {
    setSelectedFanmarks(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(fanmarkId)) {
        newSelection.delete(fanmarkId);
      } else if (newSelection.size < newPlanLimit) {
        newSelection.add(fanmarkId);
      }
      return newSelection;
    });
  };

  const handleConfirm = async () => {
    if (selectedFanmarks.size !== newPlanLimit) return;
    
    setProcessing(true);
    try {
      await onConfirm(Array.from(selectedFanmarks));
    } finally {
      setProcessing(false);
    }
  };

  const isSelected = (fanmarkId: string) => selectedFanmarks.has(fanmarkId);
  const isSelectionComplete = selectedFanmarks.size === newPlanLimit;

  const handleShowConfirmation = () => {
    if (!isSelectionComplete) return;
    setShowConfirmation(true);
  };

  const handleFinalConfirm = async () => {
    await handleConfirm();
  };

  const getAccessTypeIcon = (accessType: string | null) => {
    switch (accessType) {
      case 'profile':
        return <FiUser className="h-3 w-3 text-blue-500" />;
      case 'redirect':
        return <FiExternalLink className="h-3 w-3 text-green-500" />;
      case 'text':
        return <FiFileText className="h-3 w-3 text-amber-600" />;
      case 'messageboard':
        return <FiFileText className="h-3 w-3 text-amber-600" />;
      default:
        return <FiMoon className="h-3 w-3 text-muted-foreground" />;
    }
  };

  if (showConfirmation) {
    return (
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setShowConfirmation(false);
            onClose();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader className="space-y-3">
            <DialogTitle className="text-lg font-semibold">
              {t('planDowngrade.confirmationTitle')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t('planDowngrade.confirmationDescription', {
                selected: selectedFanmarks.size,
                excluded: currentFanmarks.length - selectedFanmarks.size
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="pt-4">
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowConfirmation(false)}
                disabled={processing}
                className="px-4"
              >
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleFinalConfirm}
                disabled={processing}
                className="px-4 bg-primary"
              >
                {processing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('planDowngrade.processingTitle')}
                  </>
                ) : (
                  t('planDowngrade.finalConfirm')
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader className="space-y-3 pb-4 border-b flex-shrink-0">
          <DialogTitle className="text-lg font-semibold">
            {t('planDowngrade.modalTitle')}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t('planDowngrade.newPlanLimit', { limit: newPlanLimit })}
          </DialogDescription>

          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  {t('planDowngrade.noExtensionWarning')}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                  {t('planDowngrade.finalSelectionWarning')}
                </p>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col space-y-3 overflow-hidden">
          {/* Selection Counter */}
          <div className="bg-muted/30 border rounded-lg p-3 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  {t('planDowngrade.selectFanmarks')}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedFanmarks.size === 0
                    ? t('planDowngrade.selectPrompt', { limit: newPlanLimit })
                    : t('planDowngrade.selectionStatus', { selected: selectedFanmarks.size })
                  }
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isSelectionComplete && (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                )}
              </div>
            </div>
          </div>

          {/* Fanmark Grid */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pb-1">
            {currentFanmarks.map((fanmark) => {
              const selected = isSelected(fanmark.id);
              const canSelect = selected || selectedFanmarks.size < newPlanLimit;
              // For perpetual licenses (license_end is null), show as perpetual
              const isPerpetual = fanmark.license_end === null;
              const timing = isPerpetual
                ? null
                : deriveLicenseTiming({ licenseEnd: fanmark.license_end ?? undefined });
              const remainingDays = isPerpetual
                ? null
                : Math.max(0, timing?.remainingWholeDays ?? 0);

              return (
                <div
                  key={fanmark.id}
                  className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                    selected
                      ? 'border-primary bg-primary/5'
                      : canSelect
                        ? 'border-border hover:border-primary/50 bg-background'
                        : 'border-border bg-muted/20 opacity-50 cursor-not-allowed'
                  }`}
                  onClick={() => canSelect && handleFanmarkToggle(fanmark.id)}
                >
                  {/* Top: Emoji and Selection Indicator */}
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl leading-none">
                      {fanmark.fanmark}
                    </span>
                    <div className="flex-shrink-0">
                      {selected ? (
                        <div className="w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                          <FiCheck className="h-2.5 w-2.5 text-primary-foreground" />
                        </div>
                      ) : canSelect ? (
                        <div className="w-4 h-4 border border-muted-foreground/30 rounded-full hover:border-primary/50 transition-colors" />
                      ) : (
                        <div className="w-4 h-4 border border-muted-foreground/20 rounded-full bg-muted/20" />
                      )}
                    </div>
                  </div>

                  {/* Information */}
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>
                        {isPerpetual 
                          ? t('dashboard.perpetualLicense')
                          : t('planDowngrade.remainingDays', { days: remainingDays })
                        }
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {getAccessTypeIcon(fanmark.access_type)}
                      <span className="truncate">
                        {fanmark.access_type ?
                          t(`accessTypes.${fanmark.access_type}`) :
                          t('accessTypes.inactive')
                        }
                      </span>
                    </div>
                  </div>

                </div>
              );
            })}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 border-t flex-shrink-0">
          <div className="flex flex-col gap-2">
            {isSelectionComplete ? (
              <Button
                onClick={handleShowConfirmation}
                className="w-full bg-primary hover:bg-primary/90"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {t('planDowngrade.proceedButton')}
              </Button>
            ) : (
              <div className="text-xs text-muted-foreground py-2 text-center">
                {t('planDowngrade.selectRemaining', { remaining: newPlanLimit - selectedFanmarks.size })}
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="w-full"
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
