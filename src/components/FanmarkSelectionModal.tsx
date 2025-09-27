import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, AlertTriangle } from 'lucide-react';
import { FiUser, FiExternalLink, FiFileText, FiMoon } from 'react-icons/fi';
import { RiCalendarCheckLine } from 'react-icons/ri';
import { supabase } from '@/integrations/supabase/client';

interface Fanmark {
  id: string;
  emoji_combination: string;
  fanmark_name: string | null;
  license_id: string;
  license_end: string;
  access_type: string | null;
}

interface FanmarkSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  newPlanType: 'free' | 'creator' | 'business' | 'admin';
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

  // Initialize with the first N fanmarks selected (based on creation date)
  useEffect(() => {
    if (currentFanmarks.length > 0) {
      const initialSelection = new Set(
        currentFanmarks
          .slice(0, newPlanLimit)
          .map(f => f.id)
      );
      setSelectedFanmarks(initialSelection);
    }
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

  const getAccessTypeIcon = (accessType: string | null) => {
    switch (accessType) {
      case 'profile':
        return <FiUser className="h-4 w-4 text-blue-500" />;
      case 'redirect':
        return <FiExternalLink className="h-4 w-4 text-green-500" />;
      case 'messageboard':
        return <FiFileText className="h-4 w-4 text-purple-500" />;
      default:
        return <FiMoon className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => !processing && onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
        <DialogHeader className="space-y-4">
          <DialogTitle className="text-xl font-bold">
            {t('planDowngrade.modalTitle')}
          </DialogTitle>
          <div className="space-y-2">
            <DialogDescription className="text-base">
              {t('planDowngrade.newPlanLimit', { limit: newPlanLimit })}
            </DialogDescription>
            <div className="space-y-1">
              <p className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {t('planDowngrade.noExtensionWarning')}
              </p>
              <p className="text-sm font-medium text-destructive">
                {t('planDowngrade.finalSelectionWarning')}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Selection Counter */}
          <div className="flex items-center justify-between">
            <Badge 
              variant={isSelectionComplete ? "default" : "secondary"}
              className="text-sm px-3 py-1"
            >
              {t('planDowngrade.selectionCount', { 
                selected: selectedFanmarks.size, 
                limit: newPlanLimit 
              })}
            </Badge>
          </div>

          {/* Fanmark Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
            {currentFanmarks.map((fanmark) => {
              const selected = isSelected(fanmark.id);
              const canSelect = selected || selectedFanmarks.size < newPlanLimit;
              const remainingDays = Math.max(0, Math.ceil(
                (new Date(fanmark.license_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              ));
              
              return (
                <Card 
                  key={fanmark.id}
                  className={`min-h-[140px] cursor-pointer transition-all duration-200 hover:scale-105 ${
                    selected 
                      ? 'border-primary bg-primary/5 shadow-md ring-2 ring-primary/20' 
                      : canSelect
                        ? 'border-border hover:border-primary/50 hover:shadow-md'
                        : 'border-border bg-muted/50 opacity-60'
                  }`}
                  onClick={() => canSelect && handleFanmarkToggle(fanmark.id)}
                >
                  <CardContent className="p-4 h-full flex flex-col">
                    {/* Top: Emoji and Checkbox */}
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-4xl leading-none">
                        {fanmark.emoji_combination}
                      </span>
                      <Checkbox
                        checked={selected}
                        disabled={!canSelect}
                        className="flex-shrink-0"
                      />
                    </div>
                    
                    {/* Middle: Information */}
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <RiCalendarCheckLine className="h-4 w-4 text-orange-500" />
                        <span className="text-sm font-medium">
                          {t('planDowngrade.remainingDays', { days: remainingDays })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {getAccessTypeIcon(fanmark.access_type)}
                        <span className="text-sm">
                          {fanmark.access_type ? 
                            t(`accessTypes.${fanmark.access_type}`) : 
                            t('accessTypes.inactive')
                          }
                        </span>
                      </div>
                    </div>
                    
                    {/* Bottom: Excluded badge */}
                    {!selected && selectedFanmarks.size >= newPlanLimit && (
                      <div className="mt-2">
                        <Badge 
                          variant="destructive" 
                          className="text-xs"
                        >
                          {t('planDowngrade.excludedLabel')}
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Confirm Button */}
          <div className="flex justify-end pt-4 border-t">
            <Button
              onClick={handleConfirm}
              disabled={!isSelectionComplete || processing}
              className="px-8"
            >
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('planDowngrade.processingTitle')}
                </>
              ) : (
                t('planDowngrade.confirmButton')
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};