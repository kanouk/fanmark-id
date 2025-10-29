import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from './useTranslation';
import { toast } from '@/hooks/use-toast';

export function useLotteryEntry() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyToLottery = async (fanmarkId: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('apply-fanmark-lottery', {
        body: { fanmark_id: fanmarkId }
      });
      
      if (error) throw error;
      
      toast({
        title: t('lottery.applySuccess'),
      });
      
      return data;
    } catch (err: any) {
      console.error('[useLotteryEntry] Error applying to lottery:', err);
      
      // Extract error message from Edge Function response
      let errorMessage = t('lottery.applyError');
      
      // Check if error contains the duplicate entry message
      if (err?.message) {
        const msg = err.message.toLowerCase();
        if (msg.includes('already applied') || msg.includes('duplicate')) {
          errorMessage = t('lottery.alreadyAppliedError');
        } else {
          errorMessage = err.message;
        }
      }
      
      setError(errorMessage);
      toast({
        title: t('lottery.applyError'),
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const cancelLotteryEntry = async (entryId: string) => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('cancel-lottery-entry', {
        body: { entry_id: entryId }
      });
      
      if (error) throw error;
      
      toast({
        title: t('lottery.cancelSuccess'),
      });
      
      return data;
    } catch (err: any) {
      const errorMessage = err.message || t('lottery.cancelError');
      setError(errorMessage);
      toast({
        title: t('lottery.cancelError'),
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { applyToLottery, cancelLotteryEntry, loading, error };
}
